import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { apiClient } from "src/common/api";
import type { KvProject } from "src/common/types";

export const DEFAULT_PROJECT = "default";

export interface IKvProjectsState {
  items: KvProject[];
  loaded: boolean;
}

const initialState: IKvProjectsState = { items: [], loaded: false };

export const fetchKvProjects = createAsyncThunk("kvProjects/fetch", async () => apiClient.get<{ items: KvProject[] }>("/api/kvstore/projects"));

export const updateKvProject = createAsyncThunk("kvProjects/update", async ({ id, ...data }: { id: string; name?: string; description?: string | null }) => apiClient.put<KvProject>(`/api/kvstore/projects/${id}`, data));

export const deleteKvProject = createAsyncThunk("kvProjects/delete", async (id: string) => {
  await apiClient.delete(`/api/kvstore/projects/${id}`);
  return id;
});

function sortByName(items: KvProject[]) {
  return items.sort((a, b) => Number(b.name === DEFAULT_PROJECT) - Number(a.name === DEFAULT_PROJECT) || a.name.localeCompare(b.name));
}

function upsert(state: IKvProjectsState, project: KvProject) {
  const index = state.items.findIndex((item) => item.id === project.id);
  if (index >= 0) state.items[index] = { ...state.items[index], ...project, keyCount: project.keyCount ?? state.items[index].keyCount };
  else state.items.push({ ...project, keyCount: project.keyCount ?? 0 });
  sortByName(state.items);
}

const kvProjectsSlice = createSlice({
  name: "kvProjects",
  initialState,
  reducers: {
    upsertKvProjectLocal(state, { payload }: PayloadAction<KvProject>) {
      upsert(state, payload);
    },
    removeKvProjectLocal(state, { payload }: PayloadAction<string>) {
      state.items = state.items.filter((item) => item.id !== payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchKvProjects.fulfilled, (state, { payload }) => {
        state.items = sortByName(payload.items);
        state.loaded = true;
      })
      .addCase(updateKvProject.fulfilled, (state, { payload }) => upsert(state, payload))
      .addCase(deleteKvProject.fulfilled, (state, { payload }) => {
        state.items = state.items.filter((item) => item.id !== payload);
      });
  },
});

export const { upsertKvProjectLocal, removeKvProjectLocal } = kvProjectsSlice.actions;
export const kvProjectsReducer = kvProjectsSlice.reducer;
