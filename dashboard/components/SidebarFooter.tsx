"use client";

// Sidebar footer. Collapsed it keeps sign-out reachable but drops the
// "system online" caption, which has no icon-only form.
//
// The theme control used to live here. It now renders exactly once, in the
// sticky top header (app/(admin)/layout.tsx), so it stays reachable while a
// long settings page scrolls. Nothing is left behind here — no placeholder.
import { useSidebar } from "@/lib/sidebar-context";

export default function SidebarFooter({
  signOut,
}: {
  /** Rendered on the server so the session never crosses into the client. */
  signOut: React.ReactNode;
}) {
  const { collapsed } = useSidebar();
  return (
    <div className={`mt-auto w-full space-y-2 ${collapsed ? "pt-3" : "pt-4"}`}>
      {!collapsed && (
        <div className="flex items-center gap-1.5 px-3 text-[10px] text-gray-500">
          <span className="size-1.5 rounded-full bg-emerald-400 glow-pulse" />
          <span>system online</span>
        </div>
      )}
      {signOut}
    </div>
  );
}
