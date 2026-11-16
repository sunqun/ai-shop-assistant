"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantDock } from "@/components/assistant-dock";
import type { CatalogProduct } from "@/lib/catalog";

const PAGE_SIZE = 20;
const categoryTone: Record<string, string> = {
  "全部商品": "all",
  "3C 配件": "office",
  "居家生活": "home",
  "美妝保養": "media",
  "運動戶外": "fitness",
  "食品飲料": "kitchen",
};

type PromotionRule = {
  id: string;
  label: string;
  status: "configured" | "needs_human_review";
};

function addToCart(product: CatalogProduct) {
  let current: Array<{ id: string; quantity: number; sku?: string }> = [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem("ai-shop-cart") || "[]");
    if (Array.isArray(parsed)) current = parsed;
  } catch {
    current = [];
  }
  const existing = current.find((item) => item.id === product.id);
  const reachedLimit = existing ? existing.quantity >= product.stock : false;
  if (existing) existing.quantity = Math.min(existing.quantity + 1, product.stock);
  else current.push({ id: product.id, quantity: 1, sku: Object.keys(product.specs)[0] });
  window.localStorage.setItem("ai-shop-cart", JSON.stringify(current));
  window.dispatchEvent(new CustomEvent("cart-updated"));
  return !reachedLimit;
}

