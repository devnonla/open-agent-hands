import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { getAuthToken } from "./common/api";
import { fetchCurrentUser } from "./common/authSlice";
import { useSocket } from "./common/hooks/useSocket";
import { AppLayout } from "./components/AppLayout";

import { useAppDispatch } from "./store/store";
import "./index.css";

const ToolsPage = lazy(() => import("./modules/tools/ToolsPage"));
const SettingsPage = lazy(() => import("./modules/settings/SettingsPage"));
const LoginPage = lazy(() => import("./modules/auth/LoginPage"));
const SetupPage = lazy(() => import("./modules/auth/SetupPage"));
const EditToolPage = lazy(() => import("./modules/tools/[id]/EditToolPage"));
const ProfilePage = lazy(() => import("./modules/profile/ProfilePage"));
const MyMcpServersPage = lazy(() => import("./modules/my-mcp-servers/MyMcpServersPage"));
const McpServerPage = lazy(() => import("./modules/my-mcp-servers/[id]/McpServerPage"));
const KvStorePage = lazy(() => import("./modules/kvstore/KvStorePage"));
const StoragePage = lazy(() => import("./modules/storage/StoragePage"));
const SpacePage = lazy(() => import("./modules/storage/[space]/SpacePage"));
const SecretsPage = lazy(() => import("./modules/secrets/SecretsPage"));
const DatatablesPage = lazy(() => import("./modules/datatables/DatatablesPage"));
const DatatableProjectPage = lazy(() => import("./modules/datatables/[id]/page"));
const JobsPage = lazy(() => import("./modules/jobs/JobsPage"));
const JobEditPage = lazy(() => import("./modules/jobs/[id]/JobEditPage"));
const SitesPage = lazy(() => import("./modules/sites/SitesPage"));
const SiteEditorPage = lazy(() => import("./modules/sites/[id]/SiteEditorPage"));
const NotFoundPage = lazy(() => import("./modules/not-found/NotFoundPage"));

// ── Auth guard ──────────────────────────────────────────────────────────────
function LegacyMcpServerRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/mcp-servers/${id ?? ""}`} replace />;
}

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

  useSocket(!isAuthRoute);

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
          <Route path="/workspaces" element={<Navigate to="/tools" replace />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/tools" replace />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/tools/:id" element={<EditToolPage />} />
            <Route path="/mcp-servers" element={<MyMcpServersPage />} />
            <Route path="/mcp-servers/:id" element={<McpServerPage />} />
            <Route path="/my-mcp-servers" element={<Navigate to="/mcp-servers" replace />} />
            <Route path="/my-mcp-servers/:id" element={<LegacyMcpServerRedirect />} />
            <Route path="/sites" element={<SitesPage />} />
            <Route path="/sites/:id" element={<SiteEditorPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/kvstore" element={<KvStorePage />} />
            <Route path="/datatables" element={<DatatablesPage />} />
            <Route path="/datatables/:projectId/settings" element={<DatatableProjectPage />} />
            <Route path="/datatables/:projectId/schema" element={<DatatableProjectPage />} />
            <Route path="/datatables/:projectId" element={<DatatableProjectPage />} />
            <Route path="/storage" element={<StoragePage />} />
            <Route path="/storage/:space" element={<SpacePage />} />
            <Route path="/secrets" element={<SecretsPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:id/:section?" element={<JobEditPage />} />
            <Route path="/settings/*" element={<SettingsPage />} />
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
