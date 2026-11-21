import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), products: vi.fn(), quote: vi.fn(), reconcile: vi.fn(), submit: vi.fn(), push: vi.fn(), user: { userid: "user", isAuthorized: true } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({ user: mocks.user, loading: false, openLogin: vi.fn() }) }));
vi.mock("@/app/cart/api", () => ({ fetchCartRequest: mocks.fetch, getProductsRequest: mocks.products, quoteCartRequest: mocks.quote, reconcileCartRequest: mocks.reconcile, submitOrderRequest: mocks.submit }));
import CartPage from "@/app/cart/page";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetch.mockResolvedValue({ success: true, data: { cartVersion: 1, items: ["a", "b"].map((id) => ({ skuId: `sku-${id}`, productId: id, requestedQuantity: 1, allocatedQuantity: 1, unavailableQuantity: 0 })) } });
  mocks.products.mockResolvedValue({ success: true, data: { products: ["a", "b"].map((id) => ({ id, name: `商品${id}`, price: 100, stock: 10 })) } });
  mocks.quote.mockImplementation(async (_version: number, skus: string[]) => ({ success: true, data: { quote: {
    quoteId: skus.join(","), subtotalMinor: skus.length * 10000, discountMinor: 0, shippingMinor: 0, totalDueMinor: skus.length * 10000,
  } } }));
  mocks.submit.mockResolvedValue({ success: true, data: { orderGroupId: "group" } });
});
afterEach(cleanup);
describe("购物车勾选交互", () => {
  it("取消某件商品后只计算和提交勾选商品的报价，不修改购物车内容", async () => {
    render(<CartPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "付款" })).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 商品b" }));
    await waitFor(() => expect(mocks.quote).toHaveBeenLastCalledWith(1, ["sku-a"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "付款" })).toBeEnabled());
    expect(screen.getByText("商品b")).toBeInTheDocument();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "付款" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(1, "sku-a", expect.any(String)));
    expect(mocks.push).toHaveBeenCalledWith("/orders");
  });
  it("取消全选显示零应付且不能付款，重新全选恢复报价", async () => {
    render(<CartPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "付款" })).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "全选购物车商品" }));
    expect(screen.getByRole("button", { name: "付款" })).toBeDisabled();
    expect(screen.getByText("请勾选需要结算的商品。")).toBeInTheDocument();
    expect(screen.getByText("NT$0")).toBeInTheDocument();
    expect(mocks.quote).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "全选购物车商品" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "付款" })).toBeEnabled());
    expect(mocks.quote).toHaveBeenLastCalledWith(1, ["sku-a", "sku-b"]);
  });
  it("变更勾选后新报价未返回时，不能使用旧金额结算", async () => {
    render(<CartPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "付款" })).toBeEnabled());
    mocks.quote.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 商品b" }));
    expect(screen.getByRole("button", { name: "付款" })).toBeDisabled();
    expect(screen.queryByText("NT$200")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "付款" }));
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
