"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { addToCart } from "@/lib/cart-client/cart-client";
import { showToast } from "@/lib/toast";
import type { CatalogProduct, CatalogReview } from "./type";
import { getProductDetailRequest } from "./api";
import { ProductGallery } from "./productGallery";
import { ProductInfo } from "./productInfo";
import { Reviews } from "./reviews";

export default function ProductDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const { productId } = use(searchParams);
  const router = useRouter();
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [reviews, setReviews] = useState<CatalogReview[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    setState("loading");
    setProduct(null);
    setReviews([]);
    setQuantity(1);
    setAdded(false);

    if (!productId) {
      setState("error");
      return () => {
        active = false;
      };
    }

    getProductDetailRequest(productId).then((result) => {
      if (!active) return;
      if (!result.success) {
        setState("error");
        return;
      }
      setProduct(result.data.product);
      setReviews(Array.isArray(result.data.reviews) ? result.data.reviews : []);
      setState("ready");
    });

    return () => {
      active = false;
    };
  }, [productId]);

  if (state === "loading") {
    return (
      <PageShell eyebrow="商品详情" title="正在加载">
        <div className="empty-state">
          <p>正在读取商品信息...</p>
        </div>
      </PageShell>
    );
  }

  if (state === "error" || !product) {
    return (
      <PageShell eyebrow="商品详情" title="加载失败">
        <div className="empty-state">
          <p>商品信息暂时无法加载，请稍后重试。</p>
          <button className="button button--primary" type="button" onClick={() => router.push("/")}>
            返回商品列表
          </button>
        </div>
      </PageShell>
    );
  }

  const currentProduct = product;

  async function add() {
    const selectedQuantity = Math.max(1, Math.min(quantity, currentProduct.stock));
    setAdding(true);
    try {
      const result = await addToCart(
        { id: currentProduct.id, quantity: selectedQuantity, sku: currentProduct.id },
        currentProduct.stock,
      );
      if (!result.success) return;
      setAdded(true);
      showToast(result.data.reachedLimit ? "已达到库存上限，已加入可用数量。" : "已加入购物车。", "success");
    } finally {
      setAdding(false);
    }
  }

  return (
    <PageShell eyebrow="商品详情" title={currentProduct.name} description={currentProduct.description}>
      <div className="product-detail">
        <ProductGallery product={currentProduct} />
        <ProductInfo
          product={currentProduct}
          quantity={quantity}
          added={added}
          adding={adding}
          onQuantityChange={setQuantity}
          onAdd={add}
        />
      </div>

      <Reviews reviews={reviews} />
    </PageShell>
  );
}
