import Database from "better-sqlite3";
import path from "node:path";

export const databasePath = path.join(process.cwd(), "data", "tankguard.db");

export function openDatabase(): Database.Database {
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  return db;
}
