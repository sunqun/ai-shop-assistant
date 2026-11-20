import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/repository/db";
import type { CatalogCategory } from "./types";

export async function listCategories(): Promise<CatalogCategory[]> {
  const [rows] = await getDbPool().query<
    (RowDataPacket & { category_id: string; name: string; product_count: string | number })[]
  >(
    `SELECT c.category_id, c.name, COUNT(p.product_id) AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.category_id
      WHERE c.is_active = 1
      GROUP BY c.category_id, c.name, c.sort_order
      ORDER BY c.sort_order ASC, c.name ASC`
  );
  return rows.map((row) => ({
    id: row.category_id,
    name: row.name,
    count: Number(row.product_count ?? 0),
  }));
}
