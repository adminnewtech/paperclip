import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

export type Palette = "default" | "gold" | "ocean" | "emerald" | "violet";

export const PALETTES: { key: Palette; label: string; swatch: string }[] = [
  { key: "default", label: "Neutral", swatch: "oklch(0.205 0 0)" },
  { key: "gold", label: "Gold", swatch: "oklch(0.72 0.15 85)" },
  { key: "ocean", label: "Ocean", swatch: "oklch(0.6 0.16 240)" },
  { key: "emerald", label: "Emerald", swatch: "oklch(0.62 0.15 155)" },
  { key: "violet", label: "Violet", swatch: "oklch(0.58 0.2 290)" },
];

const PALETTE_KEYS = new Set<Palette>(PALETTES.map((entry) => entry.key));

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  palette: Palette;
  setPalette: (palette: Palette) => void;
}

const THEME_STORAGE_KEY = "paperclip.theme";
const PALETTE_STORAGE_KEY = "paperclip.palette";
const DARK_THEME_COLOR = "#18181b";
const LIGHT_THEME_COLOR = "#ffffff";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function resolvePaletteFromStorage(): Palette {
  if (typeof localStorage === "undefined") return "default";
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (stored && PALETTE_KEYS.has(stored as Palette)) {
      return stored as Palette;
    }
  } catch {
    // Ignore local storage read failures in restricted environments.
  }
  return "default";
}

function applyPalette(palette: Palette) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = palette;
}

function resolveThemeFromDocument(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const isDark = theme === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta instanceof HTMLMetaElement) {
    themeColorMeta.setAttribute("content", isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => resolveThemeFromDocument());
  const [palette, setPaletteState] = useState<Palette>(() => resolvePaletteFromStorage());

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const setPalette = useCallback((nextPalette: Palette) => {
    setPaletteState(nextPalette);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore local storage write failures in restricted environments.
    }
  }, [theme]);

  useEffect(() => {
    applyPalette(palette);
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    } catch {
      // Ignore local storage write failures in restricted environments.
    }
  }, [palette]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      palette,
      setPalette,
    }),
    [theme, setTheme, toggleTheme, palette, setPalette],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
