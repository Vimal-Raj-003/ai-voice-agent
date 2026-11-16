"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { readTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";
const serverTheme = (): Theme => "system";

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);

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
            aria-pressed={active}
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
