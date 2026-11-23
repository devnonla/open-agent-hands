import { getAuthToken, tryRefreshTokens } from "src/common/api";
import type { StorageFile } from "src/common/types";

function sendOnce(url: string, file: File, onProgress: (loaded: number) => void): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}

/** PUTs the raw file so the server streams it to disk; reports bytes sent. */
export async function uploadWithProgress(spaceId: string, key: string, file: File, onProgress: (loaded: number) => void): Promise<StorageFile> {
  const url = `/api/storage/spaces/${spaceId}/files?key=${encodeURIComponent(key)}`;
  let res = await sendOnce(url, file, onProgress);
  if (res.status === 401 && (await tryRefreshTokens())) res = await sendOnce(url, file, onProgress);
  if (res.status < 200 || res.status >= 300) {
    const message = (res.body as { message?: string } | null)?.message;
    throw new Error(message || `Upload failed: HTTP ${res.status}`);
  }
  return res.body as StorageFile;
}
