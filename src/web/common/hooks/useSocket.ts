import { useEffect } from "react";
import { getAuthToken } from "src/common/api";
import type { AgentTool, KvProject, KvStoreEntry, MyMcpServer, SecretEntry, StorageSpace, StorageFile } from "src/common/types";
import { fetchKvProjects, removeKvProjectLocal, upsertKvProjectLocal } from "src/modules/kvstore/common/kvProjectsSlice";
import { removeKvEntryLocal, upsertKvEntryLocal } from "src/modules/kvstore/common/kvStoreSlice";
import { removeMyMcpServerLocal, upsertMyMcpServerLocal } from "src/modules/my-mcp-servers/common/myMcpServersSlice";
import { removeSecretLocal, upsertSecretLocal } from "src/modules/secrets/common/secretsSlice";
import { fetchStorageSpaces, fetchStorageView, isInView, removeStorageSpaceLocal, removeStorageFileLocal, upsertStorageSpaceLocal, upsertStorageFileLocal } from "src/modules/storage/common/storageSlice";
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
      const entry = payload as KvStoreEntry;
      if (entry.projectId === store.getState().kvStore.filter.project) store.dispatch(upsertKvEntryLocal(entry));
      if (type === "kvstore:created" && store.getState().kvProjects.loaded) void store.dispatch(fetchKvProjects());
      break;
    }
    case "kvstore:deleted": {
      store.dispatch(removeKvEntryLocal((payload as { id: string }).id));
      if (store.getState().kvProjects.loaded) void store.dispatch(fetchKvProjects());
      break;
    }
    case "kvprojects:created":
    case "kvprojects:updated": {
      store.dispatch(upsertKvProjectLocal(payload as KvProject));
      break;
    }
    case "kvprojects:deleted": {
      store.dispatch(removeKvProjectLocal((payload as { id: string }).id));
      break;
    }

    // ── Storage ──────────────────────────────────────────────────────────────
    case "storage:space-created":
    case "storage:space-updated": {
      store.dispatch(upsertStorageSpaceLocal(payload as StorageSpace));
      break;
    }
    case "storage:space-deleted": {
      store.dispatch(removeStorageSpaceLocal((payload as { id: string }).id));
      break;
    }
    case "storage:file-created":
    case "storage:file-updated":
    case "storage:file-deleted": {
      const object = payload as StorageFile;
      const { storage } = store.getState();
      if (!storage.spacesLoaded) break;
      void store.dispatch(fetchStorageSpaces());
      if (storage.view?.spaceId !== object.spaceId) break;
      if (type === "storage:file-deleted" && isInView(storage, object)) {
        store.dispatch(removeStorageFileLocal(object.id));
      } else if (type !== "storage:file-deleted" && isInView(storage, object)) {
        store.dispatch(upsertStorageFileLocal(object));
      } else if (object.key.startsWith(storage.view.prefix)) {
        void store.dispatch(fetchStorageView(storage.view));
      }
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
