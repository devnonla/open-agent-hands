import { useEffect, useState } from "react";
import { apiClient } from "src/common/api";

export type InstallKind = "docker" | "desktop" | "binary" | "source";

export interface UpdateInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  install: InstallKind;
  command: string | null;
  checkedAt: number | null;
}

const RECHECK_MS = 6 * 60 * 60 * 1000;

let cache: { info: UpdateInfo; at: number } | null = null;
let pending: Promise<UpdateInfo | null> | null = null;

function loadUpdateInfo(): Promise<UpdateInfo | null> {
  if (cache && Date.now() - cache.at < RECHECK_MS) return Promise.resolve(cache.info);
  pending ??= apiClient
    .get<UpdateInfo>("/api/settings/update")
    .then((info) => {
      cache = { info, at: Date.now() };
      return info;
    })
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function useUpdateInfo(): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(cache?.info ?? null);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void loadUpdateInfo().then((next) => {
        if (alive && next) setInfo(next);
      });
    };
    refresh();
    const timer = setInterval(refresh, RECHECK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return info;
}
