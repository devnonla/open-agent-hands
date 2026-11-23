import { useEffect, useState } from "react";
import { apiClient } from "src/common/api";

export interface PublicUrlInfo {
  configured: string;
  listen: string;
  effective: string;
  source: "setting" | "listen";
}

let cache: PublicUrlInfo | null = null;
let pending: Promise<PublicUrlInfo | null> | null = null;
const listeners = new Set<(info: PublicUrlInfo) => void>();

export function loadPublicUrl(force = false): Promise<PublicUrlInfo | null> {
  if (cache && !force) return Promise.resolve(cache);
  pending ??= apiClient
    .get<PublicUrlInfo>("/api/settings/public-url")
    .then((info) => {
      cache = info;
      for (const listener of listeners) listener(info);
      return info;
    })
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function usePublicUrl(): PublicUrlInfo | null {
  const [info, setInfo] = useState<PublicUrlInfo | null>(cache);

  useEffect(() => {
    listeners.add(setInfo);
    void loadPublicUrl();
    return () => {
      listeners.delete(setInfo);
    };
  }, []);

  return info;
}
