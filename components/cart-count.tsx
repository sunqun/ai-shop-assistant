"use client";

import { useEffect, useState } from "react";

const CART_KEY = "ai-shop-cart";

function readCount() {
  try {
    const value = JSON.parse(window.localStorage.getItem(CART_KEY) || "[]");
    if (!Array.isArray(value)) return 0;
    return value.reduce((total, item) => total + (item && Number.isFinite(item.quantity) ? Math.max(0, Number(item.quantity)) : 0), 0);
  } catch {
    return 0;
  }
}

export function CartCount() {
  const [count, setCount] = useState(0);
  const [bumped, setBumped] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setCount((previous) => {
        const next = readCount();
        if (next !== previous) {
          setBumped(true);
          window.setTimeout(() => setBumped(false), 420);
        }
        return next;
      });
    };
    refresh();
    window.addEventListener("cart-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("cart-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return <span className={`badge${bumped ? " badge--bump" : ""}`} aria-label={`购物车 ${count} 件商品`}>{count}</span>;
}
