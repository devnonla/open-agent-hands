import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export { integer, primaryKey, sqliteTable, text };

export const sqlNow = sql`(unixepoch())`;

export function boolCol(name: string) {
  return integer(name, { mode: "boolean" });
}

export function tsCol(name: string) {
  return integer(name, { mode: "timestamp" });
}

export function jsonCol(name: string) {
  return text(name, { mode: "json" });
}
