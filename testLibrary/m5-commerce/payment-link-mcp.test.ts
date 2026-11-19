import { beforeEach, describe, expect, it, vi } from "vitest";
import { callPaymentLinkTool } from "@/lib/mcp/payment-link-server";

const createPaymentLink = vi.hoisted(() => vi.fn());

vi.mock("@/lib/payment-link/payment-link-service", () => ({
  createPaymentLink,
  PaymentLinkError: class PaymentLinkError extends Error {
    constructor(public code: string) { super(code); }
  },
}));

describe("payment link MCP tool", () => {
  beforeEach(() => createPaymentLink.mockReset());

  it("requires an authenticated user context", async () => {
    const result = await callPaymentLinkTool({
      name: "commerce.create_payment_link",
      arguments: { productId: "p1", quantity: 1 },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("validates arguments before invoking the payment link service", async () => {
    const result = await callPaymentLinkTool({
      name: "commerce.create_payment_link",
      arguments: { productId: "p1", quantity: 0 },
    }, { userid: "00000000-0000-4000-8000-000000000001" });

    expect(result).toMatchObject({ ok: false, error: { code: "MCP_INVALID_ARGUMENTS" } });
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("delegates link creation to the existing service", async () => {
    createPaymentLink.mockResolvedValue({ linkId: "link-1", urlToken: "token" });
    const userid = "00000000-0000-4000-8000-000000000001";
    const result = await callPaymentLinkTool({
      name: "commerce.create_payment_link",
      arguments: { productId: "p1", quantity: 1 },
    }, { userid });

    expect(result).toEqual({ ok: true, data: { linkId: "link-1", urlToken: "token" } });
    expect(createPaymentLink).toHaveBeenCalledWith({ userid, productId: "p1", quantity: 1 });
  });
});
