import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getCurrentWorkspaceId, setCurrentWorkspaceId, subscribeWorkspace } from "src/common/workspace";
import { type Workspace, listWorkspaces } from "./workspacesApi";

type CurrentWorkspaceValue = { workspace: Workspace; setWorkspace: (workspace: Workspace) => void };

const CurrentWorkspaceContext = createContext<CurrentWorkspaceValue | null>(null);

export function useCurrentWorkspace(): Workspace | null {
  return useContext(CurrentWorkspaceContext)?.workspace ?? null;
}

export function useSetCurrentWorkspace(): (workspace: Workspace) => void {
  const ctx = useContext(CurrentWorkspaceContext);
  return ctx?.setWorkspace ?? (() => {});
}

export function WorkspaceGuard() {
  const selectedId = useSyncExternalStore(subscribeWorkspace, getCurrentWorkspaceId);
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; workspace: Workspace } | { status: "missing" }>({ status: "loading" });

  useEffect(() => {
    setState((prev) => (selectedId && prev.status === "ready" && prev.workspace.id === selectedId ? prev : { status: "loading" }));
    let cancelled = false;
    listWorkspaces()
      .then((items) => {
        if (cancelled) return;
        const workspace = items.find((w) => w.id === selectedId);
        if (workspace) {
          setState({ status: "ready", workspace });
          return;
        }
        const fallback = items.find((w) => w.isDefault) ?? items[0];
        if (fallback) setCurrentWorkspaceId(fallback.id);
        else setState({ status: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  if (state.status === "missing") return <Navigate to="/workspaces" replace />;
  if (state.status === "loading" || !selectedId) return null;
  return (
    <CurrentWorkspaceContext.Provider value={{ workspace: state.workspace, setWorkspace: (workspace) => setState({ status: "ready", workspace }) }}>
      <Outlet key={state.workspace.id} />
    </CurrentWorkspaceContext.Provider>
  );
}
