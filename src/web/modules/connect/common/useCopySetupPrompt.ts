import { useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import { usePublicUrl } from "src/common/hooks/usePublicUrl";
import { copyText } from "src/modules/my-mcp-servers/common/copy";
import { cliAgentPrompt, coreMcpAgentPrompt } from "./snippets";

export function useCopySetupPrompt(via: "cli" | "mcp" = "cli") {
  const publicUrl = usePublicUrl();
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    apiClient
      .get<{ key: string }>("/api/core-mcp")
      .then((info) => alive && setKey(info.key))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const copy = async () => {
    const current =
      key ??
      (await apiClient
        .get<{ key: string }>("/api/core-mcp")
        .then((info) => info.key)
        .catch(() => null));
    if (!current) return;
    const server = publicUrl?.effective || window.location.origin;
    const prompt = via === "mcp" ? coreMcpAgentPrompt(`${server}/mcp/core`, current) : cliAgentPrompt(server, current);
    if (!(await copyText(prompt, "Setup prompt copied. Paste it into your agent."))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return { copy, copied };
}
