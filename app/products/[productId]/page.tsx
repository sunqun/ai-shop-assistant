"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import type { CatalogProduct } from "@/lib/catalog";

export default function ProductDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/v1/products/${productId}`, { cache: "no-store" });
        if (!active) return;
        if (response.status === 404) {
          setState("notfound");
          return;
        }
        if (!response.ok) throw new Error("product request failed");
        const data = (await response.json()) as { product: CatalogProduct };
        if (!active) return;
        setProduct(data.product);
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    }
    setState("loading");
    setProduct(null);
    setQuantity(1);
    setAdded(false);
    load();
    return () => {
      active = false;
    };
  }, [productId]);

  if (state === "loading") {
    return (
      <PageShell eyebrow="商品详情" title="正在加载">
        <div className="empty-state">
          <p>正在读取商品信息...</p>
        </div>
      </PageShell>
    );
  }

  if (state === "notfound") {
    return (
      <PageShell eyebrow="商品详情" title="商品不存在">
        <div className="empty-state">
          <p>这件商品可能已下架或链接已失效。</p>
          <Link className="button button--primary" href="/">
            返回商品列表
          </Link>
        </div>
      </PageShell>
    );
  }

  if (state === "error" || !product) {
    return (
      <PageShell eyebrow="商品详情" title="加载失败">
        <div className="empty-state">
          <p>商品信息暂时无法加载，请稍后重试。</p>
          <Link className="button button--primary" href="/">
            返回商品列表
          </Link>
        </div>
      </PageShell>
    );
  }

  const currentProduct = product;

  function add() {
    let current: Array<{ id: string; quantity: number; sku?: string }> = [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem("ai-shop-cart") || "[]");
      if (Array.isArray(parsed)) current = parsed;
    } catch {
      current = [];
    }
    const selectedQuantity = Math.max(1, Math.min(quantity, currentProduct.stock));
    const firstSpec = Object.keys(currentProduct.specs)[0];
    const existing = current.find((item) => item.id === currentProduct.id);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + selectedQuantity, currentProduct.stock);
      existing.sku = firstSpec;
    } else {
      current.push({ id: currentProduct.id, quantity: selectedQuantity, sku: firstSpec });
    }
    window.localStorage.setItem("ai-shop-cart", JSON.stringify(current));
    window.dispatchEvent(new CustomEvent("cart-updated"));
    setAdded(true);
  }

  const specs = Object.entries(currentProduct.specs);

  return (
    <PageShell eyebrow="商品详情" title={currentProduct.name} description={currentProduct.description}>
      <div className="layout-two-column">
        <div className="card">
          <div
            className="product-card__image product-detail-visual"
            style={{ height: 300, background: "#eef2f7" }}
          >
            {currentProduct.name.slice(0, 1)}
          </div>
          <div className="section">
            <h2>商品信息</h2>
            <div className="product-detail-specs">
              {specs.map(([key, value]) => (
                <span className="tag" key={key}>
                  {key}: {value}
                </span>
              ))}
            </div>
            <p className="muted">
              {currentProduct.rating ? `评分 ${currentProduct.rating} · ` : ""}
              {currentProduct.reviewCount} 条公开评论 ·{" "}
              {currentProduct.stock ? `库存 ${currentProduct.stock}` : "暂时缺货"}
            </p>
          </div>
        </div>
        <aside className="card stack">
          <div>
            <p className="eyebrow">当前售价</p>
            <p className="price product-detail-price">NT${currentProduct.price.toLocaleString()}</p>
            <p className="muted">
              {currentProduct.stock ? `库存 ${currentProduct.stock}` : "暂时缺货"}
            </p>
          </div>
          <div className="field">
            <label htmlFor="quantity">数量</label>
            <input
              id="quantity"
              type="number"
              min="1"
              max={currentProduct.stock || 1}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            />
          </div>
          <button
            className={added ? "button button--added" : "button button--primary"}
            onClick={add}
            disabled={!currentProduct.stock}
          >
            {added ? "已加入购物车" : "加入购物车"}
          </button>
          <Link className="button button--ghost" href="/">
            返回商品列表
          </Link>
        </aside>
      </div>
    </PageShell>
  );
}
