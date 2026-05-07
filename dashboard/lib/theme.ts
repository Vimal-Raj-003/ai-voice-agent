// Shared between the inline boot script in app/layout.tsx and the runtime
// ThemeToggle component so they cannot silently desync if either renames.
// (The boot script duplicates the literal because it has to inline before
// React loads — but lint/grep against this constant catches drift.)
export const THEME_STORAGE_KEY = "jjv_theme";

export type Theme = "light" | "dark" | "system";
