import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast-provider";

vi.mock("@/lib/cart-client/api", () => ({
  reconcileAiCartRequest: vi.fn(async () => ({
    success: true,
    data: {
      fullyOutOfStock: false,
      allocations: [{ allocatedQuantity: 1 }],
      cartVersion: 1,
    },
  })),
  quoteAiCartRequest: vi.fn(async () => ({
    success: true,
    data: { quote: { quoteId: "quote" } },
  })),
  submitAiOrderRequest: vi.fn(async () => ({
    success: true,
    data: { orderGroupId: "order" },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { AssistantDocker } from "@/components/assistant-docker";

const product = {
  id: "desk-kit",
  name: "Desk Kit",
  brand: "Test",
  category: "Office",
  description: "Desk kit",
  price: 100,
  currency: "TWD",
  stock: 5,
  rating: 4,
  reviewCount: 1,
  specs: {},
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("assistant inventory refresh", () => {
  it("shows processing only on the product whose payment was clicked", async () => {
    const secondProduct = { ...product, id: "coffee", name: "Coffee" };
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ products: [product, secondProduct] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "idempotency-key", getRandomValues: (value: Uint8Array) => value });
    vi.stubGlobal("localStorage", { getItem: () => "a".repeat(43), setItem: vi.fn() });

    render(<ToastProvider><AssistantDocker /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("描述你想找的商品"), { target: { value: "coffee" } });
    fireEvent.click(screen.getByRole("button", { name: "查找商品" }));
    const paymentButtons = await screen.findAllByRole("button", { name: "付款" });

    fireEvent.click(paymentButtons[0]);

    expect(screen.getByRole("button", { name: "处理中..." })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "付款" })).toHaveLength(1);
  });

  it("requests product details after order success and updates the result stock", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ products: [product] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ product: { ...product, stock: 4 }, reviews: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "idempotency-key", getRandomValues: (value: Uint8Array) => value });
    vi.stubGlobal("localStorage", { getItem: () => "a".repeat(43), setItem: vi.fn() });

    render(<ToastProvider><AssistantDocker /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("描述你想找的商品"), { target: { value: "desk kit" } });
    fireEvent.click(screen.getByRole("button", { name: "查找商品" }));
    fireEvent.click(await screen.findByRole("button", { name: "付款" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/products/detail?productId=desk-kit");
    expect(await screen.findByText("· 库存 4")).toBeInTheDocument();
    expect(await screen.findByText("订单编号：order")).toBeInTheDocument();
  });

  it("keeps the successful order result visible when stock refresh fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ products: [product] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "idempotency-key", getRandomValues: (value: Uint8Array) => value });
    vi.stubGlobal("localStorage", { getItem: () => "a".repeat(43), setItem: vi.fn() });

    render(<ToastProvider><AssistantDocker /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("描述你想找的商品"), { target: { value: "desk kit" } });
    fireEvent.click(screen.getByRole("button", { name: "查找商品" }));
    fireEvent.click(await screen.findByRole("button", { name: "付款" }));

    expect(await screen.findByText("订单已建立，但商品库存刷新失败，请稍后刷新页面。")).toBeInTheDocument();
  });
});
