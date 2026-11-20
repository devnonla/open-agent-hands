import { useEffect } from "react";
import { getAuthToken } from "src/common/api";
import type { AgentTool, KvStoreEntry, MyMcpServer, SecretEntry } from "src/common/types";
import { removeKvEntryLocal, upsertKvEntryLocal } from "src/modules/kvstore/common/kvStoreSlice";
import { removeMyMcpServerLocal, upsertMyMcpServerLocal } from "src/modules/my-mcp-servers/common/myMcpServersSlice";
import { removeSecretLocal, upsertSecretLocal } from "src/modules/secrets/common/secretsSlice";
import { removeToolFolderLocal, reorderToolFoldersLocal, upsertToolFolderLocal } from "src/modules/tools/common/toolFoldersSlice";
import type { ToolFolderWithTools } from "src/modules/tools/common/toolFoldersSlice";
import { removeToolLocal, reorderToolsLocal, upsertToolLocal } from "src/modules/tools/common/toolsSlice";
import { store } from "src/store/store";
import { wsClient } from "../api/wsClient";
import type { WsEvent } from "../api/wsClient";

function handleEvent(event: WsEvent) {
  const { type, payload } = event;

  switch (type) {
    // ── Tools ─────────────────────────────────────────────────────────────────
    case "tools:created":
    case "tools:updated": {
      store.dispatch(upsertToolLocal(payload as AgentTool));
      break;
    }
    case "tools:deleted": {
      store.dispatch(removeToolLocal((payload as { id: string }).id));
      break;
    }
    case "tools:reordered": {
      const { folderId, toolIds } = payload as { folderId: string | null; toolIds: string[] };
      store.dispatch(reorderToolsLocal({ folderId, toolIds }));
      break;
    }

    // ── Tool Folders ──────────────────────────────────────────────────────────
    case "tool-folders:created":
    case "tool-folders:updated": {
      store.dispatch(upsertToolFolderLocal(payload as ToolFolderWithTools));
      break;
    }
    case "tool-folders:deleted": {
      store.dispatch(removeToolFolderLocal((payload as { id: string }).id));
      break;
    }
    case "tool-folders:reordered": {
      store.dispatch(reorderToolFoldersLocal((payload as { folderIds: string[] }).folderIds));
      break;
    }

    // ── MCP Servers ──────────────────────────────────────────────────────────

    case "my-mcp-servers:created":
    case "my-mcp-servers:updated": {
      store.dispatch(upsertMyMcpServerLocal(payload as MyMcpServer));
      break;
    }
    case "my-mcp-servers:deleted": {
      store.dispatch(removeMyMcpServerLocal((payload as { id: string }).id));
      break;
    }

    // ── KV Store ─────────────────────────────────────────────────────────────
    case "kvstore:created":
    case "kvstore:updated": {
      store.dispatch(upsertKvEntryLocal(payload as KvStoreEntry));
      break;
    }
    case "kvstore:deleted": {
      store.dispatch(removeKvEntryLocal((payload as { id: string }).id));
      break;
    }

    // ── Secrets ──────────────────────────────────────────────────────────────
    case "secrets:created":
    case "secrets:updated": {
      store.dispatch(upsertSecretLocal(payload as SecretEntry));
      break;
    }
    case "secrets:deleted": {
      store.dispatch(removeSecretLocal((payload as { id: string }).id));
      break;
    }

    default:
      break;
  }
}

export function useSocket(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !getAuthToken()) {
      wsClient.disconnect();
      return;
    }

    wsClient.connect();
    const unsub = wsClient.onAny(handleEvent);
    return () => {
      unsub();
      wsClient.disconnect();
    };
  }, [enabled]);
}
