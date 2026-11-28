import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const CHART_PALETTE_LIGHT = [
  "#5845FF", "#EC4899", "#06B6D4", "#10B981", "#8B5CF6", "#3B82F6",
  "#D946EF", "#F43F5E", "#14B8A6", "#6366F1", "#0EA5E9", "#A855F7",
  "#FB7185", "#22D3EE", "#34D399", "#7C3AED", "#F472B6", "#60A5FA",
  "#C026D3", "#2DD4BF", "#818CF8", "#38BDF8", "#E879F9", "#4ADE80",
] as const;

export const CHART_PALETTE_DARK = [
  "#9D92FF", "#FF9ED2", "#6EE7F5", "#73F2BE", "#C4B5FD", "#8EC5FF",
  "#F5A6FF", "#FF9CB0", "#6EF0DC", "#A5B4FC", "#7AD7FF", "#D8B4FE",
  "#FECDD3", "#A5F3FC", "#A7F3D0", "#B59CFF", "#FBCFE8", "#BFDBFE",
  "#E89BFF", "#99F6E4", "#C7D2FE", "#BAE6FD", "#F5D0FE", "#BBF7D0",
] as const;

export function chartSeriesColor(index: number, mode: ResolvedTheme): string {
  const palette = mode === "dark" ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT;
  const slot = Number.isFinite(index) ? ((Math.trunc(index) % 24) + 24) % 24 : 0;
  return palette[slot];
}

const STORAGE_KEY = "vite-ui-theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  forced: boolean;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: "system",
  resolved: "dark",
  forced: false,
  setPreference: () => undefined,
});

export function ThemeProvider({
  forceTheme,
  children,
}: {
  forceTheme?: string;
  children: React.ReactNode;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") return raw;
    } catch {
      // ignore storage errors
    }
    return "system";
  });

  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const normalizedForce =
    forceTheme === "dark" || forceTheme === "light" ? forceTheme : null;

  const resolved: ResolvedTheme =
    normalizedForce ??
    (preference === "system" ? (systemDark ? "dark" : "light") : preference);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.setAttribute("data-theme", resolved);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", resolved === "dark" ? "#111118" : "#F9F8FC");
    }
  }, [resolved]);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      forced: Boolean(normalizedForce),
      setPreference,
    }),
    [preference, resolved, normalizedForce],
  );

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useThemeMode() {
  return useContext(ThemeContext);
}