export default function HomePage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [productsState, setProductsState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部商品");
  const [sort, setSort] = useState("recommended");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [addMessage, setAddMessage] = useState("");
  const [promotionRules, setPromotionRules] = useState<PromotionRule[]>([]);
  const [promotionState, setPromotionState] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/store-config", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("store config request failed");
        return response.json() as Promise<{ promotionRules?: PromotionRule[] }>;
      })
      .then((config) => {
        if (!active) return;
        setPromotionRules(Array.isArray(config.promotionRules) ? config.promotionRules : []);
        setPromotionState("ready");
      })
      .catch(() => {
        if (active) setPromotionState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setProductsState("loading");
    fetch("/api/v1/products", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("products request failed");
        return response.json() as Promise<{ products?: CatalogProduct[] }>;
      })
      .then((data) => {
        if (!active) return;
        setProducts(Array.isArray(data.products) ? data.products : []);
        setProductsState("ready");
      })
      .catch(() => {
        if (active) setProductsState("error");
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const categories = useMemo(
    () => ["全部商品", ...Array.from(new Set(products.map((product) => product.category)))],
    [products]
  );

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = products.filter((product) => {
      const matchesCategory = category === "全部商品" || product.category === category;
      const matchesQuery =
        !normalized ||
        `${product.name} ${product.brand} ${product.description} ${product.category}`
          .toLowerCase()
          .includes(normalized);
      return matchesCategory && matchesQuery;
    });
    if (sort === "price-low") return [...result].sort((a, b) => a.price - b.price);
    if (sort === "price-high") return [...result].sort((a, b) => b.price - a.price);
    if (sort === "rating") return [...result].sort((a, b) => b.rating - a.rating);
    return result;
  }, [products, category, query, sort]);

  useEffect(() => setVisibleCount(PAGE_SIZE), [category, query, sort]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting)
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, filteredProducts.length));
      },
      { rootMargin: "240px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredProducts.length]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  function handleAdd(product: CatalogProduct) {
    if (!product.stock) return;
    const added = addToCart(product);
    setAddedId(product.id);
    setAddMessage(added ? `${product.name} 已加入购物车` : `${product.name} 已达到库存上限`);
    window.setTimeout(() => setAddedId((id) => (id === product.id ? null : id)), 1800);
  }

  return (
    <div className="shop-home">
      <div className="shop-home__content">
        <div className="sr-only" role="status" aria-live="polite">{addMessage}</div>
        <div className="promo-strip" role="status" aria-live="polite">
          <span className="promo-strip__dot" aria-hidden="true" />
          <div className="promo-strip__content">
            <strong>优惠规则</strong>
            {promotionState === "loading" ? <span>正在读取最新配置...</span> : null}
            {promotionState === "error" ? <span>优惠规则暂时无法加载，请稍后重试。</span> : null}
            {promotionState === "ready" && promotionRules.length ? (
              <div className="promo-strip__rules">
                {promotionRules.map((rule) => (
                  <span className="promo-rule" key={rule.id}>
                    {rule.label}
                    {rule.status === "needs_human_review" ? <em>待确认结算口径</em> : null}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="shop-toolbar">
          <label className="shop-search">
            <span className="sr-only">搜索商品</span>
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索商品名称、品类或关键词"
            />
          </label>
          <button
            className="clear-filter clear-filter--toolbar"
            type="button"
            onClick={() => {
              setCategory("全部商品");
              setQuery("");
              setSort("recommended");
            }}
          >
            清除筛选
          </button>
        </div>
        <div className="shop-body">
          <aside className="shop-filters" aria-label="商品筛选">
            <div className="shop-filter-group">
              <span className="shop-filter-label">品类</span>
              {categories.map((item) => (
                <button
                  key={item}
                  className={category === item ? "shop-filter is-active" : "shop-filter"}
                  type="button"
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </aside>
          <div className="shop-results">
            <div className="results-header">
              <span>商品列表</span>
              <label className="shop-sort">
                <span className="sr-only">排序</span>
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="recommended">推荐排序</option>
                  <option value="rating">评分优先</option>
                  <option value="price-low">价格由低到高</option>
                  <option value="price-high">价格由高到低</option>
                </select>
              </label>
            </div>
            {productsState === "loading" ? (
              <div className="empty-state">
                <h2>正在加载商品...</h2>
              </div>
            ) : productsState === "error" ? (
              <div className="empty-state">
                <h2>商品暂时无法加载</h2>
                <p>请稍后重试。</p>
                <button
                  className="button button--soft"
                  type="button"
                  onClick={() => setReload((count) => count + 1)}
                >
                  重新加载
                </button>
              </div>
            ) : visibleProducts.length ? (
              <div className="product-grid">
                {visibleProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    added={addedId === product.id}
                    onAdd={handleAdd}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h2>没有找到匹配商品</h2>
                <p>尝试调整关键词或清除筛选条件。</p>
                <button
                  className="button button--soft"
                  type="button"
                  onClick={() => {
                    setCategory("全部商品");
                    setQuery("");
                  }}
                >
                  清除筛选
                </button>
              </div>
            )}
            <div ref={loadMoreRef} className="load-more" aria-live="polite">
              {productsState === "ready" && visibleProducts.length < filteredProducts.length
                ? "继续下拉加载更多"
                : ""}
            </div>
          </div>
        </div>
      </div>
      <AssistantDock embedded />
    </div>
  );
}

function ProductCard({
  product,
  added,
  onAdd,
}: {
  product: CatalogProduct;
  added: boolean;
  onAdd: (product: CatalogProduct) => void;
}) {
  const specs = Object.entries(product.specs);
  return (
    <article className={`product-tile${added ? " product-tile--added" : ""}`}>
      <div className="product-tile__body">
        <div className="product-tile__title-row">
          <h2 className="product-tile__name" title={product.name}>
            <Link href={`/products/${product.id}`} title={product.name}>
              {product.name}
            </Link>
            <span className={`category-badge category-badge--${categoryTone[product.category] || "all"}`}>
              {product.category}
            </span>
          </h2>
          <span className="rating">{product.rating ? `★ ${product.rating}` : "暂无评分"}</span>
        </div>
        <p>{product.description}</p>
        <div className="product-tile__specs">
          {specs.slice(0, 2).map(([key, value]) => (
            <span key={key}>{key}: {value}</span>
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
            className={added ? "button button--added" : "button button--primary"}
            type="button"
            disabled={!product.stock}
            onClick={() => onAdd(product)}
          >
            {added ? "已加入" : "加入购物车"}
          </button>
        </div>
      </div>
    </article>
  );
}
