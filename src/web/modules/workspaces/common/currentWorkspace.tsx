import { createContext, useContext, useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { clearCurrentWorkspaceId, getCurrentWorkspaceId } from "src/common/workspace";
import { type Workspace, listWorkspaces } from "./workspacesApi";

const CurrentWorkspaceContext = createContext<Workspace | null>(null);

export function useCurrentWorkspace(): Workspace | null {
  return useContext(CurrentWorkspaceContext);
}

export function WorkspaceGuard() {
  const selectedId = getCurrentWorkspaceId();
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; workspace: Workspace } | { status: "missing" }>({ status: "loading" });

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    listWorkspaces()
      .then((items) => {
        if (cancelled) return;
        const workspace = items.find((w) => w.id === selectedId);
        if (workspace) {
          setState({ status: "ready", workspace });
        } else {
          clearCurrentWorkspaceId();
          setState({ status: "missing" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  if (!selectedId || state.status === "missing") return <Navigate to="/workspaces" replace />;
  if (state.status === "loading") return null;
  return (
    <CurrentWorkspaceContext.Provider value={state.workspace}>
      <Outlet />
    </CurrentWorkspaceContext.Provider>
  );
}
