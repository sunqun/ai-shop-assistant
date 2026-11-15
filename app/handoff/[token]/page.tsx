import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default async function HandoffPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <PageShell eyebrow="长期交接入口" title="安全交接" description={`交接标识：${token}`}>
      <PlaceholderCard
        title="交接页面骨架"
        description="当前不交换 token、不建立受限会话。"
        actionHref="/login"
        actionLabel="去登录"
      />
    </PageShell>
  );
}
