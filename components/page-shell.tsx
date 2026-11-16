"use client";

import { useRouter } from "next/navigation";

type PageShellProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
};

export function PageShell({ eyebrow, title, description, children }: PageShellProps) {
  const router = useRouter();
  return (
    <div>
      <div className="page-heading">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        <button className="button button--ghost" type="button" onClick={() => router.push("/")}>
          返回首页
        </button>
      </div>
      {children}
    </div>
  );
}

export function PlaceholderCard({
  title,
  description,
  actionHref = "/",
  actionLabel = "查看入口",
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const router = useRouter();
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      <button className="button button--soft" type="button" onClick={() => router.push(actionHref)}>
        {actionLabel}
      </button>
    </div>
  );
}
