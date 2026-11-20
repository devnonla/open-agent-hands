const STORAGE_KEY = "agenthands_workspace";
const COOKIE_NAME = "agenthands_workspace";

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
}

export function clearCurrentWorkspaceId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function enterWorkspace(id: string, path = "/tools"): void {
  setCurrentWorkspaceId(id);
  window.location.assign(path);
}

export function leaveWorkspace(): void {
  clearCurrentWorkspaceId();
  window.location.assign("/workspaces");
}
