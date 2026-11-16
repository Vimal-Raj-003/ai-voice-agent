// Shared between the inline boot script in app/layout.tsx and the runtime
// ThemeToggle component so they cannot silently desync if either renames.
// (The boot script duplicates the literal because it has to inline before
// React loads — but lint/grep against this constant catches drift.)
export const THEME_STORAGE_KEY = "jjv_theme";

export type Theme = "light" | "dark" | "system";

const THEME_EVENT = "jjv:theme";
let fallback: Theme = "system";
export function readTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : "system";
  } catch { return fallback; }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === "system"
    ? window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark" : theme;
}
export function setTheme(theme: Theme) {
  fallback = theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Session choice still works. */ }
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}
export function subscribeTheme(notify: () => void) {
  const sync = () => { applyTheme(readTheme()); notify(); };
  const media = window.matchMedia("(prefers-color-scheme: light)");
  window.addEventListener(THEME_EVENT, sync);
  window.addEventListener("storage", sync);
  media.addEventListener("change", sync);
  sync(); // Mounting reads/applies the saved choice; it never writes storage.
  return () => {
    window.removeEventListener(THEME_EVENT, sync);
    window.removeEventListener("storage", sync);
    media.removeEventListener("change", sync);
  };
}
