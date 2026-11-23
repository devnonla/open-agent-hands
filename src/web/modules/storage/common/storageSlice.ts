import { type PayloadAction, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { apiClient } from "src/common/api";
import type { StorageSpace, StorageFolder, StorageFile } from "src/common/types";

export interface IStorageState {
  spaces: StorageSpace[];
  spacesLoaded: boolean;
  view: { spaceId: string; prefix: string } | null;
  folders: StorageFolder[];
  files: StorageFile[];
  filesLoading: boolean;
  filesError: string | null;
}

const initialState: IStorageState = { spaces: [], spacesLoaded: false, view: null, folders: [], files: [], filesLoading: false, filesError: null };

type BrowseResult = { prefix: string; folders: StorageFolder[]; items: StorageFile[] };

export const fetchStorageSpaces = createAsyncThunk("storage/spaces", async () => apiClient.get<{ items: StorageSpace[] }>("/api/storage/spaces"));

export const fetchStorageView = createAsyncThunk("storage/browse", async ({ spaceId, prefix }: { spaceId: string; prefix: string }) => ({ spaceId, ...(await apiClient.get<BrowseResult>(`/api/storage/spaces/${spaceId}/browse`, { prefix })) }));

export const updateStorageSpace = createAsyncThunk("storage/updateSpace", async ({ id, ...data }: { id: string; isPublic?: boolean; description?: string | null }, { dispatch, getState }) => {
  const space = await apiClient.put<StorageSpace>(`/api/storage/spaces/${id}`, data);
  const view = (getState() as { storage: IStorageState }).storage.view;
  if (view?.spaceId === id) void dispatch(fetchStorageView(view));
  return space;
});

export const resetStoragePublicLink = createAsyncThunk("storage/resetLink", async (id: string) => apiClient.post<StorageFile>(`/api/storage/files/${id}/reset-link`));

export const deleteStorageSpace = createAsyncThunk("storage/deleteSpace", async (id: string) => {
  await apiClient.delete(`/api/storage/spaces/${id}`);
  return id;
});

export const deleteStorageFile = createAsyncThunk("storage/deleteFile", async (file: StorageFile) => {
  await apiClient.delete(`/api/storage/files/${file.id}`);
  return file;
});

export function isInView(state: IStorageState, file: { spaceId: string; key?: string }): boolean {
  if (!state.view || state.view.spaceId !== file.spaceId || file.key === undefined) return false;
  return file.key.startsWith(state.view.prefix) && !file.key.slice(state.view.prefix.length).includes("/");
}

function upsertSpace(state: IStorageState, space: StorageSpace) {
  const index = state.spaces.findIndex((item) => item.id === space.id);
  if (index >= 0) state.spaces[index] = { ...state.spaces[index], ...space };
  else state.spaces.push(space);
  state.spaces.sort((a, b) => a.name.localeCompare(b.name));
}

function upsertObject(state: IStorageState, file: StorageFile) {
  if (!isInView(state, file)) return;
  const existing = state.files.find((item) => item.id === file.id);
  if (existing) {
    Object.assign(existing, file);
    return;
  }
  state.files.push(file);
  state.files.sort((a, b) => a.key.localeCompare(b.key));
}

function removeObject(state: IStorageState, id: string) {
  state.files = state.files.filter((item) => item.id !== id);
}

function removeSpace(state: IStorageState, id: string) {
  state.spaces = state.spaces.filter((item) => item.id !== id);
  if (state.view?.spaceId === id) {
    state.view = null;
    state.folders = [];
    state.files = [];
  }
}

const storageSlice = createSlice({
  name: "storage",
  initialState,
  reducers: {
    upsertStorageSpaceLocal(state, { payload }: PayloadAction<StorageSpace>) {
      upsertSpace(state, payload);
    },
    removeStorageSpaceLocal(state, { payload }: PayloadAction<string>) {
      removeSpace(state, payload);
    },
    upsertStorageFileLocal(state, { payload }: PayloadAction<StorageFile>) {
      upsertObject(state, payload);
    },
    removeStorageFileLocal(state, { payload }: PayloadAction<string>) {
      removeObject(state, payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchStorageSpaces.fulfilled, (state, { payload }) => {
        state.spaces = payload.items;
        state.spacesLoaded = true;
      })
      .addCase(fetchStorageView.pending, (state, { meta }) => {
        state.filesLoading = true;
        state.filesError = null;
        if (state.view?.spaceId !== meta.arg.spaceId || state.view.prefix !== meta.arg.prefix) {
          state.view = { spaceId: meta.arg.spaceId, prefix: meta.arg.prefix };
          state.folders = [];
          state.files = [];
        }
      })
      .addCase(fetchStorageView.fulfilled, (state, { payload, meta }) => {
        if (state.view?.spaceId !== meta.arg.spaceId || state.view.prefix !== meta.arg.prefix) return;
        state.folders = payload.folders;
        state.files = payload.items;
        state.filesLoading = false;
      })
      .addCase(fetchStorageView.rejected, (state, { meta, error }) => {
        if (state.view?.spaceId !== meta.arg.spaceId || state.view.prefix !== meta.arg.prefix) return;
        state.filesLoading = false;
        state.filesError = error.message ?? "Failed to load files";
      })
      .addCase(updateStorageSpace.fulfilled, (state, { payload }) => upsertSpace(state, payload))
      .addCase(resetStoragePublicLink.fulfilled, (state, { payload }) => upsertObject(state, payload))
      .addCase(deleteStorageSpace.fulfilled, (state, { payload }) => removeSpace(state, payload))
      .addCase(deleteStorageFile.fulfilled, (state, { payload }) => removeObject(state, payload.id));
  },
});

export const { upsertStorageSpaceLocal, removeStorageSpaceLocal, upsertStorageFileLocal, removeStorageFileLocal } = storageSlice.actions;
export const storageReducer = storageSlice.reducer;
