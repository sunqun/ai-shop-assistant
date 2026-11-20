import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import type { CatalogProduct } from "@/lib/catalog";
import { formatMoney } from "./format";

export function AssistantProductCard({ product }: { product: Partial<CatalogProduct> }) {
  const specs = Object.entries(product.specs ?? {}).filter(
    ([, value]) => typeof value === "string" && value.trim()
  );

  return (
    <div className="agent-product">
      <div className="agent-product__header">
        <ShoppingBag size={18} aria-hidden="true" />
        <div className="agent-product__identity">
          <strong className="agent-product__name">{product.name || "已选商品"}</strong>
          {product.brand || product.category ? (
            <div className="agent-product__meta">
              {product.brand ? <span>品牌：{product.brand}</span> : null}
              {product.category ? <span>分类：{product.category}</span> : null}
            </div>
          ) : null}
        </div>
        <strong className="agent-product__price">
          {formatMoney(product.price, product.currency)}
        </strong>
      </div>
      {product.description ? (
        <p className="agent-product__description">{product.description}</p>
      ) : null}
      {specs.length ? (
        <dl className="agent-product__specs">
          {specs.map(([name, value]) => (
            <div key={name}>
              {name}：{value}
            </div>
          ))}
        </dl>
      ) : null}
      <div className="agent-product__footer">
        <div className="agent-product__meta">
          <span>库存 {product.stock ?? "—"}</span>
          <span>
            {typeof product.rating === "number" && product.rating > 0
              ? `评分 ${product.rating} / 5`
              : "暂无评分"}
          </span>
          {typeof product.reviewCount === "number" ? (
            <span>{product.reviewCount} 条评价</span>
          ) : null}
        </div>
        {product.id ? (
          <Link href={`/products/detail?productId=${encodeURIComponent(product.id)}`}>
            查看完整详情
          </Link>
        ) : null}
      </div>
    </div>
  );
}
