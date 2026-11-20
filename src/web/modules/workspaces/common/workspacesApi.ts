import { apiClient } from "src/common/api";

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceInput = { name: string; description?: string | null };

export async function listWorkspaces(): Promise<Workspace[]> {
  return (await apiClient.get<{ items: Workspace[] }>("/api/workspaces")).items;
}

export function createWorkspace(body: WorkspaceInput): Promise<Workspace> {
  return apiClient.post<Workspace>("/api/workspaces", body);
}

export function updateWorkspace(id: string, body: WorkspaceInput): Promise<Workspace> {
  return apiClient.put<Workspace>(`/api/workspaces/${id}`, body);
}

export function deleteWorkspace(id: string): Promise<{ ok: boolean }> {
  return apiClient.delete<{ ok: boolean }>(`/api/workspaces/${id}`);
}
