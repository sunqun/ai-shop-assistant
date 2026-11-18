"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantDock } from "@/components/assistant-dock";
import type { CatalogProduct } from "@/lib/catalog";
import { addToCart } from "@/lib/cart-client";
import { showToast } from "@/lib/toast";
import {
  AirVent,
  Activity,
  ArrowRight,
  Backpack,
  Coffee,
  Headphones,
  Keyboard,
  LampDesk,
  Package,
  Search,
  ShoppingCart,
  Sparkles,
  Star,
  Tags,
  Watch,
  X,
} from "lucide-react";

const PAGE_SIZE = 20;

export default function HomePage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [productsState, setProductsState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState("recommended");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const resultsScrollRef = useRef<HTMLDivElement>(null);

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
        if (active) {
          setProductsState("error");
          showToast("商品暂时无法加载，请稍后重试。");
        }
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const categories = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const product of products) {
      const current = seen.get(product.categoryId);
      seen.set(product.categoryId, current
        ? { ...current, count: current.count + 1 }
        : { id: product.categoryId, name: product.category, count: 1 });
    }
    return [{ id: "", name: "全部商品", count: products.length }, ...seen.values()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = products.filter((product) => {
      const matchesCategory = categoryId === "" || product.categoryId === categoryId;
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
  }, [products, categoryId, query, sort]);

  useEffect(() => setVisibleCount(PAGE_SIZE), [categoryId, query, sort]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting)
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, filteredProducts.length));
      },
      { root: resultsScrollRef.current, rootMargin: "240px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredProducts.length]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  async function handleAdd(product: CatalogProduct) {
    if (!product.stock) return;
    const source = Array.from(document.querySelectorAll<HTMLElement>("[data-product-visual]"))
      .find((element) => element.dataset.productVisual === product.id);
    const target = document.querySelector<HTMLElement>("[data-cart-target]");
    setAddingId(product.id);
    try {
      await addToCart(
        { id: product.id, quantity: 1, sku: product.id },
        product.stock,
      );
      setAddedId(product.id);
      if (source && target) animateProductToCart(source, target);
      window.setTimeout(() => setAddedId((id) => (id === product.id ? null : id)), 1800);
    } catch {
      showToast("加入购物车失败，请稍后重试。");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="shop-home">
      <div className="shop-home__content">
        <div className="shop-intro">
          <div>
            <p className="shop-intro__eyebrow">AI curated · everyday essentials</p>
            <h1>把日常好物，挑得更轻松</h1>
            <p className="shop-intro__copy">从实用配件到生活灵感，找到适合自己的选择。</p>
          </div>
          <div className="shop-intro__visual" aria-hidden="true">
            <span className="shop-intro__visual-orbit shop-intro__visual-orbit--one" />
            <span className="shop-intro__visual-orbit shop-intro__visual-orbit--two" />
            <span className="shop-intro__visual-icon"><ShoppingCart size={30} strokeWidth={1.7} /></span>
            <span className="shop-intro__visual-chip shop-intro__visual-chip--top"><Keyboard size={15} /> 3C 配件</span>
            <span className="shop-intro__visual-chip shop-intro__visual-chip--left"><LampDesk size={15} /> 居家生活</span>
            <span className="shop-intro__visual-chip shop-intro__visual-chip--right"><Coffee size={15} /> 食品飲料</span>
          </div>
        </div>
        <div className="shop-body">
          <aside className="shop-filters" aria-label="商品筛选">
            <div className="shop-filter-group">
              <span className="shop-filter-label">
                <Tags size={14} />
                品类
              </span>
              {categories.map((item) => (
                <button
                  key={item.id}
                  className={categoryId === item.id ? "shop-filter is-active" : "shop-filter"}
                  type="button"
                  onClick={() => setCategoryId(item.id)}
                >
                  {item.name}
                  <span className="shop-filter__count">{item.count}</span>
                  {categoryId === item.id ? (
                    <ArrowRight size={15} className="shop-filter__check" />
                  ) : null}
                </button>
              ))}
            </div>
          </aside>
          <div className="shop-results" ref={resultsScrollRef}>
            <div className="results-header">
              <div className="results-header__heading">
                <span className="results-header__title"><Package size={15} />商品</span>
              </div>
              <label className="shop-search">
                <span className="sr-only">搜索商品</span>
                <Search size={16} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索商品名称、品类或关键词"
                />
                {query ? (
                  <button
                    className="shop-search__clear"
                    type="button"
                    aria-label="清除搜索"
                    onClick={() => setQuery("")}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </label>
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
                <h2>正在加载商品…</h2>
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
                    adding={addingId === product.id}
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
                    setCategoryId("");
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
              href={`/products/detail?productId=${encodeURIComponent(product.id)}`}
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
            className={added ? "button button--primary product-tile__add-button product-tile__add-button--confirmed" : "button button--primary product-tile__add-button"}
            type="button"
            aria-label={`将 ${product.name} 加入购物车`}
            aria-busy={adding}
            disabled={!product.stock || adding}
            onClick={() => onAdd(product)}
          >
            {adding ? <span className="button__spinner" aria-hidden="true" /> : <ShoppingCart size={17} />}
            <span>{adding ? "加入中" : "加入购物车"}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductVisual({ product }: { product: CatalogProduct }) {
  const tone = product.tone || "all";
  const Icon = product.categoryId === "3c-accessories"
    ? Keyboard
    : product.categoryId === "home-living"
      ? LampDesk
      : product.categoryId === "beauty"
        ? Sparkles
        : product.categoryId === "sports-outdoor"
          ? Activity
          : product.categoryId === "food-drink"
            ? Coffee
            : product.categoryId.includes("media")
              ? Headphones
              : product.categoryId.includes("travel")
                ? Backpack
                : product.categoryId.includes("kitchen")
                  ? AirVent
                  : product.categoryId.includes("home")
                    ? LampDesk
                    : product.categoryId.includes("fitness")
                      ? Watch
                      : Package;
  return (
    <div
      className={`product-tile__visual product-tile__visual--${tone}`}
      data-product-visual={product.id}
      aria-hidden="true"
    >
      <span className="product-tile__visual-orbit" />
      <span className="product-tile__visual-icon"><Icon size={62} strokeWidth={1.35} /></span>
      <span className="product-tile__visual-label">{product.category}</span>
      <span className="product-tile__visual-brand">{product.brand}</span>
    </div>
  );
}

function animateProductToCart(source: HTMLElement, target: HTMLElement) {
  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  const width = Math.min(118, Math.max(76, sourceRect.width * 0.32));
  const height = Math.min(76, Math.max(52, sourceRect.height * 0.42));
  ghost.className = `${source.className} cart-flight`;
  ghost.removeAttribute("data-product-visual");
  ghost.style.setProperty("--flight-start-x", `${sourceRect.left + sourceRect.width / 2 - width / 2}px`);
  ghost.style.setProperty("--flight-start-y", `${sourceRect.top + sourceRect.height / 2 - height / 2}px`);
  ghost.style.setProperty("--flight-x", `${targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2)}px`);
  ghost.style.setProperty("--flight-y", `${targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2)}px`);
  ghost.style.setProperty("--flight-width", `${width}px`);
  ghost.style.setProperty("--flight-height", `${height}px`);
  document.body.appendChild(ghost);
  window.requestAnimationFrame(() => ghost.classList.add("cart-flight--active"));
  window.setTimeout(() => ghost.remove(), 680);
}
