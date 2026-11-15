import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default async function OrderLogisticsPage({
  params,
}: {
  params: Promise<{ orderGroupId: string }>;
}) {
  const { orderGroupId } = await params;
  return (
    <PageShell eyebrow="M6 订单物流" title="订单物流" description={`订单组：${orderGroupId}`}>
      <PlaceholderCard
        title="物流轨迹占位"
        description="包裹、子订单和脱敏运单轨迹将在后续接入。"
        actionHref={`/orders/${orderGroupId}`}
        actionLabel="返回订单详情"
      />
    </PageShell>
  );
}
