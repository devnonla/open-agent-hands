import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();

export function runInWorkspace<T>(workspaceId: string, fn: () => T): T {
  return storage.run(workspaceId, fn);
}

export function currentWorkspaceId(): string {
  const id = storage.getStore();
  if (!id) throw new Error("No workspace in context");
  return id;
}

export function workspaceIdOrNull(): string | null {
  return storage.getStore() ?? null;
}
