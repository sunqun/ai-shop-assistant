"use client";
import Link from "next/link";
import { use, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { getProduct } from "@/lib/products";
export default function ProductDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  const [added, setAdded] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [sku, setSku] = useState("");
  const product = getProduct(productId);
  if (!product)
    return (
      <PageShell eyebrow="M2 商品详情" title="商品不存在">
        <div className="empty-state">
          <p>这件商品可能已下架或链接已失效。</p>
          <Link className="button button--primary" href="/">
            返回商品列表
          </Link>
        </div>
      </PageShell>
    );
  const selectedProduct = product;
  function add() {
    let current: Array<{ id: string; quantity: number; sku?: string }> = [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem("ai-shop-cart") || "[]");
      if (Array.isArray(parsed)) current = parsed;
    } catch {
      current = [];
    }
    const selectedQuantity = Math.max(1, Math.min(quantity, selectedProduct.stock));
    const existing = current.find((item) => item.id === selectedProduct.id);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + selectedQuantity, selectedProduct.stock);
      existing.sku = sku || selectedProduct.specs[0];
    } else current.push({ id: selectedProduct.id, quantity: selectedQuantity, sku: sku || selectedProduct.specs[0] });
    window.localStorage.setItem("ai-shop-cart", JSON.stringify(current));
    window.dispatchEvent(new CustomEvent("cart-updated"));
    setAdded(true);
  }
  return (
    <PageShell eyebrow="M2 商品详情" title={product.name} description={product.description}>
      <div className="layout-two-column">
        <div className="card">
          <div
            className="product-card__image product-detail-visual"
            style={{ height: 300, background: product.accent }}
          >
            {product.name.slice(0, 1)}
          </div>
          <div className="section">
            <h2>商品信息</h2>
            <div className="product-detail-specs">
              {product.specs.map((spec) => (
                <span className="tag" key={spec}>
                  {spec}
                </span>
              ))}
            </div>
            <p className="muted">
              评分 {product.rating} · {product.reviews} 条公开评论 · {product.delivery}
            </p>
          </div>
        </div>
        <aside className="card stack">
          <div>
            <p className="eyebrow">当前售价</p>
            <p className="price product-detail-price">NT${product.price.toLocaleString()}</p>
            <p className="muted">
              <del>NT${product.originalPrice.toLocaleString()}</del> ·{" "}
              {product.stock ? `库存 ${product.stock}` : "暂时缺货"}
            </p>
          </div>
          <div className="field">
            <label htmlFor="sku">规格</label>
            <select id="sku" value={sku || product.specs[0]} onChange={(event) => setSku(event.target.value)}>
              {product.specs.map((spec) => (
                <option key={spec}>{spec}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="quantity">数量</label>
            <input
              id="quantity"
              type="number"
              min="1"
              max={product.stock || 1}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            />
          </div>
          <button
            className={added ? "button button--added" : "button button--primary"}
            onClick={add}
            disabled={!product.stock}
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
