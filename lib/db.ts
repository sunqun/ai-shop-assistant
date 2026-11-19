import mysql, { type Pool } from "mysql2/promise";

declare global {
  var aiShopDbPool: Pool | undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

type DatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

function databaseConfig(): DatabaseConfig {
  const urlValue = firstEnv("MYSQL_URL", "DATABASE_URL");
  let urlConfig: Partial<DatabaseConfig> = {};

  if (urlValue) {
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      throw new Error("Invalid MYSQL_URL or DATABASE_URL");
    }
    if (url.protocol !== "mysql:" && url.protocol !== "mysql2:") {
      throw new Error("MYSQL_URL or DATABASE_URL must use the mysql:// scheme");
    }
    urlConfig = {
      host: url.hostname || undefined,
      port: url.port ? Number(url.port) : undefined,
      database: url.pathname.replace(/^\//, "") || undefined,
      user: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
    };
  }

  const portValue = firstEnv("MYSQL_PORT", "MYSQLPORT") ?? urlConfig.port?.toString() ?? "3306";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid MySQL port");
  }

  return {
    host: firstEnv("MYSQL_HOST", "MYSQLHOST") ?? urlConfig.host ?? requiredEnv("MYSQL_HOST"),
    port,
    database:
      firstEnv("MYSQL_DATABASE", "MYSQLDATABASE") ?? urlConfig.database ?? requiredEnv("MYSQL_DATABASE"),
    user: firstEnv("MYSQL_USER", "MYSQLUSER") ?? urlConfig.user ?? requiredEnv("MYSQL_USER"),
    password: firstEnv("MYSQL_PASSWORD", "MYSQLPASSWORD") ?? urlConfig.password ?? "",
  };
}

export function getDbPool(): Pool {
  if (globalThis.aiShopDbPool) return globalThis.aiShopDbPool;

  const config = databaseConfig();

  globalThis.aiShopDbPool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
  });

  return globalThis.aiShopDbPool;
}
