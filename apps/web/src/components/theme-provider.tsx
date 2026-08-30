"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "dark" | "light";

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("leetcollab-theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
    setPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (preferenceLoaded) window.localStorage.setItem("leetcollab-theme", theme);
  }, [preferenceLoaded, theme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme: () => setTheme((value) => value === "dark" ? "light" : "dark"),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
