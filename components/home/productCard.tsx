import { ShoppingCart, Star } from "lucide-react";
import { getIcon } from "@/lib/common/icon";
import { CatalogProduct } from "./type";
import { useRouter } from "next/navigation";

export function ProductCard({
  product,
  added,
  adding,
  onAdd,
}: {
  product: CatalogProduct;
  added: boolean;
  adding: boolean;
  onAdd: (product: CatalogProduct) => void | Promise<void>;
}) {
  const router = useRouter();
  const specs = Object.entries(product.specs);
  return (
    <article className={`product-tile${added ? " product-tile--added" : ""}`}>
      <ProductVisual product={product} />
      <div className="product-tile__body">
        <div className="product-tile__title-row">
          <h2 className="product-tile__name" title={product.name}>
            <a
              title={product.name}
              onClick={(event) => {
                event.preventDefault();
                router.push(`/products/detail?productId=${encodeURIComponent(product.id)}`);
              }}
            >
              {product.name}
            </a>
            <span className={`category-badge category-badge--${product.tone || "all"}`}>
              {product.category}
            </span>
          </h2>
          <span className="rating">
            {product.rating ? (
              <>
                <Star size={13} fill="currentColor" /> {product.rating}
              </>
            ) : (
              "暂无评分"
            )}
          </span>
        </div>
        <p>{product.description}</p>
        <div className="product-tile__specs">
          {specs.slice(0, 2).map(([key, value]) => (
            <span key={key}>
              {key}: {value}
            </span>
          ))}
        </div>
        <div className="product-tile__footer">
          <div>
            <strong className="price">NT${product.price.toLocaleString()}</strong>
            <span className={product.stock ? "stock stock--in" : "stock stock--out"}>
              {product.stock ? "有货" : "暂时缺货"}
            </span>
          </div>
          <button
            className={
              added
                ? "button button--primary product-tile__add-button product-tile__add-button--confirmed"
                : "button button--primary product-tile__add-button"
            }
            type="button"
            aria-label={`将 ${product.name} 加入购物车`}
            aria-busy={adding}
            disabled={!product.stock || adding}
            onClick={() => onAdd(product)}
          >
            {adding ? (
              <span className="button__spinner" aria-hidden="true" />
            ) : (
              <ShoppingCart size={17} />
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductVisual({ product }: { product: CatalogProduct }) {
  const tone = product.tone || "all";
  const Icon = getIcon(product.categoryId);
  return (
    <div
      className={`product-tile__visual product-tile__visual--${tone}`}
      data-product-visual={product.id}
      aria-hidden="true"
    >
      <span className="product-tile__visual-orbit" />
      <span className="product-tile__visual-icon">
        <Icon size={62} strokeWidth={1.35} />
      </span>
      <span className="product-tile__visual-label">{product.category}</span>
      <span className="product-tile__visual-brand">{product.brand}</span>
    </div>
  );
}
