import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { GenreTheme } from "@/contexts/theme-types";

interface ThemeContextType {
  theme: GenreTheme;
  setTheme: (theme: GenreTheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<GenreTheme>(() => {
    return (localStorage.getItem("reading-copilot-theme") as GenreTheme) || "default";
  });

  useEffect(() => {
    localStorage.setItem("reading-copilot-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
