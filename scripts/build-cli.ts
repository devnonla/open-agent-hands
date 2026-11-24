import { chmodSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const { version } = (await Bun.file(join(ROOT, "package.json")).json()) as { version: string };
const OUTFILE = join(ROOT, "dist", "oahctl.js");

const result = await Bun.build({
  entrypoints: [join(ROOT, "src/cli/src/main.ts")],
  target: "node",
  format: "esm",
  minify: true,
  define: { AH_VERSION: JSON.stringify(version) },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const code = (await result.outputs[0].text()).replace(/^#!.*\n/, "");
await Bun.write(OUTFILE, `#!/usr/bin/env node\n${code}`);
chmodSync(OUTFILE, 0o755);
console.log(`Built ${relative(ROOT, OUTFILE)} (${Math.round(statSync(OUTFILE).size / 1024)} KB)`);
