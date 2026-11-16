"use client";

import { useRouter } from "next/navigation";
import { LanguageSelector } from "@/components/language-provider";
import { LoginButton } from "@/components/auth-provider";
import { CartCount } from "@/components/cart-count";

export function SiteHeader() {
  const router = useRouter();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <button className="brand" type="button" onClick={() => router.push("/")}>
          AI 商城
        </button>
        <nav className="site-nav" aria-label="主导航">
          <button type="button" onClick={() => router.push("/")}>
            商品
          </button>
          <button type="button" onClick={() => router.push("/account")}>
            我的
          </button>
          <button className="cart-link" type="button" onClick={() => router.push("/cart")}>
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
