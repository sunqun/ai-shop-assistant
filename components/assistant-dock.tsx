"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { products } from "@/lib/products";

export function AssistantDock({ embedded = false }: { embedded?: boolean }) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [launcherPosition, setLauncherPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return products.filter(
      (product) =>
        !normalized ||
        `${product.name} ${product.category} ${product.description}`
          .toLowerCase()
          .includes(normalized)
    );
  }, [query]);
  const topThree = results.slice(0, 3);

  if (!open)
    return (
      <button
        className={`assistant-launcher${embedded ? " assistant-launcher--embedded" : ""}`}
        type="button"
        onClick={() => setOpen(true)}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          dragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          const size = 56;
          setLauncherPosition({
            x: Math.max(8, Math.min(window.innerWidth - size - 8, event.clientX - dragRef.current.offsetX)),
            y: Math.max(72, Math.min(window.innerHeight - size - 8, event.clientY - dragRef.current.offsetY)),
          });
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        }}
        style={launcherPosition ? { left: launcherPosition.x, top: launcherPosition.y, right: "auto", bottom: "auto" } : undefined}
        aria-label="打开 AI 购物助手"
      >
        <span aria-hidden="true">✦</span>
      </button>
    );
  return (
    <aside
      className={`assistant-dock${embedded ? " assistant-dock--embedded" : ""}`}
      aria-label="AI 购物助手"
    >
      <div className="assistant-dock__header">
        <div>
          <strong>AI 购物助手</strong>
          <span>描述需求，快速比较商品</span>
        </div>
        <button
          className="assistant-collapse"
          type="button"
          onClick={() => setOpen(false)}
          aria-label="收起 AI 购物助手"
        >
          −
        </button>
      </div>
      <div className="assistant-dock__body">
        <section className="assistant-comparison">
          <div className="assistant-section-heading">
            <h2>TOP {topThree.length} 比较</h2>
            <span>按当前搜索排序</span>
          </div>
          {topThree.length ? (
            <div className="comparison-list">
              {topThree.map((product, index) => (
                <Link href={`/products/${product.id}`} className="comparison-item" key={product.id}>
                  <span className="comparison-rank">0{index + 1}</span>
                  <span className="comparison-item__detail">
                    <strong>{product.name}</strong>
                    <small>
                      NT${product.price.toLocaleString()} · ★ {product.rating}
                    </small>
                    <small className="comparison-pro">优势：{product.specs[0]}</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="assistant-empty">输入关键词后展示可比较商品。</p>
          )}
        </section>
        <div className="assistant-results-heading">
          <span>搜索结果</span>
          <span>{results.length} 件命中</span>
        </div>
        <div className="assistant-dock__results">
          {results.length ? (
            results.map((product) => (
              <Link href={`/products/${product.id}`} className="assistant-result" key={product.id}>
                <span className="assistant-result__swatch" style={{ background: product.accent }}>
                  {product.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{product.name}</strong>
                  <small>
                    {product.category} · NT${product.price.toLocaleString()}
                  </small>
                </span>
              </Link>
            ))
          ) : (
            <p className="assistant-empty">暂无匹配结果，请换个关键词。</p>
          )}
        </div>
        <form className="assistant-composer" onSubmit={(event) => event.preventDefault()}>
          <label className="sr-only" htmlFor="assistant-query">
            描述你想找的商品
          </label>
          <input
            id="assistant-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：适合通勤的降噪耳机"
          />
          <button type="submit" aria-label="搜索">
            ↗
          </button>
        </form>
        <p className="assistant-disclaimer">比较信息来自公开商品字段，不展示内部推荐权重。</p>
      </div>
    </aside>
  );
}
