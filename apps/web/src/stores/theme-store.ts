import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "auto";

interface ThemeState {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

/**
 * Dark only. Clip Studio, which embeds this editor, has one theme and no toggle
 * (DESIGN.md standards 1-3; docs/PROPOSAL_EDITOR_REDESIGN.md R1.4), so whatever a caller
 * or an old saved preference asks for, the page is painted dark. The store keeps its
 * shape so upstream code that reads `mode` or `isDark` keeps compiling.
 */
const paintDark = (): void => {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.theme = "dark";
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "dark",
      isDark: true,

      setMode: () => {
        set({ mode: "dark", isDark: true });
        paintDark();
      },

      toggleTheme: () => {
        set({ mode: "dark", isDark: true });
        paintDark();
      },
    }),
    {
      name: "openreel-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.mode = "dark";
          state.isDark = true;
        }
        paintDark();
      },
    },
  ),
);

// Paint before React mounts so the page never flashes light.
paintDark();
