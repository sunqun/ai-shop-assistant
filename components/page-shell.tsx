import Link from "next/link";

type PageShellProps = { eyebrow?: string; title: string; description?: string; children: React.ReactNode };

export function PageShell({ eyebrow, title, description, children }: PageShellProps) {
  return (
    <div>
      <div className="page-heading">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        <Link className="button button--ghost" href="/">返回首页</Link>
      </div>
      {children}
    </div>
  );
}

export function PlaceholderCard({ title, description, actionHref = "/products", actionLabel = "查看入口" }: { title: string; description: string; actionHref?: string; actionLabel?: string }) {
  return <div className="empty-state"><h2>{title}</h2><p>{description}</p><Link className="button button--soft" href={actionHref}>{actionLabel}</Link></div>;
}
