import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser, BBox } from "./types";

interface AppState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;

  selectedMemoryId: string | null;
  setSelectedMemoryId: (id: string | null) => void;

  openClusterKey: string | null;
  setOpenClusterKey: (key: string | null) => void;

  bbox: BBox | null;
  setBBox: (bbox: BBox) => void;

  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),

      selectedMemoryId: null,
      setSelectedMemoryId: (id) => set({ selectedMemoryId: id }),

      openClusterKey: null,
      setOpenClusterKey: (openClusterKey) => set({ openClusterKey }),

      bbox: null,
      setBBox: (bbox) => set({ bbox }),

      uploadOpen: false,
      setUploadOpen: (uploadOpen) => set({ uploadOpen }),
    }),
    {
      name: "atlas-auth",
      partialize: (s) => ({ token: s.token, user: s.user }),
    },
  ),
);
