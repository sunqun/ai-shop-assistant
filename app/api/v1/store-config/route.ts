import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    promotionRules: [
      {
        id: "threshold-discount",
        label: "商品金额满 NT$1,000 减 NT$100",
        status: "configured",
      },
      {
        id: "shipping-threshold",
        label: "商品金额满 NT$990 免运费，未达门槛运费 NT$100",
        status: "configured",
      },
      {
        id: "ai-order-discount",
        label: "AI 助理自动创建订单额外 95 折",
        status: "configured",
      },
    ],
    notice: "商品价格与库存以结账前最新状态为准。",
  });
}
