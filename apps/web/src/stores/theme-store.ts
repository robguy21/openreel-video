import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "auto";

interface ThemeState {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const getSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const calculateIsDark = (mode: ThemeMode): boolean => {
  if (mode === "auto") {
    return getSystemTheme() === "dark";
  }
  return mode === "dark";
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      // Dark by default: Clip Studio, which embeds this editor, is dark-only, and the
      // toggle in the action rail still cycles dark -> auto -> light for anyone who wants it.
      mode: "dark",
      isDark: true,

      setMode: (mode: ThemeMode) => {
        const isDark = calculateIsDark(mode);
        set({ mode, isDark });

        if (isDark) {
          document.documentElement.classList.add("dark");
          document.documentElement.dataset.theme = "dark";
        } else {
          document.documentElement.classList.remove("dark");
          document.documentElement.dataset.theme = "light";
        }
      },

      toggleTheme: () => {
        const currentMode = get().mode;
        const nextMode: ThemeMode =
          currentMode === "light"
            ? "dark"
            : currentMode === "dark"
              ? "auto"
              : "light";
        get().setMode(nextMode);
      },
    }),
    {
      name: "openreel-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          const isDark = calculateIsDark(state.mode);
          state.isDark = isDark;
          if (isDark) {
            document.documentElement.classList.add("dark");
            document.documentElement.dataset.theme = "dark";
          } else {
            document.documentElement.classList.remove("dark");
            document.documentElement.dataset.theme = "light";
          }
        }
      },
    },
  ),
);

if (typeof window !== "undefined") {
  // First visit (nothing persisted yet): paint the default before React mounts so the
  // page never flashes light.
  let hasPersistedTheme = false;
  try {
    hasPersistedTheme = window.localStorage.getItem("openreel-theme") !== null;
  } catch {
    /* storage blocked: stay with the in-memory default */
  }
  if (!hasPersistedTheme) {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  mediaQuery.addEventListener("change", (e) => {
    const state = useThemeStore.getState();
    if (state.mode === "auto") {
      const isDark = e.matches;
      useThemeStore.setState({ isDark });

      if (isDark) {
        document.documentElement.classList.add("dark");
        document.documentElement.dataset.theme = "dark";
      } else {
        document.documentElement.classList.remove("dark");
        document.documentElement.dataset.theme = "light";
      }
    }
  });
}
