import type { NumericSpecConstraint } from "./types";
import { normalizeCommandText } from "@/lib/common/text";

// 同一份有限词法供原话证据、补槽及目录规格读取使用；不推断商品类型或属性。
const NUMERIC_VALUE_PATTERN = String.raw`(?:\d+(?:\.\d+)?\s*[万萬]?|[零〇一二两兩三四五六七八九十百千万萬]+)`;
const PREFIX_OPERATORS: Record<string, NumericSpecConstraint["operator"] | undefined> = {
  至少: "gte",
  最低: "gte",
  不低于: "gte",
  不低於: "gte",
  不少于: "gte",
  不少於: "gte",
  大于等于: "gte",
  大於等於: "gte",
  ">=": "gte",
  "≥": "gte",
  至多: "lte",
  最多: "lte",
  不超过: "lte",
  不超過: "lte",
  小于等于: "lte",
  小於等於: "lte",
  "<=": "lte",
  "≤": "lte",
  等于: "eq",
  等於: "eq",
  "=": "eq",
  大于: undefined,
  大於: undefined,
  小于: undefined,
  小於: undefined,
  超过: undefined,
  超過: undefined,
  不到: undefined,
  低于: undefined,
  低於: undefined,
  高于: undefined,
  高於: undefined,
  少于: undefined,
  少於: undefined,
  多于: undefined,
  多於: undefined,
  ">": undefined,
  "<": undefined,
};
const SUFFIX_OPERATORS: Record<string, NumericSpecConstraint["operator"]> = {
  以上: "gte",
  起: "gte",
  以下: "lte",
  以内: "lte",
  以內: "lte",
};
const units: Array<[string[], string, number]> = [
  [["g", "克"], "mass", 1],
  [["kg", "公斤", "千克"], "mass", 1000],
  [["mg", "毫克"], "mass", 0.001],
  [["mm", "毫米"], "length", 1],
  [["cm", "厘米"], "length", 10],
  [["m", "米"], "length", 1000],
  [["km", "千米"], "length", 1000000],
  [["inch", "英寸"], "length", 25.4],
  [["ml", "毫升"], "volume", 1],
  [["l", "升"], "volume", 1000],
  [["mah", "毫安时", "毫安時"], "charge", 1],
  [["ah"], "charge", 1000],
  [["w", "瓦"], "power", 1],
  [["kw", "千瓦"], "power", 1000],
  [["wh"], "energy", 1],
  [["kwh"], "energy", 1000],
  [["s", "秒"], "time", 1],
  [["min", "分钟", "分鐘"], "time", 60],
  [["h", "小时", "小時"], "time", 3600],
  [["hz"], "frequency", 1],
  [["khz"], "frequency", 1000],
  [["mb"], "storage", 1],
  [["gb"], "storage", 1024],
  [["tb"], "storage", 1024 * 1024],
];
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const alternatives = (items: string[]) =>
  `(?:${items
    .sort((a, b) => b.length - a.length)
    .map(escapePattern)
    .join("|")})`;
const NUMERIC_PREFIX_PATTERN = alternatives(Object.keys(PREFIX_OPERATORS));
const NUMERIC_SUFFIX_PATTERN = alternatives(Object.keys(SUFFIX_OPERATORS));
const MEASUREMENT_UNIT_PATTERN = `(?:[a-zA-Z]+|${alternatives(units.flatMap(([aliases]) => aliases).filter((unit) => !/^[a-z]+$/u.test(unit)))}|[%℃℉]|°[CF])`;
const SIGNED_VALUE_PATTERN = String.raw`[-−－]?${NUMERIC_VALUE_PATTERN}`;
const scalarPattern = (unitRequired: boolean) =>
  String.raw`(?:(?<prefix>${NUMERIC_PREFIX_PATTERN})\s*)?(?<number>${SIGNED_VALUE_PATTERN})\s*(?<unit>${MEASUREMENT_UNIT_PATTERN})${unitRequired ? "" : "?"}(?:\s*(?<suffix>${NUMERIC_SUFFIX_PATTERN}))?`;

export function normalizeMeasurement(
  value: number,
  unit: string
): { value: number; dimension: string } {
  const normalized = unit.toLowerCase().trim();
  const found = units.find(([aliases]) => aliases.includes(normalized));
  return found
    ? { value: value * found[2], dimension: found[1] }
    : { value, dimension: normalized };
}
export function isKnownMeasurementUnit(unit: string): boolean {
  return (
    units.some(([aliases]) => aliases.includes(unit.toLowerCase().trim())) ||
    ["%", "℃", "℉", "°c", "°f"].includes(unit.toLowerCase().trim())
  );
}

