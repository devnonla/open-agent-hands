import { workspaceIdOrNull } from "../workspace/workspace-context.js";
import type { ServerWebSocket } from "bun";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WsEventType =
  | "tools:created"
  | "tools:updated"
  | "tools:deleted"
  | "tools:reordered"
  | "tool-folders:created"
  | "tool-folders:updated"
  | "tool-folders:deleted"
  | "tool-folders:reordered"
  | "my-mcp-servers:created"
  | "my-mcp-servers:updated"
  | "my-mcp-servers:deleted"
  | "kvstore:created"
  | "kvstore:updated"
  | "kvstore:deleted"
  | "datatables:project-created"
  | "datatables:project-updated"
  | "datatables:project-deleted"
  | "datatables:table-created"
  | "datatables:table-updated"
  | "datatables:table-deleted"
  | "datatables:column-created"
  | "datatables:column-updated"
  | "datatables:column-deleted"
  | "datatables:columns-reordered"
  | "datatables:rows-created"
  | "datatables:row-updated"
  | "datatables:row-deleted"
  | "datatables:rows-deleted"
  | "secrets:created"
  | "secrets:updated"
  | "secrets:deleted"
  | "jobs:created"
  | "jobs:updated"
  | "jobs:deleted"
  | "job_runs:created"
  | "job_runs:updated"
  | "job_runs:log"
  | "sites:created"
  | "sites:updated"
  | "sites:deleted"
  | "workspaces:created"
  | "workspaces:updated"
  | "workspaces:deleted"
  | "ping";

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
}

export type WsClientData = {
  clientId: string;
  userId: string;
};

type ClientEntry = {
  ws: ServerWebSocket<WsClientData>;
  userId: string;
  workspaceId: string | null;
};

function isGlobalEvent(type: WsEventType): boolean {
  return type.startsWith("workspaces:") || type === "ping";
}

// ─── Hub ──────────────────────────────────────────────────────────────────────

class WsHub {
  private clients = new Map<string, ClientEntry>();

  add(ws: ServerWebSocket<WsClientData>, clientId: string, meta: { userId: string }) {
    this.clients.set(clientId, { ws, userId: meta.userId, workspaceId: null });
  }

  selectWorkspace(clientId: string, workspaceId: string | null) {
    const client = this.clients.get(clientId);
    if (client) client.workspaceId = workspaceId;
  }

  remove(clientId: string) {
    this.clients.delete(clientId);
  }

  broadcast<T>(type: WsEventType, payload: T, workspaceId: string | null = null) {
    if (this.clients.size === 0) return;
    const msg = JSON.stringify({ type, payload } satisfies WsEvent<T>);
    for (const client of this.clients.values()) {
      if (workspaceId && client.workspaceId !== workspaceId) continue;
      try {
        client.ws.send(msg);
      } catch {
        // ignore dead sockets — will be removed on close
      }
    }
  }

  /** Send to a specific client by clientId */
  send<T>(clientId: string, type: WsEventType, payload: T) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    try {
      client.ws.send(JSON.stringify({ type, payload } satisfies WsEvent<T>));
      return true;
    } catch {
      return false;
    }
  }

  emit<T>(type: WsEventType, payload: T) {
    this.broadcast(type, payload, isGlobalEvent(type) ? null : workspaceIdOrNull());
  }

  get size() {
    return this.clients.size;
  }

  /** Test helper — drop all tracked clients without closing sockets. */
  _resetForTests() {
    this.clients.clear();
  }
}

export const wsHub = new WsHub();
