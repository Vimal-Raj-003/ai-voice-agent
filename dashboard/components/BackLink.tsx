"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Back navigation that cannot strand the user outside the app.
 *
 * It renders a real <a href={fallback}>, so it works with no JS, with
 * middle-click / ctrl-click, and is announced as a link. The click handler
 * only upgrades that to a history pop when it is provably safe:
 *
 *   - A blind `history.back()` is NOT used. On a direct URL entry or a page
 *     refresh the previous history entry belongs to whatever the user was on
 *     before (another site, or nothing), so `back()` would navigate out of the
 *     application. `window.history.length` cannot distinguish those cases —
 *     it counts entries from other origins too.
 *   - Instead the referrer is checked: a same-origin referrer means the user
 *     arrived from inside the app, and only then is router.back() used, which
 *     preserves the list's scroll position and any filters they had applied.
 *   - Otherwise it pushes `fallback` — deterministic, always in-app.
 *
 * `confirmIfDirty` guards unsaved edits: the form is serialised on mount and
 * compared at click time, so the user is only interrupted when something
 * actually changed. Next's client router does not fire `beforeunload`, so this
 * check has to happen here rather than relying on the browser.
 */
export default function BackLink({
  fallback,
  label = "Back",
  formId,
  confirmMessage = "You have unsaved changes. Leave without saving?",
}: {
  /** Always-safe in-app destination, e.g. "/campaigns". */
  fallback: string;
  label?: string;
  /** id of a <form> to watch for unsaved changes. */
  formId?: string;
  confirmMessage?: string;
}) {
  const router = useRouter();
  const initial = useRef<string | null>(null);

  // Snapshot the form once it has rendered (and after any defaultValue hydration).
  useEffect(() => {
    if (!formId) return;
    const snap = () => {
      const f = document.getElementById(formId) as HTMLFormElement | null;
      if (f) initial.current = new URLSearchParams(new FormData(f) as never).toString();
    };
    const t = setTimeout(snap, 300);
    return () => clearTimeout(t);
  }, [formId]);

  const isDirty = () => {
    if (!formId || initial.current === null) return false;
    const f = document.getElementById(formId) as HTMLFormElement | null;
    if (!f) return false;
    return new URLSearchParams(new FormData(f) as never).toString() !== initial.current;
  };

  return (
    <a
      href={fallback}
      data-testid="back-link"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser do it
        e.preventDefault();
        if (isDirty() && !window.confirm(confirmMessage)) return;

        let sameOrigin = false;
        try {
          sameOrigin =
            !!document.referrer &&
            new URL(document.referrer).origin === window.location.origin;
        } catch {
          sameOrigin = false;
        }
        if (sameOrigin) router.back();
        else router.push(fallback);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-gray-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
    >
      <ArrowLeft size={14} />
      {label}
    </a>
  );
}
