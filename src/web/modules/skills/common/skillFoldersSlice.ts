import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { apiClient } from "src/common/api";
import type { SkillFolder } from "src/common/types";

export interface SkillFolderWithSkills extends SkillFolder {
  skillIds: string[];
}

export interface ISkillFoldersState {
  folders: SkillFolderWithSkills[];
  loading: boolean;
}

const initialState: ISkillFoldersState = {
  folders: [],
  loading: false,
};

function applyFolderOrder(folders: SkillFolderWithSkills[], folderIds: string[]): SkillFolderWithSkills[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const ordered: SkillFolderWithSkills[] = [];
  for (let i = 0; i < folderIds.length; i++) {
    const folder = byId.get(folderIds[i]);
    if (!folder) continue;
    ordered.push({ ...folder, sortOrder: i });
    byId.delete(folderIds[i]);
  }
  for (const leftover of byId.values()) {
    ordered.push(leftover);
  }
  return ordered;
}

export const fetchSkillFolders = createAsyncThunk("skillFolders/fetch", async () => {
  const res = await apiClient.get<{ items: SkillFolderWithSkills[]; total: number }>("/api/skill-folders");
  return res.items;
});

export const createSkillFolder = createAsyncThunk("skillFolders/create", async (data: { name: string; description?: string }) => {
  return await apiClient.post<SkillFolderWithSkills>("/api/skill-folders", data);
});

export const updateSkillFolder = createAsyncThunk("skillFolders/update", async ({ id, ...data }: { id: string } & Partial<Pick<SkillFolder, "name" | "description">>) => {
  await apiClient.put(`/api/skill-folders/${id}`, data);
  return { id, ...data };
});

export const reorderSkillFolders = createAsyncThunk("skillFolders/reorder", async (folderIds: string[]) => {
  await apiClient.put("/api/skill-folders/reorder", { folderIds });
  return folderIds;
});

export const deleteSkillFolder = createAsyncThunk("skillFolders/delete", async (id: string) => {
  await apiClient.delete(`/api/skill-folders/${id}`);
  return id;
});

const skillFoldersSlice = createSlice({
  name: "skillFolders",
  initialState,
  reducers: {
    upsertSkillFolderLocal(state, { payload }: { payload: SkillFolderWithSkills }) {
      const idx = state.folders.findIndex((folder) => folder.id === payload.id);
      if (idx >= 0) {
        state.folders[idx] = { ...state.folders[idx], ...payload };
      } else {
        state.folders.push(payload);
      }
    },
    removeSkillFolderLocal(state, { payload }: { payload: string }) {
      state.folders = state.folders.filter((folder) => folder.id !== payload);
    },
    reorderSkillFoldersLocal(state, { payload }: { payload: string[] }) {
      state.folders = applyFolderOrder(state.folders, payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSkillFolders.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchSkillFolders.fulfilled, (state, action) => {
        state.folders = action.payload;
        state.loading = false;
      })
      .addCase(fetchSkillFolders.rejected, (state) => {
        state.loading = false;
      })
      .addCase(createSkillFolder.fulfilled, (state, action) => {
        if (!state.folders.some((folder) => folder.id === action.payload.id)) {
          state.folders.push(action.payload);
        }
      })
      .addCase(updateSkillFolder.fulfilled, (state, action) => {
        const { id, ...data } = action.payload;
        const idx = state.folders.findIndex((folder) => folder.id === id);
        if (idx >= 0) {
          state.folders[idx] = { ...state.folders[idx], ...data };
        }
      })
      .addCase(reorderSkillFolders.fulfilled, (state, action) => {
        state.folders = applyFolderOrder(state.folders, action.payload);
      })
      .addCase(deleteSkillFolder.fulfilled, (state, action) => {
        state.folders = state.folders.filter((folder) => folder.id !== action.payload);
      });
  },
});

export const { upsertSkillFolderLocal, removeSkillFolderLocal, reorderSkillFoldersLocal } = skillFoldersSlice.actions;
export const skillFoldersReducer = skillFoldersSlice.reducer;
export default skillFoldersReducer;
