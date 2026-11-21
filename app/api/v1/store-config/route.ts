import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    promotionRules: [
      {
        id: "threshold-discount",
        label: "商品金额满 NT$1,000 减 NT$100，每个账号限用一次",
        status: "configured",
      },
      {
        id: "shipping-threshold",
        label: "商品金额满 NT$990 免运费，未达门槛运费 NT$100",
        status: "configured",
      },
      {
        id: "ai-order-discount",
        label: "AI 对话页自动下单，满减后商品金额额外 95 折",
        status: "configured",
      },
    ],
  });
}
