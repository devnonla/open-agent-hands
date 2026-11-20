import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDataDir = join(tmpdir(), `agenthands-test-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = testDataDir;

process.on("exit", () => {
  try {
    rmSync(testDataDir, { recursive: true, force: true });
  } catch {}
});
