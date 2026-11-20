import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WEB_DIST = join(ROOT, "src/web/dist");
const SERVER_SRC = join(ROOT, "src/server/src");
const EMBED_FILE = join(SERVER_SRC, "embedded-assets.ts");
const STUB = "export const EMBEDDED_WEB_ASSETS: Record<string, string> = {};\n";

const TARGETS: Record<string, string> = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

async function run(cmd: string[], cwd = ROOT) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) throw new Error(`Command failed: ${cmd.join(" ")}`);
}

function writeEmbedModule() {
  const files = walk(WEB_DIST);
  const imports = files.map((file, i) => `import f${i} from "${relative(SERVER_SRC, file)}" with { type: "file" };`);
  const entries = files.map((file, i) => `  ${JSON.stringify(`/${relative(WEB_DIST, file)}`)}: f${i},`);
  writeFileSync(EMBED_FILE, `${imports.join("\n")}\n\nexport const EMBEDDED_WEB_ASSETS: Record<string, string> = {\n${entries.join("\n")}\n};\n`);
  return files.length;
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const skipWeb = args.includes("--skip-web");
const hostKey = `${process.platform}-${process.arch}`;
const keys = all ? Object.keys(TARGETS) : [hostKey];

if (!skipWeb) await run(["bun", "run", "build"], join(ROOT, "src/web"));

const count = writeEmbedModule();
console.log(`Embedded ${count} web assets`);

try {
  for (const key of keys) {
    const target = TARGETS[key];
    if (!target) throw new Error(`Unsupported platform: ${key}`);
    const outfile = join(ROOT, "dist", all ? `agenthands-${key}` : "agenthands");
    await run(["bun", "build", "--compile", "--minify", `--target=${target}`, join(SERVER_SRC, "index.ts"), "--outfile", outfile]);
    console.log(`Built ${relative(ROOT, outfile)}`);
  }
} finally {
  writeFileSync(EMBED_FILE, STUB);
}
