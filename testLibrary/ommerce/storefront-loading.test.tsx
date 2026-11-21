import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ products: vi.fn(), categories: vi.fn() }));
vi.mock("@/components/home/api", () => ({ getProductsRequest: mocks.products, getCategoriesRequest: mocks.categories }));
vi.mock("@/components/assistant-docker", () => ({ AssistantDocker: () => null }));
vi.mock("@/components/home/header", () => ({ Header: () => null }));
vi.mock("@/components/home/productCard", () => ({ ProductCard: ({ product }: { product: { id: string; name: string } }) => <div data-testid="product">{product.name}</div> }));
import HomePage from "@/app/page";
let intersect: IntersectionObserverCallback;
const products = Array.from({ length: 101 }, (_, index) => ({ id: `item-${index + 1}`, name: `商品${index + 1}` }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.categories.mockResolvedValue({ success: true, data: { categories: [] } });
  mocks.products.mockImplementation(async ({ cursor = "0", pageSize = 20 }) => {
    const start = Number(cursor);
    const end = Math.min(start + pageSize, products.length);
    return { success: true, data: { products: products.slice(start, end), nextCursor: end < products.length ? String(end) : null } };
  });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("BUG-F01: 首页续页交互", () => {
  it("滚动会请求服务端下一页并可显示第101件", async () => {
    render(<HomePage />);
    await waitFor(() => expect(screen.getAllByTestId("product")).toHaveLength(20));
    for (const count of [40, 60, 80, 100, 101]) {
      await act(async () => { intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
      await waitFor(() => expect(screen.getAllByTestId("product")).toHaveLength(count));
    }
    expect(screen.getByText("商品101")).toBeInTheDocument();
    expect(mocks.products).toHaveBeenCalledTimes(6);
    expect(mocks.products.mock.calls[5][0].cursor).toBe("100");
  });
  it("切换排序重新请求首批，不能只在已加载商品中排序", async () => {
    render(<HomePage />);
    await waitFor(() => expect(screen.getAllByTestId("product")).toHaveLength(20));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "price-low" } });
    await waitFor(() => expect(mocks.products).toHaveBeenCalledWith(expect.objectContaining({ sort: "price-low", pageSize: 20 })));
    expect(mocks.products.mock.calls.at(-1)?.[0].cursor).toBeUndefined();
  });
  it("续页失败保留已有商品，并用原游标重试", async () => {
    render(<HomePage />);
    await waitFor(() => expect(screen.getAllByTestId("product")).toHaveLength(20));
    mocks.products.mockResolvedValueOnce({ success: false, errorMsg: "offline" });
    await act(async () => { intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
    fireEvent.click(await screen.findByRole("button", { name: "加载失败，点击重试" }));
    await waitFor(() => expect(screen.getAllByTestId("product")).toHaveLength(40));
    expect(mocks.products.mock.calls[1][0].cursor).toBe("20");
    expect(mocks.products.mock.calls[2][0].cursor).toBe("20");
  });
});
