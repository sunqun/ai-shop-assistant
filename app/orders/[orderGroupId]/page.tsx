import Link from "next/link";
import { PageShell } from "@/components/page-shell";
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderGroupId: string }>;
}) {
  const { orderGroupId } = await params;
  return (
    <PageShell eyebrow="M5 订单履约" title="订单详情" description={`订单组：${orderGroupId}`}>
      <div className="layout-two-column">
        <div className="card">
          <h2>订单状态</h2>
          <div className="list">
            <div className="list-item">
              <div>
                <p className="list-item__title">履约状态</p>
                <p className="list-item__meta">等待订单数据</p>
              </div>
              <span className="tag">占位</span>
            </div>
            <div className="list-item">
              <div>
                <p className="list-item__title">结算状态</p>
                <p className="list-item__meta">收货后扣款流程未接入</p>
              </div>
              <span className="tag">占位</span>
            </div>
          </div>
        </div>
        <aside className="card stack">
          <Link className="button button--soft" href={`/orders/${orderGroupId}/result`}>
            查看订单回执
          </Link>
          <Link className="button button--ghost" href={`/orders/${orderGroupId}/logistics`}>
            查看物流
          </Link>
          <Link className="button button--ghost" href={`/orders/${orderGroupId}/returns`}>
            退货与退款
          </Link>
        </aside>
      </div>
    </PageShell>
  );
}
