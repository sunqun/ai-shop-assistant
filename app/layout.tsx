import type { Metadata } from "next";
import Link from "next/link";
import { LanguageProvider, LanguageSelector } from "@/components/language-provider";
import { AuthProvider, LoginButton } from "@/components/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 商城",
  description: "AI 商城网页应用骨架",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW">
      <body>
        <LanguageProvider>
          <AuthProvider>
            <header className="site-header">
              <div className="site-header__inner">
                <Link className="brand" href="/">
                  AI 商城
                </Link>
                <nav className="site-nav" aria-label="主导航">
                  <Link href="/">商品</Link>
                  <Link href="/cart">购物车</Link>
                  <Link href="/account">我的</Link>
                </nav>
                <div className="site-header__actions">
                  <LanguageSelector />
                  <LoginButton />
                  <Link className="cart-link" href="/cart">
                    购物车 <span className="badge">0</span>
                  </Link>
                </div>
              </div>
            </header>
            <main className="site-main">{children}</main>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
