"use client";

import { useRouter, usePathname } from "next/navigation";
import { LanguageSelector } from "@/components/language-provider";
import { LoginButton } from "@/components/auth-provider";
import { CartCount } from "@/components/cart-count";

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();

  const isActive = (route: string) =>
    route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <button className="brand" type="button" onClick={() => router.push("/")}>
          AI 商城
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
            aria-current={isActive("/cart") ? "page" : undefined}
            onClick={() => router.push("/cart")}
          >
            购物车 <CartCount />
          </button>
        </nav>
        <div className="site-header__actions">
          <LanguageSelector />
          <LoginButton />
        </div>
      </div>
    </header>
  );
}
