import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default function OrdersPage() {
  return (
    <PageShell
      eyebrow="M6 我的订单"
      title="订单"
      description="履约、物流、结算和退款状态将分别展示。"
    >
      <PlaceholderCard
        title="暂无订单数据"
        description="订单列表和状态筛选将在订单模块实现后接入。"
        actionHref="/"
        actionLabel="去逛商品"
      />
    </PageShell>
  );
}
