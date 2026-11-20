import { $ } from "bun";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
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

const updaterPubkey = process.env.AGENTHANDS_UPDATER_PUBKEY?.trim();
const signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
const repo = process.env.GITHUB_REPOSITORY;
const updaterEndpoint = process.env.AGENTHANDS_UPDATER_ENDPOINT?.trim() || (repo ? `https://github.com/${repo}/releases/latest/download/latest.json` : "");
const updater = Boolean(updaterPubkey && signingKey && updaterEndpoint);
const env: Record<string, string | undefined> = { ...process.env, AGENTHANDS_UPDATER_PUBKEY: "", AGENTHANDS_UPDATER_ENDPOINT: "" };
const configArgs: string[] = [];
if (updater) {
  env.AGENTHANDS_UPDATER_PUBKEY = updaterPubkey;
  env.AGENTHANDS_UPDATER_ENDPOINT = updaterEndpoint;
  configArgs.push("--config", JSON.stringify({ bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: updaterPubkey, endpoints: [updaterEndpoint] } } }));
  console.log(`Updater on: ${updaterEndpoint}`);
} else {
  console.log("Updater off: set AGENTHANDS_UPDATER_PUBKEY, TAURI_SIGNING_PRIVATE_KEY and GITHUB_REPOSITORY (or AGENTHANDS_UPDATER_ENDPOINT) to turn it on.");
}

const tauriArgs = [...(flag("--debug") ? ["--debug"] : []), ...(explicitTarget ? ["--target", triple] : []), ...(flag("--archive") ? ["--bundles", "app"] : []), ...configArgs];
await $`bun run tauri build ${tauriArgs}`.cwd(desktop).env(env);

const profile = flag("--debug") ? "debug" : "release";
const bundle = join(desktop, "src-tauri", "target", ...(explicitTarget ? [triple] : []), profile, "bundle");

if (flag("--archive")) {
  const archive = join(root, "dist", `OpenAgentHands-darwin-${arch}.app.tar.gz`);
  mkdirSync(join(root, "dist"), { recursive: true });
  rmSync(`${archive}.sig`, { force: true });
  const signed = join(bundle, "macos", "Open Agent Hands.app.tar.gz");
  if (updater) {
    if (!existsSync(signed) || !existsSync(`${signed}.sig`)) throw new Error(`Tauri did not produce the signed update archive ${signed}(.sig).`);
    copyFileSync(signed, archive);
    copyFileSync(`${signed}.sig`, `${archive}.sig`);
  } else {
    await $`tar -czf ${archive} -C ${join(bundle, "macos")} ${"Open Agent Hands.app"}`;
  }
  console.log(`\nApp archive: ${archive}`);
}

console.log(`\nDesktop app ready in ${bundle}`);
