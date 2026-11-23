import { File, FileArchive, FileAudio, FileBraces, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, type LucideIcon } from "lucide-react";

export type FileKind = { label: string; icon: LucideIcon; className: string };

const NAMED: Record<string, string> = {
  csv: "CSV",
  tsv: "TSV",
  json: "JSON",
  md: "Markdown",
  txt: "Text",
  log: "Log",
  pdf: "PDF",
  html: "HTML",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  sql: "SQL",
  xlsx: "Excel",
  xls: "Excel",
  docx: "Word",
  doc: "Word",
  pptx: "PowerPoint",
  zip: "ZIP archive",
  gz: "GZip archive",
  tar: "TAR archive",
};

const CODE = new Set(["js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "go", "rs", "sh", "rb", "java", "css", "html", "sql"]);
const SHEET = new Set(["csv", "tsv", "xlsx", "xls"]);
const ARCHIVE = new Set(["zip", "gz", "tgz", "tar", "rar", "7z"]);

function extension(key: string): string {
  const name = key.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function fileKind(key: string, contentType: string): FileKind {
  const ext = extension(key);
  const type = contentType.split(";")[0].trim().toLowerCase();
  const upper = ext.toUpperCase();
  if (type.startsWith("image/")) return { label: ext ? `${upper} image` : "Image", icon: FileImage, className: "text-emerald-500" };
  if (type.startsWith("video/")) return { label: ext ? `${upper} video` : "Video", icon: FileVideo, className: "text-violet-500" };
  if (type.startsWith("audio/")) return { label: ext ? `${upper} audio` : "Audio", icon: FileAudio, className: "text-pink-500" };
  if (type === "application/pdf" || ext === "pdf") return { label: "PDF", icon: FileText, className: "text-red-500" };
  if (SHEET.has(ext)) return { label: NAMED[ext] ?? upper, icon: FileSpreadsheet, className: "text-green-600" };
  if (ARCHIVE.has(ext)) return { label: NAMED[ext] ?? `${upper} archive`, icon: FileArchive, className: "text-amber-600" };
  if (ext === "json" || type.endsWith("json")) return { label: "JSON", icon: FileBraces, className: "text-sky-500" };
  if (CODE.has(ext)) return { label: NAMED[ext] ?? upper, icon: FileCode, className: "text-sky-500" };
  if (type.startsWith("text/") || NAMED[ext]) return { label: NAMED[ext] ?? (ext ? upper : "Text"), icon: FileText, className: "text-blue-500" };
  return { label: ext ? `${upper} file` : "File", icon: File, className: "text-muted-foreground" };
}
