/**
 * Auth slice — stores current authenticated user info.
 * Fetches /api/auth/me on app init to populate user data.
 */

import { type PayloadAction, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { getColorPreference, setColorPreference } from "devnonla-ui";
import { apiClient } from "src/common/api";
import type { User } from "src/common/types";

// ─── State ────────────────────────────────────────────────────────────────────

export interface IAuthState {
  user: User | null;
  loaded: boolean;
}

const initialState: IAuthState = {
  user: null,
  loaded: false,
};

// ─── Thunks ───────────────────────────────────────────────────────────────────

export const fetchCurrentUser = createAsyncThunk("auth/fetchCurrentUser", async () => {
  const user = await apiClient.get<User>("/api/auth/me");
  if (user.theme && user.theme !== getColorPreference()) setColorPreference(user.theme);
  return user;
});

// ─── Slice ────────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUserTheme(state, action: PayloadAction<User["theme"]>) {
      if (state.user) state.user.theme = action.payload;
    },
    clearCurrentUser(state) {
      state.user = null;
      state.loaded = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.user = action.payload;
        state.loaded = true;
      })
      .addCase(fetchCurrentUser.rejected, (state) => {
        state.user = null;
        state.loaded = true;
      });
  },
});

export const { clearCurrentUser, setUserTheme } = authSlice.actions;
export const authReducer = authSlice.reducer;
export default authReducer;
