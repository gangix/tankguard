import Database from "better-sqlite3";
import path from "node:path";

export const databasePath = path.join(process.cwd(), "data", "tankguard.db");

export function openDatabase(): Database.Database {
  // Vercel's function filesystem is immutable. The deployed database is a
  // pre-seeded, pre-investigated read model; local scripts retain write access.
  const db = new Database(databasePath, process.env.VERCEL === "1" ? { readonly: true, fileMustExist: true } : undefined);
  db.pragma("foreign_keys = ON");
  return db;
}
