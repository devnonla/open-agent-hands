import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";

import { authReducer } from "src/common/authSlice";
import { datatableProjectsReducer } from "src/modules/datatables/common/datatableProjectsSlice";
import { jobsReducer } from "src/modules/jobs/common/jobsSlice";
import { kvStoreReducer } from "src/modules/kvstore/common/kvStoreSlice";
import { myMcpServersReducer } from "src/modules/my-mcp-servers/common/myMcpServersSlice";
import { secretsReducer } from "src/modules/secrets/common/secretsSlice";
import { sitesReducer } from "src/modules/sites/common/sitesSlice";
import { toolFoldersReducer } from "src/modules/tools/common/toolFoldersSlice";
import { toolsReducer } from "src/modules/tools/common/toolsSlice";

export const resetWorkspaceState = () => ({ type: "workspace/reset" as const });

const appReducer = combineReducers({
    auth: authReducer,
    tools: toolsReducer,
    toolFolders: toolFoldersReducer,
    myMcpServers: myMcpServersReducer,
    kvStore: kvStoreReducer,
    secrets: secretsReducer,
    sites: sitesReducer,
    jobs: jobsReducer,
    datatableProjects: datatableProjectsReducer,
});

const rootReducer = (state: ReturnType<typeof appReducer> | undefined, action: { type: string }) => {
  if (action.type === "workspace/reset" && state) return appReducer({ auth: state.auth } as ReturnType<typeof appReducer>, action);
  return appReducer(state, action);
};

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// ─── Typed hooks — dùng thay cho useDispatch/useSelector thông thường ─────────
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector = <T>(selector: (state: RootState) => T): T => useSelector(selector);
