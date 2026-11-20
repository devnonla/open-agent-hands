const STORAGE_KEY = "agenthands_workspace";
const COOKIE_NAME = "agenthands_workspace";

const listeners = new Set<() => void>();

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyWorkspace(): void {
  for (const listener of listeners) listener();
}

export function getCurrentWorkspaceId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setCurrentWorkspaceId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; Path=/; SameSite=Lax`;
  notifyWorkspace();
}

export function clearCurrentWorkspaceId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  notifyWorkspace();
}
