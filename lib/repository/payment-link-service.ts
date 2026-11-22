import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getCatalogProduct } from "@/lib/catalog";
import { getDbPool } from "@/lib/repository/db";
import { reconcileCart } from "@/lib/repository/cart-service";
import { quoteCart } from "@/lib/repository/quote-service";
import { submitAiOrder } from "@/lib/repository/order-service";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type LinkRow = RowDataPacket & {
  link_id: string;
  token_value: string;
  token_hash: string;
  userid: string;
  cart_token: string;
  product_id: string;
  quantity: number;
  username: string;
  created_at: Date | string;
};

export class PaymentLinkError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type PaymentLinkView = {
  linkId: string;
  token: string;
  urlToken: string;
  username: string;
  product: { id: string; name: string; price: number; currency: string; stock: number };
  quantity: number;
  createdAt: string;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function mapView(
  row: LinkRow,
  product: NonNullable<Awaited<ReturnType<typeof getCatalogProduct>>>
): PaymentLinkView {
  return {
    linkId: String(row.link_id),
    token: String(row.token_value),
    urlToken: String(row.token_value),
    username: String(row.username),
    product: {
      id: product.id,
      name: product.name,
      price: product.price,
      currency: product.currency,
      stock: product.stock,
    },
    quantity: Number(row.quantity),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

async function readLink(where: string, params: unknown[]): Promise<LinkRow | null> {
  const [rows] = await getDbPool().query<LinkRow[]>(
    `SELECT pl.link_id, pl.token_value, pl.token_hash, pl.userid, pl.cart_token,
            pl.product_id, pl.quantity, pl.created_at, u.username
       FROM payment_links pl
       INNER JOIN users u ON u.userid = pl.userid
      WHERE ${where} AND pl.deleted_at IS NULL
      LIMIT 1`,
    params
  );
  return rows[0] ?? null;
}

async function readLinkForUpdate(
  connection: PoolConnection,
  token: string
): Promise<LinkRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [rows] = await connection.query<LinkRow[]>(
    `SELECT link_id, token_value, token_hash, userid, cart_token,
            product_id, quantity, created_at
       FROM payment_links
      WHERE token_hash = ? AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE`,
    [tokenHash(token)]
  );
  const row = rows[0];
  if (!row) return null;
  const [users] = await connection.query<RowDataPacket[]>(
    "SELECT username FROM users WHERE userid = ?",
    [row.userid]
  );
  row.username = String(users[0]?.username ?? "");
  return row;
}

async function toView(row: LinkRow): Promise<PaymentLinkView> {
  const product = await getCatalogProduct(String(row.product_id));
  if (!product) throw new PaymentLinkError("PRODUCT_NOT_FOUND");
  return mapView(row, product);
}

export async function createPaymentLink(input: {
  userid: string;
  productId: string;
  quantity: number;
  /** 仅供服务端任务恢复使用的稳定 ID；网页接口不接收此字段。 */
  linkId?: string;
}): Promise<PaymentLinkView> {
  if (
    !/^[A-Za-z0-9._-]{1,100}$/.test(input.productId) ||
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 99
  )
    throw new PaymentLinkError("INVALID_PAYMENT_LINK_REQUEST");
  if (input.linkId) {
    if (!/^[0-9a-f-]{36}$/i.test(input.linkId))
      throw new PaymentLinkError("INVALID_PAYMENT_LINK_REQUEST");
    const existing = await readLink("pl.link_id = ?", [input.linkId]);
    if (existing) {
      if (
        String(existing.userid) !== input.userid ||
        String(existing.product_id) !== input.productId ||
        Number(existing.quantity) !== input.quantity
      )
        throw new PaymentLinkError("INVALID_PAYMENT_LINK_REQUEST");
      return toView(existing);
    }
  }
  const product = await getCatalogProduct(input.productId);
  if (!product) throw new PaymentLinkError("PRODUCT_NOT_FOUND");
  const token = randomBytes(32).toString("base64url");
  const cartToken = randomBytes(32).toString("base64url");
  await getDbPool().execute(
    "INSERT INTO payment_links (link_id, token_value, token_hash, userid, cart_token, product_id, quantity) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE link_id = link_id",
    [
      input.linkId ?? randomUUID(),
      token,
      tokenHash(token),
      input.userid,
      cartToken,
      input.productId,
      input.quantity,
    ]
  );
  const row = input.linkId
    ? await readLink("pl.link_id = ? AND pl.userid = ?", [input.linkId, input.userid])
    : await readLink("pl.token_hash = ?", [tokenHash(token)]);
  if (!row) throw new PaymentLinkError("PAYMENT_LINK_UNAVAILABLE");
  return mapView(row, product);
}

export async function listPaymentLinks(userid: string): Promise<PaymentLinkView[]> {
  const [rows] = await getDbPool().query<LinkRow[]>(
    `SELECT pl.link_id, pl.token_value, pl.token_hash, pl.userid, pl.cart_token,
            pl.product_id, pl.quantity, pl.created_at, u.username
       FROM payment_links pl
       INNER JOIN users u ON u.userid = pl.userid
      WHERE pl.userid = ? AND pl.deleted_at IS NULL
      ORDER BY pl.created_at DESC`,
    [userid]
  );
  const result: PaymentLinkView[] = [];
  for (const row of rows) {
    try {
      result.push(await toView(row));
    } catch (error) {
      if (!(error instanceof PaymentLinkError && error.code === "PRODUCT_NOT_FOUND")) throw error;
    }
  }
  return result;
}

export async function deletePaymentLink(userid: string, linkId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(linkId)) throw new PaymentLinkError("INVALID_PAYMENT_LINK_REQUEST");
  const [result] = await getDbPool().execute(
    "UPDATE payment_links SET deleted_at = CURRENT_TIMESTAMP WHERE link_id = ? AND userid = ? AND deleted_at IS NULL",
    [linkId, userid]
  );
  if (!(result as { affectedRows?: number }).affectedRows)
    throw new PaymentLinkError("PAYMENT_LINK_NOT_FOUND");
}

export async function getPaymentLink(
  token: string
): Promise<{ view: PaymentLinkView; ownerId: string; cartToken: string }> {
  if (!TOKEN_RE.test(token)) throw new PaymentLinkError("PAYMENT_LINK_NOT_FOUND");
  const row = await readLink("pl.token_hash = ?", [tokenHash(token)]);
  if (!row) throw new PaymentLinkError("PAYMENT_LINK_NOT_FOUND");
  return {
    view: await toView(row),
    ownerId: String(row.userid),
    cartToken: String(row.cart_token),
  };
}

export async function submitPaymentLinkOrder(input: {
  token: string;
  paymentPassword: string;
  idempotencyKey: string;
}) {
  if (
    !input.paymentPassword ||
    input.paymentPassword.length > 128 ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)
  )
    throw new PaymentLinkError("INVALID_PAYMENT_LINK_ORDER");
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const row = await readLinkForUpdate(connection, input.token);
    if (!row) throw new PaymentLinkError("PAYMENT_LINK_NOT_FOUND");
    const link = { view: await toView(row), ownerId: String(row.userid) };
    const cart = await reconcileCart({
      userid: link.ownerId,
      items: [{ id: link.view.product.id, quantity: link.view.quantity }],
      idempotencyKey: `link-reconcile-${input.idempotencyKey}`,
      source: "AI",
    });
    if (cart.fullyOutOfStock || !cart.allocations.some((item) => item.allocatedQuantity > 0))
      throw new PaymentLinkError("OUT_OF_STOCK");
    const quote = await quoteCart({
      userid: link.ownerId,
      cartVersion: cart.cartVersion,
      expectedSource: "AI",
    });
    const order = await submitAiOrder({
      userid: link.ownerId,
      cartVersion: cart.cartVersion,
      quoteId: quote.quote.quoteId,
      idempotencyKey: `link-order-${input.idempotencyKey}`,
    });
    const [consumed] = await connection.execute<ResultSetHeader>(
      "UPDATE payment_links SET deleted_at = CURRENT_TIMESTAMP WHERE link_id = ? AND deleted_at IS NULL",
      [link.view.linkId]
    );
    if (consumed.affectedRows !== 1) throw new PaymentLinkError("PAYMENT_LINK_NOT_FOUND");
    await connection.commit();
    return { link: link.view, quote, order };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
