"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

const STORAGE_KEY = THEME_STORAGE_KEY;

function applyTheme(t: Theme) {
  const resolved: "light" | "dark" =
    t === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : t;
  document.documentElement.dataset.theme = resolved;
  if (t === "system") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, t);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) || "system";
    setTheme(stored);
  }, []);

  useEffect(() => {
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onChange = () => applyTheme("system");
      onChange();
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    applyTheme(theme);
  }, [theme]);

  const opts: { id: Theme; icon: typeof Sun; label: string }[] = [
    { id: "system", icon: Monitor, label: "System" },
    { id: "light", icon: Sun, label: "Light" },
    { id: "dark", icon: Moon, label: "Dark" },
  ];

  return (
    <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1">
      {opts.map(({ id, icon: Icon, label }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            aria-label={label}
            title={label}
            className={`flex-1 inline-flex items-center justify-center rounded-lg py-1.5 text-[11px] transition ${
              active
                ? "bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Icon size={13} />
          </button>
        );
      })}
    </div>
  );
}
