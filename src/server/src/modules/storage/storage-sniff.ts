export const SNIFF_BYTES = 8192;

type Match = { type: string; accepts?: readonly string[] };

const ISO_MEDIA = ["video/mp4", "audio/mp4", "audio/x-m4a", "audio/m4a", "video/x-m4v", "video/quicktime", "video/3gpp", "video/3gpp2", "audio/3gpp"];
const ISO_IMAGE = ["image/avif", "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence", "image/avif-sequence"];
const ZIP_FAMILY = [
  "application/zip",
  "application/x-zip-compressed",
  "application/epub+zip",
  "application/java-archive",
  "application/vnd.android.package-archive",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
];
const OLE_FAMILY = ["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/vnd.ms-outlook", "application/x-ole-storage"];

const MATCH_TYPES = new Set<string>([...ISO_MEDIA, ...ISO_IMAGE, ...ZIP_FAMILY, ...OLE_FAMILY]);

function remember(match: Match): Match {
  MATCH_TYPES.add(match.type);
  for (const t of match.accepts ?? []) MATCH_TYPES.add(t);
  return match;
}

const PNG = remember({ type: "image/png", accepts: ["image/apng"] });
const JPEG = remember({ type: "image/jpeg", accepts: ["image/pjpeg", "image/jpg"] });
const GIF = remember({ type: "image/gif" });
const WEBP = remember({ type: "image/webp" });
const BMP = remember({ type: "image/bmp", accepts: ["image/x-ms-bmp", "image/x-bmp"] });
const ICO = remember({ type: "image/x-icon", accepts: ["image/vnd.microsoft.icon"] });
const TIFF = remember({ type: "image/tiff" });
const JXL = remember({ type: "image/jxl" });
const PSD = remember({ type: "image/vnd.adobe.photoshop" });
const PDF = remember({ type: "application/pdf" });
const MP3 = remember({ type: "audio/mpeg", accepts: ["audio/mp3", "audio/mpeg3"] });
const AAC = remember({ type: "audio/aac", accepts: ["audio/x-aac", "audio/aacp"] });
const FLAC = remember({ type: "audio/flac", accepts: ["audio/x-flac"] });
const WAV = remember({ type: "audio/wav", accepts: ["audio/x-wav", "audio/wave", "audio/vnd.wave"] });
const AIFF = remember({ type: "audio/aiff", accepts: ["audio/x-aiff"] });
const MIDI = remember({ type: "audio/midi", accepts: ["audio/x-midi"] });
const OGG_FAMILY = ["audio/ogg", "video/ogg", "application/ogg", "audio/opus"];
const AVI = remember({ type: "video/x-msvideo", accepts: ["video/avi", "video/msvideo"] });
const WEBM = remember({ type: "video/webm", accepts: ["audio/webm"] });
const MKV = remember({ type: "video/x-matroska", accepts: ["audio/x-matroska"] });
const FLV = remember({ type: "video/x-flv" });
const ASF = remember({ type: "video/x-ms-asf", accepts: ["video/x-ms-wmv", "audio/x-ms-wma"] });
const MPEG_PS = remember({ type: "video/mpeg" });
const MPEG_TS = remember({ type: "video/mp2t" });
const ZIP = remember({ type: "application/zip", accepts: ZIP_FAMILY });
const GZIP = remember({ type: "application/gzip", accepts: ["application/x-gzip", "application/x-gtar", "application/x-compressed-tar"] });
const SEVEN_Z = remember({ type: "application/x-7z-compressed" });
const RAR = remember({ type: "application/vnd.rar", accepts: ["application/x-rar-compressed", "application/x-rar"] });
const BZIP2 = remember({ type: "application/x-bzip2" });
const XZ = remember({ type: "application/x-xz" });
const ZSTD = remember({ type: "application/zstd" });
const TAR = remember({ type: "application/x-tar" });
const OLE = remember({ type: "application/x-ole-storage", accepts: OLE_FAMILY });
const WASM = remember({ type: "application/wasm" });
const SQLITE = remember({ type: "application/vnd.sqlite3", accepts: ["application/x-sqlite3"] });
const EXE = remember({ type: "application/x-msdownload", accepts: ["application/vnd.microsoft.portable-executable", "application/x-dosexec"] });
const ELF = remember({ type: "application/x-elf", accepts: ["application/x-executable", "application/x-sharedlib"] });
const WOFF = remember({ type: "font/woff" });
const WOFF2 = remember({ type: "font/woff2" });
const TTF = remember({ type: "font/ttf" });
const OTF = remember({ type: "font/otf" });
for (const t of OGG_FAMILY) MATCH_TYPES.add(t);

