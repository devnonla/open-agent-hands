import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getAuthToken } from "./common/api";
import { fetchCurrentUser } from "./common/authSlice";
import { useSocket } from "./common/hooks/useSocket";
import { AppLayout } from "./components/AppLayout";
import { WorkspaceGuard } from "./modules/workspaces/common/currentWorkspace";

import { useAppDispatch } from "./store/store";
import "./index.css";

const ToolsPage = lazy(() => import("./modules/tools/ToolsPage"));
const SettingsPage = lazy(() => import("./modules/settings/SettingsPage"));
const LoginPage = lazy(() => import("./modules/auth/LoginPage"));
const SetupPage = lazy(() => import("./modules/auth/SetupPage"));
const EditToolPage = lazy(() => import("./modules/tools/[id]/EditToolPage"));
const ProfilePage = lazy(() => import("./modules/profile/ProfilePage"));
const MyMcpServersPage = lazy(() => import("./modules/my-mcp-servers/MyMcpServersPage"));
const KvStorePage = lazy(() => import("./modules/kvstore/KvStorePage"));
const SecretsPage = lazy(() => import("./modules/secrets/SecretsPage"));
const DatatablesPage = lazy(() => import("./modules/datatables/DatatablesPage"));
const DatatableProjectPage = lazy(() => import("./modules/datatables/[id]/page"));
const JobsPage = lazy(() => import("./modules/jobs/JobsPage"));
const JobEditPage = lazy(() => import("./modules/jobs/[id]/JobEditPage"));
const SitesPage = lazy(() => import("./modules/sites/SitesPage"));
const SiteEditorPage = lazy(() => import("./modules/sites/[id]/SiteEditorPage"));
const WorkspacesPage = lazy(() => import("./modules/workspaces/WorkspacesPage"));
const NotFoundPage = lazy(() => import("./modules/not-found/NotFoundPage"));

// ── Auth guard ──────────────────────────────────────────────────────────────
function AuthGuard() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate("/login", { replace: true });
    } else {
      dispatch(fetchCurrentUser());
    }
    // Only run once on mount — no need to re-fetch on every route change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!getAuthToken()) return null;
  return <Outlet />;
}

// ── Main content ─────────────────────────────────────────────────────────────

function AppContent() {
  const location = useLocation();

  const isLoginRoute = location.pathname === "/login";
  const isSetupRoute = location.pathname === "/setup";
  const isAuthRoute = isLoginRoute || isSetupRoute;
  const isWorkspacePicker = location.pathname === "/workspaces";

  useSocket(!isAuthRoute && !isWorkspacePicker);

  // Login/Setup routes → full-width, no auth
  if (isAuthRoute) {
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
        </Routes>
      </Suspense>
    );
  }

  // App routes — protected pages under AuthGuard; unknown paths → 404
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route element={<AuthGuard />}>
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route element={<WorkspaceGuard />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/tools" replace />} />
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/tools/:id" element={<EditToolPage />} />
              <Route path="/mcp-servers" element={<Navigate to="/my-mcp-servers" replace />} />
              <Route path="/my-mcp-servers" element={<MyMcpServersPage />} />
              <Route path="/sites" element={<SitesPage />} />
              <Route path="/sites/:id" element={<SiteEditorPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/kvstore" element={<KvStorePage />} />
              <Route path="/datatables" element={<DatatablesPage />} />
              <Route path="/datatables/:projectId/settings" element={<DatatableProjectPage />} />
              <Route path="/datatables/:projectId/schema" element={<DatatableProjectPage />} />
              <Route path="/datatables/:projectId" element={<DatatableProjectPage />} />
              <Route path="/secrets" element={<SecretsPage />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/jobs/:id/:section?" element={<JobEditPage />} />
              <Route path="/settings/*" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
