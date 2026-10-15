"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

// Shows a transient success toast when a URL query flag is present (e.g. after
// a redirect to /contacts?saved=1), then strips the flag from the URL without a
// reload. Reads window.location directly to avoid a Suspense requirement.
export default function SavedToast({
  param = "saved",
  message = "Contact saved successfully",
}: {
  param?: string;
  message?: string;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get(param)) {
        setShow(true);
        u.searchParams.delete(param);
        window.history.replaceState({}, "", u.pathname + (u.search ? u.search : ""));
        const t = setTimeout(() => setShow(false), 2600);
        return () => clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
  }, [param]);

  if (!show) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2.5 text-sm font-medium text-emerald-200 shadow-lg backdrop-blur">
      <Check size={16} /> {message}
    </div>
  );
}
