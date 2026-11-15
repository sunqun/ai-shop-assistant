import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default async function OrderReturnsPage({
  params,
}: {
  params: Promise<{ orderGroupId: string }>;
}) {
  const { orderGroupId } = await params;
  return (
    <PageShell eyebrow="M6 退货与退款" title="退货与退款" description={`订单组：${orderGroupId}`}>
      <PlaceholderCard
        title="退货申请占位"
        description="退货选择、运费影响、退款和额外应收将在后续实现。"
        actionHref={`/orders/${orderGroupId}`}
        actionLabel="返回订单详情"
      />
    </PageShell>
  );
}
