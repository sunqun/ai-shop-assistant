import type { ProductDifference } from "@/lib/catalog/types";

const FALLBACK_HINT =
  "这项要求暂时还无法全部满足，你可以查看商品详情，接受当前商品的话就确认下单";

export function differenceActual(difference: ProductDifference): string | undefined {
  const actual = difference.actual.trim();
  return actual &&
    // 历史购物任务持久化过旧提示，读取时仍需识别并隐藏。
    ![
      "现有商品信息无法核实该要求",
      "商品信息中缺少可核实的对应规格",
      "商品目录资料无法核实该要求",
      "目录中缺少可核实的对应规格",
    ].includes(actual)
    ? actual
    : undefined;
}

export function differenceHint(difference: ProductDifference): string {
  const requirement = difference.requirement.trim();
  if (difference.status === "not_met" && differenceActual(difference)) {
    return "这款商品与你的要求有以上差异。接受这个差异的话，可以确认下单。";
  }
  if (/^(?:价格合适|价格适中|价格合理|性价比高)[。！!]?$/u.test(requirement)) {
    return "可以看看上方报价，觉得合适就直接确认下单。";
  }
  if (
    /续航/u.test(requirement) &&
    /单次/u.test(difference.actual) &&
    /充电盒/u.test(difference.actual)
  ) {
    return "商品标注了单次续航和含充电盒续航，暂时不能确定是否符合你的续航要求，请查看上方具体规格。";
  }
  const feature = /^(?:支持|具备|带有|需要|要)?(主动降噪|降噪|防水|快充)[。！!]?$/u.exec(requirement)?.[1];
  if (feature) {
    return `暂时还不能确认这款商品是否支持${feature}。你可以查看商品详情，再决定是否下单。`;
  }
  return FALLBACK_HINT;
}
