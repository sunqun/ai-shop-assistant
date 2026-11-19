import type { CatalogProduct } from "./type";

export function ProductInfo({
  product,
  quantity,
  added,
  adding,
  onQuantityChange,
  onAdd,
}: {
  product: CatalogProduct;
  quantity: number;
  added: boolean;
  adding: boolean;
  onQuantityChange: (quantity: number) => void;
  onAdd: () => void;
}) {
  return (
    <aside className="card product-detail__info">
      <div className="product-detail__meta">
        <span className={`category-badge category-badge--${product.tone || "all"}`}>
          {product.category}
        </span>
        <span className="product-detail__rating" aria-label={`评分 ${product.rating || "暂无"}`}>
          {product.rating ? "★".repeat(Math.round(product.rating)) : "暂无评分"}
          {product.rating ? <em>{product.rating}</em> : null}
        </span>
        <span className="muted">{product.reviewCount} 条评论</span>
      </div>

      <div className="product-detail__price-row">
        <span className="product-detail__price">NT${product.price.toLocaleString()}</span>
        <span className={product.stock ? "stock stock--in" : "stock stock--out"}>
          {product.stock ? `库存 ${product.stock} 件` : "暂时缺货"}
        </span>
      </div>

      <div className="field">
        <label htmlFor="quantity">购买数量</label>
        <input
          id="quantity"
          type="number"
          min="1"
          max={product.stock || 1}
          value={quantity}
          onChange={(event) => onQuantityChange(Math.max(1, Number(event.target.value) || 1))}
        />
      </div>

      <button
        className={added ? "button button--added" : "button button--primary"}
        onClick={onAdd}
        disabled={!product.stock || adding}
      >
        {adding ? "处理中…" : added ? "已加入购物车" : "加入购物车"}
      </button>

      <ul className="product-detail__facts">
        <li><span>品牌</span><strong>{product.brand || "品牌信息待补充"}</strong></li>
        <li><span>品类</span><strong>{product.category}</strong></li>
        <li><span>商品编号</span><strong>{product.id}</strong></li>
      </ul>
    </aside>
  );
}