const HTML_STARTS = ["<!doctype html", "<html", "<head", "<script", "<iframe", "<h1", "<div", "<font", "<table", "<a", "<style", "<title", "<b", "<body", "<br", "<p", "<!--"];

function at(head: Uint8Array, offset: number, bytes: readonly number[]): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((b, i) => head[offset + i] === b);
}

function ascii(head: Uint8Array, offset: number, text: string): boolean {
  return at(head, offset, [...text].map((c) => c.charCodeAt(0)));
}

function asciiSlice(head: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...head.subarray(start, Math.min(end, head.length)));
}

function includesAscii(head: Uint8Array, text: string, limit = head.length): boolean {
  return asciiSlice(head, 0, limit).includes(text);
}

function isoMedia(head: Uint8Array): Match | null {
  if (!ascii(head, 4, "ftyp")) return null;
  const boxSize = ((head[0] ?? 0) << 24) | ((head[1] ?? 0) << 16) | ((head[2] ?? 0) << 8) | (head[3] ?? 0);
  const end = Math.min(Math.max(boxSize, 16), head.length, 256);
  const brands: string[] = [asciiSlice(head, 8, 12)];
  for (let i = 16; i + 4 <= end; i += 4) brands.push(asciiSlice(head, i, i + 4));
  if (brands.some((b) => b === "avif" || b === "avis")) return { type: "image/avif", accepts: ISO_IMAGE };
  if (brands.some((b) => ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(b))) return { type: "image/heic", accepts: ISO_IMAGE };
  const major = brands[0] ?? "";
  if (major.startsWith("M4A") || major.startsWith("M4B") || major.startsWith("M4P")) return { type: "audio/mp4", accepts: ISO_MEDIA };
  if (major === "qt  ") return { type: "video/quicktime", accepts: ISO_MEDIA };
  if (major.startsWith("3gp")) return { type: "video/3gpp", accepts: ISO_MEDIA };
  if (major.startsWith("3g2")) return { type: "video/3gpp2", accepts: ISO_MEDIA };
  return { type: "video/mp4", accepts: ISO_MEDIA };
}

function mpegAudio(head: Uint8Array): Match | null {
  const [b0 = 0, b1 = 0, b2 = 0] = head;
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  if ((b1 & 0xf6) === 0xf0) return AAC;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  const bitrate = b2 >> 4;
  const sampleRate = (b2 >> 2) & 3;
  if (version === 1 || layer === 0 || bitrate === 15 || sampleRate === 3) return null;
  return MP3;
}

