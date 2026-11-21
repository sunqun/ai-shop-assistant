// Static packaging checks only: does not load application code or execute its tests.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const output = path.join(__dirname, "validation.json");
const live = path.join(root, ".agents/skills/shop-pricing-audit");
const versions = path.join(root, "delivery-docs/skill-versions/shop-pricing-audit");
const checks = [];
const checkedFiles = new Set();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const read = (file) => fs.readFileSync(file, "utf8");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
const shaText = (file) => crypto.createHash("sha256").update(read(file).replaceAll("\r\n", "\n"), "utf8").digest("hex").toUpperCase();
const relative = (file) => path.relative(root, file).replaceAll(path.sep, "/");

function validateSkill(directory, version) {
  const file = path.join(directory, "SKILL.md");
  const text = read(file);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert(match, `Missing frontmatter: ${relative(file)}`);
  const meta = yaml.load(match[1]);
  assert(meta && typeof meta === "object" && !Array.isArray(meta), "Invalid frontmatter object");
  const allowed = new Set(["name", "description", "metadata", "license", "allowed-tools"]);
  assert(Object.keys(meta).every((key) => allowed.has(key)), "Unsupported frontmatter key");
  assert(meta.name === "shop-pricing-audit" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.name) && meta.name.length < 64, "Invalid skill name");
  assert(typeof meta.description === "string" && meta.description.trim().length > 0 && meta.description.length <= 1024 && !/[<>]/.test(meta.description), "Invalid description");
  assert(meta.metadata?.version === version, `Unexpected version in ${relative(file)}`);
  assert(!/^\s*\[TODO:[^\n]*\]\s*$/m.test(text), "Unfinished scaffold placeholder");
  checks.push({ check: "skill_frontmatter", path: relative(file), version, passed: true, sha256_utf8_lf: shaText(file) });
}

function collectMarkdown(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectMarkdown(file);
    else if (entry.name.endsWith(".md")) checkedFiles.add(file);
  }
}

validateSkill(live, "0.2.0");
validateSkill(path.join(versions, "v0.1.0"), "0.1.0");
validateSkill(path.join(versions, "v0.2.0"), "0.2.0");
assert(shaText(path.join(live, "SKILL.md")) === shaText(path.join(versions, "v0.2.0/SKILL.md")), "Live entry differs from current snapshot");
assert(shaText(path.join(live, "references/evidence-checklist.md")) === shaText(path.join(versions, "v0.2.0/references/evidence-checklist.md")), "Live reference differs from current snapshot");
assert(shaText(path.join(versions, "v0.1.0/SKILL.md")) !== shaText(path.join(versions, "v0.2.0/SKILL.md")), "Version entries have no actual content difference");
checks.push({ check: "snapshot_consistency_and_real_difference", passed: true });

const records = read(path.join(__dirname, "usage.jsonl")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
assert(records.length === 2 && new Set(records.map((record) => record.id)).size === records.length, "Unexpected or duplicate usage records");
for (const record of records) {
  const snapshot = path.resolve(__dirname, record.snapshot);
  const report = path.resolve(__dirname, record.report);
  assert(fs.existsSync(report), `Missing report ${record.id}`);
  assert(shaText(snapshot) === record.entry_sha256, `Snapshot digest mismatch ${record.id}`);
  assert(record.kind === "same_session_development_review" && record.project_tests_executed === false, "Usage classification mismatch");
  assert(Number.isFinite(Date.parse(record.source_read_started_utc)) && Date.parse(record.source_read_started_utc) <= Date.parse(record.source_read_ended_utc), "Invalid source-read time range");
  assert(read(report).includes(record.version), "Report version mismatch");
}
assert(Date.parse(records[0].source_read_ended_utc) < Date.parse(records[1].source_read_started_utc), "Review order is inconsistent");
checks.push({ check: "usage_reports_versions_and_hashes", actual_static_reviews: records.length, versions: new Set(records.map((record) => record.version)).size, passed: true });

collectMarkdown(live);
collectMarkdown(versions);
collectMarkdown(__dirname);
checkedFiles.add(path.join(root, "delivery-docs/SKILL_DELIVERY.md"));
let localLinks = 0;
for (const file of checkedFiles) {
  for (const match of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = match[1];
    if (/^(?:https?:|#)/i.test(link)) continue;
    const target = path.resolve(path.dirname(file), decodeURIComponent(link.split("#")[0]));
    assert(target.startsWith(root + path.sep), "Reference escapes the repository");
    if (target !== output) assert(fs.existsSync(target), `Broken reference in ${relative(file)}: ${link}`);
    localLinks += 1;
  }
}
assert(fs.statSync(path.join(versions, "v0.1.0-to-v0.2.0.diff")).size > 0, "Missing actual version diff");
checks.push({ check: "local_references_and_version_diff", markdown_files: checkedFiles.size, local_links: localLinks, passed: true });

const images = [
  ["price-test-1.png", "6BBFD404A2E4DD27BDC9D092855D7B7064F730225C06734E9C2E97A252C09053"],
  ["price-test-2.png", "CA43C067DBA6F232F57FA3A0B40FFFD0485CD120A5825415EABBEBC1B1F5758B"],
];
for (const [name, expected] of images) assert(sha(path.join(root, "delivery-docs/images", name)) === expected, `Existing image changed: ${name}`);
checks.push({ check: "existing_images_unchanged", passed: true });

const result = {
  checked_at_utc: new Date().toISOString(),
  validator: "Node.js + existing js-yaml; static delivery validation, not the Python quick_validate.py",
  official_validator_attempt: { status: "unavailable", reason: "ModuleNotFoundError: No module named 'yaml'" },
  status: "passed",
  project_tests_executed: false,
  checks,
};
fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ status: result.status, checks: checks.length, actual_static_reviews: records.length, versions: 2, project_tests_executed: false }));
