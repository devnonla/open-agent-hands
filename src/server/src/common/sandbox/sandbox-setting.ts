import { eq } from "drizzle-orm";
import { appSettings, getDb, isDbReady } from "../db/client.js";
import { qone } from "../db/query.js";

export const SANDBOX_SETTING_KEY = "sandbox_enabled";

let cached: boolean | null = null;

export async function isSandboxEnabled(): Promise<boolean> {
  if (cached !== null) return cached;
  if (!isDbReady()) return false;
  const row = await qone(getDb().select().from(appSettings).where(eq(appSettings.key, SANDBOX_SETTING_KEY)));
  cached = row?.value === "true";
  return cached;
}

export function invalidateSandboxSetting(): void {
  cached = null;
}
