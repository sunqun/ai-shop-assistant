/** 精确命令和商品名称或别名的唯一匹配规则：不做任意自然语言提词。 */
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/repository/db";
import { normalizeCommandText } from "@/lib/common/text";
import { CATALOG_SEARCH_PREFIXES, matchExactCommand } from "./commands";
import type { IntentRouting, SearchResolution } from "./type";

export function routeExactCommand(query: string): IntentRouting | undefined {
  const command = matchExactCommand(normalizeCommandText(query));
  return command
    ? {
        layer: "rule",
        engine: "rules",
        confidence: 1,
        reason:
          command.action === "analyze_reviews"
            ? "explicit_current_product_review_request"
            : "exact_command",
        ...command,
      }
    : undefined;
}

export async function routeExactCatalogSubject(
  query: string
): Promise<SearchResolution | undefined> {
  const text = normalizeCommandText(query);
  const prefix = CATALOG_SEARCH_PREFIXES.find((item) => text.startsWith(item));
  const subject = (prefix ? text.slice(prefix.length) : text).trim();
  if (
    subject.length < 2 ||
    subject.length > 60 ||
    /[，,。；;、？?\n]/u.test(subject) ||
    ["它", "那个", "那個", "这个", "這個", "这款", "這款", "刚才那个", "剛才那個"].includes(subject)
  )
    return undefined;
  try {
    const [rows] = await getDbPool().query<RowDataPacket[]>(
      `SELECT canonical_term FROM product_search_aliases WHERE is_active = TRUE AND (alias = ? OR canonical_term = ?)
       UNION SELECT name AS canonical_term FROM products WHERE name = ? LIMIT 2`,
      [subject, subject, subject]
    );
    const terms = [
      ...new Set(rows.map((row) => String(row.canonical_term ?? "").trim()).filter(Boolean)),
    ];
    if (terms.length !== 1) return undefined;
    return {
      intent: { keywords: [terms[0]], inStockOnly: false },
      routing: {
        layer: "rule",
        engine: "rules",
        action: "new_search",
        confidence: 1,
        reason: "unique_catalog_subject",
      },
    };
  } catch {
    return undefined;
  }
}
