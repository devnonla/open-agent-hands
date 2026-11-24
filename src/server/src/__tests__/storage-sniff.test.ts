import { describe, expect, test } from "bun:test";
import { detectContentType } from "../modules/storage/storage-sniff.js";

const bytes = (...parts: Array<string | number[]>) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const ftyp = (major: string, ...compat: string[]) => bytes([0, 0, 0, 16 + compat.length * 4], "ftyp", major, [0, 0, 0, 0], ...compat);

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR");
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], "JFIF", [0]);
const MP3_ID3 = bytes("ID3", [3, 0, 0, 0, 0, 0, 0]);
const MP3_FRAME = bytes([0xff, 0xfb, 0x90, 0x64, 0, 0]);
const ZIP = bytes("PK", [3, 4, 20, 0, 0, 0]);

describe("detectContentType", () => {
  test("binary formats come from their bytes, whatever the extension says", () => {
    expect(detectContentType(PNG, "image/jpeg")).toBe("image/png");
    expect(detectContentType(JPEG, "text/html")).toBe("image/jpeg");
    expect(detectContentType(PNG, "application/octet-stream")).toBe("image/png");
    expect(detectContentType(bytes("%PDF-1.7\n%"), "image/png")).toBe("application/pdf");
    expect(detectContentType(bytes("RIFF", [0, 0, 0, 0], "WEBP"), "")).toBe("image/webp");
    expect(detectContentType(bytes("GIF89a", [1, 0]), "audio/mpeg")).toBe("image/gif");
  });

  test("audio and video", () => {
    expect(detectContentType(MP3_ID3, "audio/mpeg")).toBe("audio/mpeg");
    expect(detectContentType(MP3_FRAME, "image/png")).toBe("audio/mpeg");
    expect(detectContentType(bytes("fLaC", [0, 0, 0, 34]), "audio/x-flac")).toBe("audio/x-flac");
    expect(detectContentType(bytes("RIFF", [0, 0, 0, 0], "WAVE"), "audio/x-wav")).toBe("audio/x-wav");
    expect(detectContentType(bytes("OggS", [0, 2], "OpusHead"), "audio/ogg")).toBe("audio/ogg");
    expect(detectContentType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], "webm"), "")).toBe("video/webm");
    expect(detectContentType(ftyp("isom", "isom", "mp41"), "video/mp4")).toBe("video/mp4");
    expect(detectContentType(ftyp("isom", "isom", "mp41"), "audio/x-m4a")).toBe("audio/x-m4a");
    expect(detectContentType(ftyp("qt  "), "image/png")).toBe("video/quicktime");
    expect(detectContentType(ftyp("avif", "mif1", "avif"), "video/mp4")).toBe("image/avif");
    expect(detectContentType(ftyp("heic", "mif1", "heic"), "image/heic")).toBe("image/heic");
  });

  test("container formats keep a more specific claim of the same family", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(detectContentType(ZIP, docx)).toBe(docx);
    expect(detectContentType(ZIP, "image/png")).toBe("application/zip");
    expect(detectContentType(ZIP, "")).toBe("application/zip");
  });

  test("text keeps a text claim and never becomes an image or media type", () => {
    const html = bytes("<!DOCTYPE html><script>alert(1)</script>");
    expect(detectContentType(html, "image/png")).toBe("text/html");
    expect(detectContentType(html, "audio/mpeg")).toBe("text/html");
    expect(detectContentType(html, "text/plain;charset=utf-8")).toBe("text/plain;charset=utf-8");
    expect(detectContentType(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png")).toBe("image/svg+xml");
    expect(detectContentType(bytes('<?xml version="1.0"?><svg/>'), "application/pdf")).toBe("image/svg+xml");
    expect(detectContentType(bytes('{"a":1}'), "application/json;charset=utf-8")).toBe("application/json;charset=utf-8");
    expect(detectContentType(new TextEncoder().encode("name,qty\nbánh,2\n"), "image/jpeg")).toBe("text/plain; charset=utf-8");
    expect(detectContentType(bytes("caf", [0xe9], " au lait"), "")).toBe("text/plain");
    expect(detectContentType(bytes("BMW cars are fast"), "image/bmp")).toBe("text/plain; charset=utf-8");
    expect(detectContentType(bytes("MZ is just text"), "")).toBe("text/plain; charset=utf-8");
  });

  test("unknown binary only keeps a claim the server cannot check", () => {
    const junk = bytes([0x00, 0x13, 0x37, 0x00, 0x99, 0x01]);
    expect(detectContentType(junk, "image/png")).toBe("application/octet-stream");
    expect(detectContentType(junk, "application/pdf")).toBe("application/octet-stream");
    expect(detectContentType(junk, "text/plain")).toBe("application/octet-stream");
    expect(detectContentType(junk, "")).toBe("application/octet-stream");
    expect(detectContentType(junk, "application/x-apple-diskimage")).toBe("application/x-apple-diskimage");
  });
});
