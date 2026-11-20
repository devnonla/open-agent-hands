import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../../common/crypto/secret-crypto.js";
import { appSettings, getDb } from "../../common/db/client.js";
import { qone, qrun } from "../../common/db/query.js";

const SETTINGS_KEY = "core_mcp_key";

function generateCoreKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `ah_core_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function storeKey(raw: string): Promise<void> {
  const now = new Date();
  const value = encryptSecret(raw);
  await qrun(
    getDb()
      .insert(appSettings)
      .values({ key: SETTINGS_KEY, value, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } }),
  );
}

export async function getCoreMcpKey(): Promise<string> {
  const row = await qone(getDb().select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)));
  if (row) return decryptSecret(row.value);
  const raw = generateCoreKey();
  await storeKey(raw);
  return raw;
}

export async function rotateCoreMcpKey(): Promise<string> {
  const raw = generateCoreKey();
  await storeKey(raw);
  return raw;
}

export async function verifyCoreMcpKey(candidate: string): Promise<boolean> {
  const expected = Buffer.from(await getCoreMcpKey());
  const given = Buffer.from(candidate);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
