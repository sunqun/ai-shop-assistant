import mysql, { type Pool } from "mysql2/promise";

declare global {
  var aiShopDbPool: Pool | undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getDbPool(): Pool {
  if (globalThis.aiShopDbPool) return globalThis.aiShopDbPool;

  globalThis.aiShopDbPool = mysql.createPool({
    host: requiredEnv("MYSQL_HOST"),
    port: Number(process.env.MYSQL_PORT ?? "3306"),
    database: requiredEnv("MYSQL_DATABASE"),
    user: requiredEnv("MYSQL_USER"),
    password: process.env.MYSQL_PASSWORD ?? "",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
  });

  return globalThis.aiShopDbPool;
}
