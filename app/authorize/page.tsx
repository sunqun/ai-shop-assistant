import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default function AuthorizePage() { return <PageShell eyebrow="M1 授权确认" title="确认 AI 授权" description="AI 下单触发的补充授权页面入口。"><PlaceholderCard title="授权页面骨架" description="当前只展示入口，不读取或写入授权状态。" actionHref="/login" actionLabel="去登录" /></PageShell>; }
