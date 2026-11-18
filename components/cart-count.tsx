"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { fetchCart } from "@/lib/cart-client";

export function CartCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const [bumped, setBumped] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setCount(0);
      return;
    }
    try {
      const cart = await fetchCart();
      const next = cart.items.reduce(
        (total, item) => total + Math.max(0, item.requestedQuantity),
        0
      );
      setCount((previous) => {
        if (next !== previous) {
          setBumped(true);
          window.setTimeout(() => setBumped(false), 420);
        }
        return next;
      });
    } catch {
      setCount(0);
    }
  }, [user]);

  useEffect(() => {
    refresh();
    window.addEventListener("cart-updated", refresh);
    return () => window.removeEventListener("cart-updated", refresh);
  }, [refresh]);

  return (
    <span className={`badge${bumped ? " badge--bump" : ""}`} aria-label={`购物车 ${count} 件商品`}>
      {count}
    </span>
  );
}
