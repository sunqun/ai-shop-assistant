"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LanguageSelector } from "@/components/language-provider";
import { LoginButton } from "@/components/auth-provider";
import { CartCount } from "@/components/cart-count";
import { Check, ShoppingCart, Store, Tag } from "lucide-react";

type PromotionRule = { id: string; label: string; status: "configured" | "needs_human_review" };

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [promotionRules, setPromotionRules] = useState<PromotionRule[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/store-config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() as Promise<{ promotionRules?: PromotionRule[] }> : Promise.reject(new Error("store config request failed"))))
      .then((config) => {
        if (active) setPromotionRules(Array.isArray(config.promotionRules) ? config.promotionRules : []);
      })
      .catch(() => {
        if (active) setPromotionRules([]);
      });
    return () => { active = false; };
  }, []);

  const isActive = (route: string) =>
    route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <button className="brand" type="button" onClick={() => router.push("/")}>
          <Store size={20} strokeWidth={2.2} aria-hidden="true" />
          <span>AI 商城</span>
        </button>
        <nav className="site-nav" aria-label="主导航">
          <button
            type="button"
            className={isActive("/") ? "is-active" : undefined}
            aria-current={isActive("/") ? "page" : undefined}
            onClick={() => router.push("/")}
          >
            商品
          </button>
          <button
            type="button"
            className={isActive("/account/orders") ? "is-active" : undefined}
            aria-current={isActive("/account/orders") ? "page" : undefined}
            onClick={() => router.push("/account/orders")}
          >
            订单
          </button>
          <button
            type="button"
            className={`cart-link${isActive("/cart") ? " is-active" : ""}`}
            data-cart-target
            aria-current={isActive("/cart") ? "page" : undefined}
            onClick={() => router.push("/cart")}
          >
            <ShoppingCart size={17} strokeWidth={2.1} aria-hidden="true" />
            <span>购物车</span>
            <CartCount />
          </button>
        </nav>
        <div className="site-header__actions">
          <LanguageSelector />
          <LoginButton />
        </div>
      </div>
      {pathname === "/" ? (
        <div className="site-header__promo" role="status" aria-label="当前优惠">
          <span className="site-header__promo-label"><Tag size={12} /> 本周优惠</span>
          {promotionRules.length ? (
            <div className="site-header__promo-list">
              {promotionRules.slice(0, 3).map((rule) => (
                <span key={rule.id} className="site-header__promo-item">
                  <Check size={11} strokeWidth={3} /> {rule.label}
                  {rule.status === "needs_human_review" ? <em>待确认</em> : null}
                </span>
              ))}
            </div>
          ) : <span className="site-header__promo-item">正在读取优惠信息…</span>}
        </div>
      ) : null}
    </header>
  );
}
