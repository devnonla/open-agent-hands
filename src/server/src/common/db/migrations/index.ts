import init from "./0001_init.sql" with { type: "text" };
import sites from "./0002_sites.sql" with { type: "text" };
import workspaces from "./0003_workspaces.sql" with { type: "text" };
import userTheme from "./0004_user_theme.sql" with { type: "text" };

export const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "0001_init.sql", sql: init },
  { name: "0002_sites.sql", sql: sites },
  { name: "0003_workspaces.sql", sql: workspaces },
  { name: "0004_user_theme.sql", sql: userTheme },
];
