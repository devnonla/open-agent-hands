import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error("Set GITHUB_REPOSITORY (owner/name) so the manifest can link to the release assets.");

const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
const notesFile = join(root, "release-notes.md");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const section = new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, "m").exec(changelog)?.[1]?.trim();
const markdown = existsSync(notesFile) ? readFileSync(notesFile, "utf8") : (section ?? "");
const notes = markdown
  .replace(/^#+\s*/gm, "")
  .replace(/\*\*(.+?)\*\*/g, "$1")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/^- /gm, "• ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const platforms: Record<string, { signature: string; url: string }> = {};
for (const [arch, key] of [
  ["arm64", "darwin-aarch64"],
  ["x64", "darwin-x86_64"],
] as const) {
  const name = `OpenAgentHands-darwin-${arch}.app.tar.gz`;
  const sig = join(dist, `${name}.sig`);
  if (!existsSync(sig)) throw new Error(`Missing ${sig}. Build the app with the updater keys set.`);
  platforms[key] = { signature: readFileSync(sig, "utf8").trim(), url: `https://github.com/${repo}/releases/download/v${version}/${name}` };
}

const manifest = { version, notes, pub_date: new Date().toISOString(), platforms };
writeFileSync(join(dist, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote dist/latest.json for ${version}`);
