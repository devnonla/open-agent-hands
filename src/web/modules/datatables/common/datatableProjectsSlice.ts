import { type PayloadAction, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { DatatableProject } from "src/common/types";
import { datatablesApi } from "./datatablesApi";

export type DatatableProjectTableRef = { id: string; name: string };

export type DatatableProjectListItem = DatatableProject & { tableCount: number; tableNames: string[]; tables: DatatableProjectTableRef[] };

interface IDatatableProjectsState {
  total: number;
  items: DatatableProjectListItem[];
}

const initialState: IDatatableProjectsState = {
  total: 0,
  items: [],
};

export const fetchDatatableProjects = createAsyncThunk("datatableProjects/list", async (_, { rejectWithValue }) => {
  try {
    return await datatablesApi.listProjects();
  } catch (err: unknown) {
    return rejectWithValue(err instanceof Error ? err.message : "Failed to fetch projects");
  }
});

export const updateDatatableProject = createAsyncThunk("datatableProjects/update", async ({ id, name }: { id: string; name: string }, { rejectWithValue }) => {
  try {
    return await datatablesApi.updateProject(id, name);
  } catch (err: unknown) {
    return rejectWithValue(err instanceof Error ? err.message : "Failed to update project");
  }
});

export const deleteDatatableProject = createAsyncThunk("datatableProjects/delete", async (id: string, { rejectWithValue }) => {
  try {
    await datatablesApi.deleteProject(id);
    return { id };
  } catch (err: unknown) {
    return rejectWithValue(err instanceof Error ? err.message : "Failed to delete project");
  }
});

const datatableProjectsSlice = createSlice({
  name: "datatableProjects",
  initialState,
  reducers: {
    upsertLocal(state, { payload }: PayloadAction<DatatableProjectListItem>) {
      const index = state.items.findIndex((item) => item.id === payload.id);
      if (index >= 0) {
        state.items[index] = { ...state.items[index], ...payload };
      } else {
        state.items.push(payload);
        state.total = state.items.length;
      }
    },
    removeLocal(state, { payload }: PayloadAction<string>) {
      state.items = state.items.filter((item) => item.id !== payload);
      state.total = state.items.length;
    },
    setTablesLocal(state, { payload }: PayloadAction<{ projectId: string; tables: DatatableProjectTableRef[] }>) {
      const item = state.items.find((entry) => entry.id === payload.projectId);
      if (!item) return;
      const tables = [...payload.tables].sort((a, b) => a.name.localeCompare(b.name));
      item.tables = tables;
      item.tableNames = tables.map((table) => table.name);
      item.tableCount = tables.length;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDatatableProjects.fulfilled, (state, action) => {
        state.items = action.payload;
        state.total = action.payload.length;
      })
      .addCase(updateDatatableProject.fulfilled, (state, action) => {
        const index = state.items.findIndex((item) => item.id === action.payload.id);
        if (index >= 0) {
          state.items[index] = { ...state.items[index], ...action.payload };
        }
      })
      .addCase(deleteDatatableProject.fulfilled, (state, action) => {
        state.items = state.items.filter((item) => item.id !== action.payload.id);
        state.total = state.items.length;
      });
  },
});

export const { upsertLocal: upsertDatatableProjectLocal, removeLocal: removeDatatableProjectLocal, setTablesLocal: setDatatableProjectTables } = datatableProjectsSlice.actions;
export const datatableProjectsReducer = datatableProjectsSlice.reducer;
export default datatableProjectsReducer;