function binaryMagic(head: Uint8Array): Match | null {
  if (at(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (at(head, 0, [0xff, 0xd8, 0xff])) return JPEG;
  if (ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a")) return GIF;
  if (ascii(head, 0, "RIFF")) {
    if (ascii(head, 8, "WEBP")) return WEBP;
    if (ascii(head, 8, "WAVE")) return WAV;
    if (ascii(head, 8, "AVI ")) return AVI;
  }
  if (ascii(head, 0, "BM") && [12, 40, 52, 56, 64, 108, 124].includes((head[14] ?? 0) | ((head[15] ?? 0) << 8)) && head[16] === 0 && head[17] === 0) return BMP;
  if (at(head, 0, [0x00, 0x00, 0x01, 0x00]) && (head[4] ?? 0) > 0 && head[5] === 0) return ICO;
  if (at(head, 0, [0x49, 0x49, 0x2a, 0x00]) || at(head, 0, [0x4d, 0x4d, 0x00, 0x2a])) return TIFF;
  if (at(head, 0, [0xff, 0x0a]) || at(head, 0, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return JXL;
  if (ascii(head, 0, "8BPS") && head[4] === 0) return PSD;
  if (ascii(head, 0, "%PDF-")) return PDF;
  const iso = isoMedia(head);
  if (iso) return iso;
  if (["moov", "mdat", "wide"].some((atom) => ascii(head, 4, atom))) return { type: "video/quicktime", accepts: ISO_MEDIA };
  if (ascii(head, 0, "ID3") && (head[3] ?? 0xff) < 0x05) return MP3;
  if (ascii(head, 0, "fLaC")) return FLAC;
  if (ascii(head, 0, "OggS") && head[4] === 0) {
    if (includesAscii(head, "theora") || includesAscii(head, "\x80theora")) return { type: "video/ogg", accepts: OGG_FAMILY };
    return { type: "audio/ogg", accepts: OGG_FAMILY };
  }
  if (ascii(head, 0, "FORM") && (ascii(head, 8, "AIFF") || ascii(head, 8, "AIFC"))) return AIFF;
  if (ascii(head, 0, "MThd") && at(head, 4, [0x00, 0x00, 0x00, 0x06])) return MIDI;
  if (at(head, 0, [0x1a, 0x45, 0xdf, 0xa3])) return includesAscii(head, "webm", 64) ? WEBM : MKV;
  if (ascii(head, 0, "FLV") && head[3] === 0x01) return FLV;
  if (at(head, 0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return ASF;
  if (at(head, 0, [0x00, 0x00, 0x01, 0xba])) return MPEG_PS;
  if (head[0] === 0x47 && head.length > 376 && head[188] === 0x47 && head[376] === 0x47) return MPEG_TS;
  if (ascii(head, 0, "PK") && (at(head, 2, [0x03, 0x04]) || at(head, 2, [0x05, 0x06]) || at(head, 2, [0x07, 0x08]))) return ZIP;
  if (at(head, 0, [0x1f, 0x8b, 0x08])) return GZIP;
  if (at(head, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return SEVEN_Z;
  if (ascii(head, 0, "Rar!") && at(head, 4, [0x1a, 0x07])) return RAR;
  if (ascii(head, 0, "BZh") && (head[3] ?? 0) >= 0x31 && (head[3] ?? 0) <= 0x39 && at(head, 4, [0x31, 0x41, 0x59, 0x26, 0x53, 0x59])) return BZIP2;
  if (at(head, 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return XZ;
  if (at(head, 0, [0x28, 0xb5, 0x2f, 0xfd])) return ZSTD;
  if (ascii(head, 257, "ustar")) return TAR;
  if (at(head, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return OLE;
  if (at(head, 0, [0x00, 0x61, 0x73, 0x6d])) return WASM;
  if (ascii(head, 0, "SQLite format 3\0")) return SQLITE;
  if (ascii(head, 0, "MZ") && head.subarray(2, 64).includes(0)) return EXE;
  if (at(head, 0, [0x7f, 0x45, 0x4c, 0x46])) return ELF;
  if (ascii(head, 0, "wOFF")) return WOFF;
  if (ascii(head, 0, "wOF2")) return WOFF2;
  if (at(head, 0, [0x00, 0x01, 0x00, 0x00, 0x00])) return TTF;
  if (ascii(head, 0, "OTTO")) return OTF;
  return null;
}

function isBinaryByte(b: number): boolean {
  return b <= 0x08 || b === 0x0b || (b >= 0x0e && b <= 0x1a) || (b >= 0x1c && b <= 0x1f);
}

function looksLikeText(head: Uint8Array): boolean {
  return !head.some(isBinaryByte);
}

function isUtf8(head: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

function markupType(head: Uint8Array): string | null {
  const text = new TextDecoder().decode(head.subarray(0, 2048)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (text.startsWith("<svg")) return "image/svg+xml";
  if (text.startsWith("<?xml")) return text.includes("<svg") ? "image/svg+xml" : "application/xml";
  if (HTML_STARTS.some((tag) => text.startsWith(tag) && /^[\s>]/.test(text.slice(tag.length, tag.length + 1) || ">"))) return "text/html";
  return null;
}

export function baseType(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

export function isTextLike(base: string): boolean {
  return base.startsWith("text/") || /\/(json|xml|javascript|typescript|x-yaml|yaml|csv|sql|x-sh|svg\+xml)$/.test(base) || base.endsWith("+json") || base.endsWith("+xml");
}

function claimIsCheckable(base: string): boolean {
  return MATCH_TYPES.has(base) || isTextLike(base) || /^(image|audio|video|font)\//.test(base);
}

export function detectContentType(head: Uint8Array, claimed: string): string {
  const claim = claimed.trim();
  const claimBase = baseType(claim);
  const match = binaryMagic(head);
  if (match) return claimBase === match.type || match.accepts?.includes(claimBase) ? claim : match.type;
  if (at(head, 0, [0xff, 0xfe]) || at(head, 0, [0xfe, 0xff])) return isTextLike(claimBase) ? claim : `text/plain; charset=${head[0] === 0xff ? "utf-16le" : "utf-16be"}`;
  const audio = mpegAudio(head);
  if (audio) return claimBase === audio.type || audio.accepts?.includes(claimBase) ? claim : audio.type;
  if (looksLikeText(head)) {
    if (isTextLike(claimBase)) return claim;
    return markupType(head) ?? (isUtf8(head) ? "text/plain; charset=utf-8" : "text/plain");
  }
  if (!claim || claimIsCheckable(claimBase)) return "application/octet-stream";
  return claim;
}
