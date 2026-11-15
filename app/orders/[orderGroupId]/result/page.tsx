import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default async function OrderResultPage({
  params,
}: {
  params: Promise<{ orderGroupId: string }>;
}) {
  const { orderGroupId } = await params;
  return (
    <PageShell eyebrow="M5 订单回执" title="订单回执" description={`订单组：${orderGroupId}`}>
      <PlaceholderCard
        title="订单回执占位"
        description="当前不会创建真实订单，后续展示父订单、子订单和缺货项。"
        actionHref={`/orders/${orderGroupId}`}
        actionLabel="查看订单详情"
      />
    </PageShell>
  );
}
