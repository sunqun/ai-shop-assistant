import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default function RefundsPage() {
  return (
    <PageShell
      eyebrow="M6 退款与售后"
      title="退款与售后"
      description="退货申请、退款状态和额外应收将在后续实现。"
    >
      <PlaceholderCard
        title="暂无退款记录"
        description="退款列表和退货申请入口已预留。"
        actionHref="/account/orders"
        actionLabel="查看订单"
      />
    </PageShell>
  );
}
