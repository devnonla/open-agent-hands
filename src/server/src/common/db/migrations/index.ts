import init from "./0001_init.sql" with { type: "text" };
import sites from "./0002_sites.sql" with { type: "text" };
import workspaces from "./0003_workspaces.sql" with { type: "text" };
import userTheme from "./0004_user_theme.sql" with { type: "text" };
import dropToolActive from "./0005_drop_tool_active.sql" with { type: "text" };
import jobRunsIo from "./0006_job_runs_io.sql" with { type: "text" };
import dropWorkspaces from "./0007_drop_workspaces.sql" with { type: "text" };
import kvProjects from "./0008_kv_projects.sql" with { type: "text" };
import kvDefaultProject from "./0009_kv_default_project.sql" with { type: "text" };
import storage from "./0010_storage.sql" with { type: "text" };

export const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "0001_init.sql", sql: init },
  { name: "0002_sites.sql", sql: sites },
  { name: "0003_workspaces.sql", sql: workspaces },
  { name: "0004_user_theme.sql", sql: userTheme },
  { name: "0005_drop_tool_active.sql", sql: dropToolActive },
  { name: "0006_job_runs_io.sql", sql: jobRunsIo },
  { name: "0007_drop_workspaces.sql", sql: dropWorkspaces },
  { name: "0008_kv_projects.sql", sql: kvProjects },
  { name: "0009_kv_default_project.sql", sql: kvDefaultProject },
  { name: "0010_storage.sql", sql: storage },
];
