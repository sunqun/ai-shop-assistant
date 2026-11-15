import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default function LogisticsPage() {
  return (
    <PageShell
      eyebrow="M6 我的物流"
      title="物流"
      description="包裹和脱敏运单信息将在物流服务接入后展示。"
    >
      <PlaceholderCard
        title="暂无物流记录"
        description="物流轨迹、包裹状态和订单关联页面已预留。"
        actionHref="/account/orders"
        actionLabel="查看订单"
      />
    </PageShell>
  );
}
