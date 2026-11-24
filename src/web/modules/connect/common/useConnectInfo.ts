import { useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import { usePublicUrl } from "src/common/hooks/usePublicUrl";

export type CoreToolGroup = { group: string; tools: { name: string; description: string }[] };

type CoreInfo = { key: string; toolCount: number; groups: CoreToolGroup[] };

export type ConnectInfo = { server: string; key: string | null; groups: CoreToolGroup[]; toolCount: number; error: string | null; setKey: (key: string) => void };

export function useConnectInfo(): ConnectInfo {
  const publicUrl = usePublicUrl();
  const [info, setInfo] = useState<CoreInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .get<CoreInfo>("/api/core-mcp")
      .then((next) => alive && setInfo(next))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to load the key"));
    return () => {
      alive = false;
    };
  }, []);

  return {
    server: publicUrl?.effective || window.location.origin,
    key: info?.key ?? null,
    groups: info?.groups ?? [],
    toolCount: info?.toolCount ?? 0,
    error,
    setKey: (key) => setInfo((prev) => (prev ? { ...prev, key } : prev)),
  };
}
