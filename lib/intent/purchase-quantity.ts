import { parseNumericValue } from "@/lib/catalog/measurement";
import type { ProductSearchIntent } from "@/lib/catalog/types";

const QUANTITY_PATTERN = /([-−－]?\d+(?:\.\d+)?|[零〇一二两兩三四五六七八九十百千万萬]+)\s*(?:个|個|件|台|副|盒|包|瓶|套|支|枚|份|袋|双|雙)(?!套|装|裝|月|小时|小時)/gu;
// 只读取明确的件数，不从金额/规格数字猜购买数量；多组或否定件数交由用户澄清。
// 未提数量时保留 undefined，由任务默认1件；模型附带默认值1不要求用户补充。
export function validatePurchaseQuantity(intent: ProductSearchIntent, query: string): ProductSearchIntent {
  const matches = [...query.matchAll(QUANTITY_PATTERN)].filter((match) => {
    const before = query.slice(0, match.index).split(/[，,。；;！？!?\n]/u).at(-1)?.trim() ?? "";
    return !before || /(?:买|買|购买|購買|想要|需要|要|来|來|订|訂|找|找一下|推荐|推薦|数量|數量|数量改成|數量改成|改成|改为|改為|改到|和|及|与|與|加上|还有|還有)\s*(?:一共|总共|總共|共|再)?$/u.test(before) ||
      (/(?:到|至|[-~～])\s*$/u.test(before) && /(?:买|買|要|找|推荐|推薦|数量|數量)/u.test(before));
  });
  const unresolved = [...(intent.unresolvedConditions ?? [])];
  let quantity: number | undefined;
  if (matches.length === 1) {
    const match = matches[0];
    const clause = query.slice(0, match.index).split(/[，,。；;！？!?\n]/u).at(-1) ?? "";
    const value = parseNumericValue(match[1]);
    const suffix = query.slice(match.index + match[0].length).trimStart();
    if (value !== undefined && Number.isSafeInteger(value) && value >= 1 && value <= 99 &&
        !/(?:不要|不买|不買|别买|別買|至少|最多|大约|大約|不到|超过|超過)/u.test(clause) &&
        !/(?:到|至|[-~～])\s*$/u.test(clause) &&
        !/^(?:以上|以下|左右|以内|以內|起|到|至|[-~～])/u.test(suffix)) {
      quantity = value;
    } else unresolved.push(`请确认明确的购买数量（1–99件）：${match[0]}`);
  } else if (matches.length > 1) {
    unresolved.push("检测到多组购买数量，请一次说明一个商品及其明确件数。");
  } else if (intent.quantity !== undefined && intent.quantity !== 1) {
    unresolved.push("无法从本轮原话核实购买数量，请明确说明要买几件。");
  }
  return { ...intent, quantity, unresolvedConditions: unresolved };
}
