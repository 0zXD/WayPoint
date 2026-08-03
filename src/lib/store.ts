import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser, BBox, Memory } from "./types";

interface AppState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;

  selectedMemoryId: string | null;
  setSelectedMemoryId: (id: string | null) => void;

  openClusterKey: string | null;
  setOpenClusterKey: (key: string | null) => void;

  activeSearchPopupId: string | null;
  setActiveSearchPopupId: (id: string | null) => void;

  bbox: BBox | null;
  setBBox: (bbox: BBox) => void;

  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;

  editingMemory: Memory | null;
  setEditingMemory: (memory: Memory | null) => void;

  isPickingLocation: boolean;
  setIsPickingLocation: (isPicking: boolean) => void;

  pickedLocation: { lat: number; lng: number } | null;
  setPickedLocation: (loc: { lat: number; lng: number } | null) => void;
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

      activeSearchPopupId: null,
      setActiveSearchPopupId: (activeSearchPopupId) => set({ activeSearchPopupId }),

      bbox: null,
      setBBox: (bbox) => set({ bbox }),

      uploadOpen: false,
      setUploadOpen: (uploadOpen) => set({ uploadOpen }),

      editingMemory: null,
      setEditingMemory: (editingMemory) => set({ editingMemory, uploadOpen: !!editingMemory }),

      isPickingLocation: false,
      setIsPickingLocation: (isPickingLocation) => set({ isPickingLocation }),

      pickedLocation: null,
      setPickedLocation: (pickedLocation) => set({ pickedLocation }),
    }),
    {
      name: "atlas-auth",
      partialize: (s) => ({ token: s.token, user: s.user }),
    },
  ),
);
