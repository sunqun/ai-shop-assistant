import type { RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { getDbPool } from "@/lib/repository/db";

export type UserRecord = {
  userid: string;
  username: string;
  passwordHash: string;
  isAuthorized: boolean;
};

type UserRow = RowDataPacket & {
  userid: string;
  username: string;
  password_hash: string;
  is_authorized: number | boolean;
};

function mapUser(row: UserRow): UserRecord {
  return {
    userid: row.userid,
    username: row.username,
    passwordHash: row.password_hash,
    isAuthorized: Boolean(row.is_authorized),
  };
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const [rows] = await getDbPool().execute<UserRow[]>(
    "SELECT userid, username, password_hash, is_authorized FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  return rows.length ? mapUser(rows[0]) : null;
}

export async function findUserById(userid: string): Promise<UserRecord | null> {
  const [rows] = await getDbPool().execute<UserRow[]>(
    "SELECT userid, username, password_hash, is_authorized FROM users WHERE userid = ? LIMIT 1",
    [userid]
  );
  return rows.length ? mapUser(rows[0]) : null;
}

export async function createUser(
  username: string,
  passwordHash: string,
  authorizationConsent = false
): Promise<UserRecord> {
  const userid = randomUUID();
  await getDbPool().execute(
    "INSERT INTO users (userid, username, password_hash, is_authorized) VALUES (?, ?, ?, ?)",
    [userid, username, passwordHash, authorizationConsent]
  );
  const user = await findUserById(userid);
  if (!user) throw new Error("created user could not be loaded");
  return user;
}

export async function authorizeUser(userid: string): Promise<UserRecord | null> {
  const pool = getDbPool();
  await pool.execute(
    "UPDATE users SET is_authorized = TRUE WHERE userid = ? AND is_authorized = FALSE",
    [userid]
  );
  return findUserById(userid);
}
