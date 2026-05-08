"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

// URL-driven search input. The Server Component (`/settings`) reads `?q=`
// from searchParams to filter the displayed rows; this client component
// just keeps the input in sync with the URL and updates `q` (debounced)
// without losing the active tab.
export default function SettingsSearchBar() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = sp.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If the user navigates between tabs the URL `q` may change without us
  // typing — keep the input field reflecting the URL.
  useEffect(() => {
    setValue(sp.get("q") ?? "");
  }, [sp]);

  const push = (next: string) => {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("q", next);
    else params.delete("q");
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  const onChange = (next: string) => {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => push(next), 200);
  };

  return (
    <div className="relative max-w-md">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search settings… (key, label, description)"
        className="w-full rounded-lg border border-white/10 bg-black/30 pl-9 pr-9 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
