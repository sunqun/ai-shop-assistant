import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderCard } from "@/app/orders/orderCard";
import type { UserOrderView } from "@/lib/repository/order-service";

afterEach(cleanup);

describe("订单提交方式标记", () => {
  it.each([
    ["AI", "auto", "AI 下单"],
    ["AI", "manual", "手动下单"],
    ["WEB", "manual", "手动下单"],
  ] as const)("计价来源%s、提交方式%s显示%s", (source, submissionMode, label) => {
    const order: UserOrderView = {
      orderGroupId: "order-fixture", source, submissionMode,
      createdAt: "2026-11-21T00:00:00Z", subtotalMinor: 10000,
      discountMinor: 500, shippingMinor: 0, totalMinor: 9500,
      items: [{ skuId: "sku", productName: "耳机", quantity: 1, unitPriceMinor: 10000 }],
    };
    render(<OrderCard order={order} expanded onToggle={vi.fn()} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(label === "AI 下单" ? "手动下单" : "AI 下单")).not.toBeInTheDocument();
    expect(screen.getByText("总计 NT$95")).toBeInTheDocument();
    expect(screen.getByText("耳机")).toBeInTheDocument();
  });
});
