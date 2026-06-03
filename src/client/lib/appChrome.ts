import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";
export type SidebarMode = "full" | "compact" | "hidden";

const THEME_KEY = "homelab-theme";
const SIDEBAR_KEY = "homelab-sidebar";

function readTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
}

function readSidebar(): SidebarMode {
  const stored = localStorage.getItem(SIDEBAR_KEY);
  if (stored === "compact" || stored === "hidden") return stored;
  return "full";
}

export function useAppChrome() {
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(readSidebar);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, sidebarMode);
  }, [sidebarMode]);

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  function cycleSidebar() {
    setSidebarMode((current) => {
      if (current === "full") return "compact";
      if (current === "compact") return "hidden";
      return "full";
    });
  }

  return { theme, setTheme, toggleTheme, sidebarMode, setSidebarMode, cycleSidebar };
}
