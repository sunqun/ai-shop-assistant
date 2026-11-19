"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AssistantDocker } from "@/components/assistant-docker";
import type { CatalogCategory, CatalogProduct } from "../components/home/type";
import { addToCart, animateProductToCart } from "@/lib/cart-client/cart-client";
import { getCategoriesRequest, getProductsRequest } from "../components/home/api";
import { ArrowRight, Package, Search, Tags, X } from "lucide-react";
import { ProductCard } from "../components/home/productCard";
import { Header } from "../components/home/header";

const PAGE_SIZE = 20;

export default function HomePage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [productsState, setProductsState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const keyword = useDeferredValue(query);
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState("recommended");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const resultsScrollRef = useRef<HTMLDivElement>(null);

  /** 获取商品类目列表 */
  const getCategories = useCallback(async (): Promise<void> => {
    const result = await getCategoriesRequest();
    if (!result.success) return;
    setCategories(result.data?.categories || []);
  }, []);

  const categoryList = useMemo(() => {
    const total = categories.reduce((sum, item) => sum + item.count, 0);
    return [{ id: "", name: "全部商品", count: total }, ...categories];
  }, [categories]);

  // 获取商品列表
  useEffect(() => {
    let active = true;
    async function loadProducts() {
      setProductsState("loading");
      const result = await getProductsRequest({ categoryId, keyword });
      if (!active) return;
      if (!result.success) {
        setProductsState("error");
        return;
      }
      setProducts(result.data.products);
      setProductsState("ready");
    }
    loadProducts();
    return () => {
      active = false;
    };
  }, [categoryId, keyword, reload]);

  /** 对商品列表进行排序 */
  const sortedProducts = useMemo(() => {
    const result = [...products];
    if (sort === "price-low") return result.sort((a, b) => a.price - b.price);
    if (sort === "price-high") return result.sort((a, b) => b.price - a.price);
    if (sort === "rating") return result.sort((a, b) => b.rating - a.rating);
    return result;
  }, [products, sort]);

  /** 监听商品列表变化，重置可见商品数量 */
  useEffect(() => setVisibleCount(PAGE_SIZE), [categoryId, keyword, sort]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting)
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, sortedProducts.length));
      },
      { root: resultsScrollRef.current, rootMargin: "240px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [sortedProducts.length]);

  const visibleProducts = sortedProducts.slice(0, visibleCount);

  async function handleAdd(product: CatalogProduct) {
    if (!product.stock) return;
    const source = Array.from(document.querySelectorAll<HTMLElement>("[data-product-visual]")).find(
      (element) => element.dataset.productVisual === product.id
    );
    const target = document.querySelector<HTMLElement>("[data-cart-target]");
    setAddingId(product.id);
    try {
      const result = await addToCart(
        { id: product.id, quantity: 1, sku: product.id },
        product.stock
      );
      if (!result.success) return;
      setAddedId(product.id);
      if (source && target) animateProductToCart(source, target);
      window.setTimeout(() => setAddedId((id) => (id === product.id ? null : id)), 1800);
    } finally {
      setAddingId(null);
    }
  }

  useEffect(() => {
    getCategories();
  }, [getCategories]);

  return (
    <div className="shop-home">
      <div className="shop-home__content">
        <Header />
        <div className="shop-body">
          <aside className="shop-filters" aria-label="商品筛选">
            <div className="shop-filter-group">
              <span className="shop-filter-label">
                <Tags size={14} />
                品类
              </span>
              {categoryList.map((item) => (
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
                <span className="results-header__title">
                  <Package size={15} />
                  商品
                </span>
              </div>
              <label className="shop-search">
                <span className="sr-only">搜索商品</span>
                <Search size={16} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索商品名称"
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
              {productsState === "ready" && visibleProducts.length < sortedProducts.length
                ? "继续下拉加载更多"
                : ""}
            </div>
          </div>
        </div>
      </div>
      {/* 助手dock */}
      <AssistantDocker embedded />
    </div>
  );
}
