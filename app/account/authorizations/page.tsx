import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default function AuthorizationsPage() { return <PageShell eyebrow="M1 身份与 AI 授权" title="AI 授权管理" description="长期授权的查看、撤销和审计信息将在授权模块实现。"><PlaceholderCard title="暂无授权数据" description="授权状态和撤销操作已预留，当前不会产生任何授权。" actionHref="/login" actionLabel="返回登录" /></PageShell>; }