// 保守解析明确数字；省略位数的“一万二”及负数返回 undefined。
export function parseNumericValue(source: string): number | undefined {
  const text = source.replace(/\s+/gu, "");
  if (/^\d+(?:\.\d+)?[万萬]?$/u.test(text)) {
    const value = Number(text.replace(/[万萬]/u, "")) * (/[万萬]$/u.test(text) ? 10000 : 1);
    return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
  }
  if (
    !/^[零〇一二两兩三四五六七八九十百千万萬]+$/u.test(text) ||
    (text.match(/[万萬]/gu)?.length ?? 0) > 1 ||
    (!/[十百千万萬]/u.test(text) && text.length > 1) ||
    /[一二两兩三四五六七八九]{2}|[零〇]{2}|[零〇][十百千万萬]/u.test(text) ||
    /[万萬千百][一二两兩三四五六七八九]$/u.test(text)
  )
    return undefined;
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const scales: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000, 萬: 10000 };
  let total = 0,
    section = 0,
    digit = 0,
    previousScale = Infinity;
  for (const character of text) {
    if (character in digits) {
      digit = digits[character];
      continue;
    }
    const scale = scales[character];
    if (scale === 10000) {
      total += (section + digit || 1) * scale;
      section = 0;
      previousScale = Infinity;
    } else {
      if (scale >= previousScale) return undefined;
      section += (digit || 1) * scale;
      previousScale = scale;
    }
    digit = 0;
  }
  return total + section + digit;
}

function parseNumericOperator(
  prefix = "",
  suffix = "",
  fallback: NumericSpecConstraint["operator"] = "eq"
): NumericSpecConstraint["operator"] | undefined {
  const before = prefix ? PREFIX_OPERATORS[prefix] : undefined;
  const after = suffix ? SUFFIX_OPERATORS[suffix] : undefined;
  if ((prefix && !before) || (suffix && !after) || (before && after && before !== after))
    return undefined;
  return before ?? after ?? fallback;
}

export type NumericExpression = {
  start: number;
  end: number;
  raw: string;
  value?: number;
  unit: string;
  operator?: NumericSpecConstraint["operator"];
};

function hasNumericBoundary(text: string, start: number): boolean {
  // 防止从畸形小数、中文数字串、重复符号中截取一段数字；不维护否定语义词表。
  return !/[\d.零〇一二两兩三四五六七八九十百千万萬−－<>≤≥=-]$/u.test(text.slice(0, start));
}

export function readNumericExpressions(text: string): NumericExpression[] {
  const rangeExpression = new RegExp(
    String.raw`(?<low>${SIGNED_VALUE_PATTERN})\s*(?<lowUnit>${MEASUREMENT_UNIT_PATTERN})?\s*(?:到|至|[-–—~～])\s*(?<high>${SIGNED_VALUE_PATTERN})\s*(?<highUnit>${MEASUREMENT_UNIT_PATTERN})`,
    "giu"
  );
  const ranges = [...text.matchAll(rangeExpression)];
  const result: NumericExpression[] = [];
  for (const match of ranges) {
    const parts = match.groups!;
    const low = parseNumericValue(parts.low),
      high = parseNumericValue(parts.high);
    const lowUnit = parts.lowUnit || parts.highUnit;
    const a = low === undefined ? undefined : normalizeMeasurement(low, lowUnit);
    const b = high === undefined ? undefined : normalizeMeasurement(high, parts.highUnit);
    const sharedScale = !parts.lowUnit && !/[万萬]/u.test(parts.low) && /[万萬]/u.test(parts.high);
    const valid =
      !!a &&
      !!b &&
      a.dimension === b.dimension &&
      a.value <= b.value &&
      !sharedScale &&
      hasNumericBoundary(text, match.index);
    const span = { start: match.index, end: match.index + match[0].length, raw: match[0] };
    result.push({
      ...span,
      value: valid ? low : undefined,
      unit: lowUnit,
      operator: valid ? "gte" : undefined,
    });
    result.push({
      ...span,
      value: valid ? high : undefined,
      unit: parts.highUnit,
      operator: valid ? "lte" : undefined,
    });
  }
  for (const match of text.matchAll(new RegExp(scalarPattern(true), "giu"))) {
    if (
      ranges.some(
        (range) => match.index >= range.index && match.index < range.index + range[0].length
      )
    )
      continue;
    const parts = match.groups!;
    const valid = hasNumericBoundary(text, match.index);
    result.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      value: valid ? parseNumericValue(parts.number) : undefined,
      unit: parts.unit,
      operator: valid ? parseNumericOperator(parts.prefix, parts.suffix) : undefined,
    });
  }
  return result.sort((a, b) => a.start - b.start);
}

export function parseNumericReply(
  text: string,
  defaults: { unit: string; operator: NumericSpecConstraint["operator"] }
): { value: number; unit: string; operator: NumericSpecConstraint["operator"] } | undefined {
  const match = normalizeCommandText(text).match(
    new RegExp(String.raw`^${scalarPattern(false)}\s*(?:就行|就可以|可以|即可)?$`, "iu")
  );
  if (!match) return undefined;
  const parts = match.groups!;
  const value = parseNumericValue(parts.number),
    unit = parts.unit || defaults.unit;
  const operator = parseNumericOperator(parts.prefix, parts.suffix, defaults.operator);
  if (
    value === undefined ||
    operator === undefined ||
    normalizeMeasurement(1, unit).dimension !== normalizeMeasurement(1, defaults.unit).dimension
  )
    return undefined;
  return { value, unit, operator };
}

export function readMeasurements(text: string): Array<{ value: number; dimension: string }> {
  return readNumericExpressions(text).flatMap((item) =>
    item.value === undefined ? [] : [normalizeMeasurement(item.value, item.unit)]
  );
}
