import { $ } from "bun";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const desktop = join(root, "desktop");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const rustInfo = await $`rustc -vV`.text();
const hostTriple = /^host: (.+)$/m.exec(rustInfo)?.[1]?.trim();
if (!hostTriple) throw new Error("Could not read the Rust host target from `rustc -vV`. Install Rust from https://rustup.rs.");

const explicitTarget = option("--target");
const triple = explicitTarget ?? hostTriple;
const arch = triple.startsWith("aarch64") ? "arm64" : triple.startsWith("x86_64") ? "x64" : null;
if (!arch || !triple.includes("apple-darwin")) throw new Error(`Unsupported desktop target ${triple}. Only macOS (aarch64/x86_64-apple-darwin) is supported.`);

if (!flag("--skip-binary")) {
  await $`bun run ${explicitTarget ? "build:binary:all" : "build"}`.cwd(root);
}

const archBinary = join(root, "dist", `agenthands-darwin-${arch}`);
const binary = explicitTarget ? archBinary : join(root, "dist", "agenthands");
if (!existsSync(binary)) throw new Error(`Missing ${binary}. Run \`bun run ${explicitTarget ? "build:binary:all" : "build"}\` first.`);

const sidecarDir = join(desktop, "src-tauri", "binaries");
mkdirSync(sidecarDir, { recursive: true });
copyFileSync(binary, join(sidecarDir, `agenthands-${triple}`));

await $`bun install`.cwd(desktop);
if (!existsSync(join(desktop, "src-tauri", "icons", "icon.icns"))) {
  await $`bun run tauri icon src-tauri/icons/app-icon.png`.cwd(desktop);
}

const tauriArgs = [...(flag("--debug") ? ["--debug"] : []), ...(explicitTarget ? ["--target", triple] : []), ...(flag("--archive") ? ["--bundles", "app"] : [])];
await $`bun run tauri build ${tauriArgs}`.cwd(desktop);

const profile = flag("--debug") ? "debug" : "release";
const bundle = join(desktop, "src-tauri", "target", ...(explicitTarget ? [triple] : []), profile, "bundle");

if (flag("--archive")) {
  const archive = join(root, "dist", `OpenAgentHands-darwin-${arch}.app.tar.gz`);
  mkdirSync(join(root, "dist"), { recursive: true });
  await $`tar -czf ${archive} -C ${join(bundle, "macos")} ${"Open Agent Hands.app"}`;
  console.log(`\nApp archive: ${archive}`);
}

console.log(`\nDesktop app ready in ${bundle}`);
