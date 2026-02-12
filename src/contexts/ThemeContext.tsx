/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import type { GenreTheme } from "@/contexts/theme-types";
import { supabase } from "@/integrations/supabase/client";
import { ensureProfileForUser } from "@/lib/profiles";

const STORAGE_KEY = "shelfguide-theme";
const LEGACY_STORAGE_KEY = "reading-copilot-theme";

interface ThemeContextType {
  theme: GenreTheme;
  setTheme: (theme: GenreTheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<GenreTheme>(() => {
    return (
      (localStorage.getItem(STORAGE_KEY) as GenreTheme) ||
      (localStorage.getItem(LEGACY_STORAGE_KEY) as GenreTheme) ||
      "default"
    );
  });
  const [userId, setUserId] = useState<string | null>(null);
  const allowPersistRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const loadTheme = async (id: string) => {
      const { data } = await supabase
        .from("copilot_preferences")
        .select("ui_theme")
        .eq("user_id", id)
        .maybeSingle();
      if (data?.ui_theme) {
        setTheme(data.ui_theme as GenreTheme);
      }
    };

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      setUserId(user?.id ?? null);
      if (user?.id) {
        try {
          await ensureProfileForUser(user);
        } catch {
          // profiles table may not exist yet in local/dev before migration
        }
        await loadTheme(user.id);
      }
      allowPersistRef.current = true;
    };
    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setUserId(user?.id ?? null);
      if (user?.id) {
        void ensureProfileForUser(user).catch(() => {
          // profiles table may not exist yet in local/dev before migration
        });
        void loadTheme(user.id);
        return;
      }
      allowPersistRef.current = true;
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!allowPersistRef.current || !userId) return;
    const persistTheme = async () => {
      await supabase
        .from("copilot_preferences")
        .upsert(
          {
            user_id: userId,
            ui_theme: theme,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
    };
    void persistTheme();
  }, [theme, userId]);

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
