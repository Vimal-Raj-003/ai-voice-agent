"use client";

// The sidebar shell: owns the width, the collapse control, and which pieces are
// visible in each mode.
//
// Sidebar itself stays a SERVER component (it reads the session), so the parts
// that differ per mode arrive as props and this client wrapper picks between
// them. Collapsed keeps every destination reachable — SidebarNav renders
// icon-only with tooltips — rather than hiding features.
//
// On mobile the sidebar is hidden entirely and the existing drawer behaviour is
// untouched; collapsing only applies from md upwards.
import { PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react";
import { useSidebar } from "@/lib/sidebar-context";

export default function SidebarFrame({
  quickDispatch,
  nav,
  footer,
}: {
  quickDispatch: React.ReactNode;
  nav: React.ReactNode;
  footer: React.ReactNode;
}) {
  const { collapsed, toggle } = useSidebar();

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={`glass m-3 mr-0 flex shrink-0 flex-col gap-3 self-start overflow-y-auto overflow-x-hidden rounded-2xl p-4 sticky top-3 max-h-[calc(100vh-1.5rem)] transition-[width] duration-200 ${
        collapsed ? "w-[72px] items-center px-2" : "w-64"
      }`}
    >
      {/* Logo: full lockup when expanded, mark only when collapsed. */}
      <div className={collapsed ? "pt-2 pb-1" : "px-3 pt-2 pb-1"}>
        <div className="flex items-center gap-2.5">
          <div className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-cyan-400 via-violet-400 to-pink-400 glow-violet flex items-center justify-center">
            <Sparkles size={16} className="text-black" />
          </div>
          {!collapsed && (
            <div>
              <div className="text-lg font-bold text-gradient leading-tight">
                Jilljill Voice
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">
                Voice AI platform
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The collapse / expand control is always visible in both modes. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={`inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-gray-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${
          collapsed ? "justify-center p-2" : "px-3 py-1.5"
        }`}
      >
        {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        {!collapsed && <span>Collapse</span>}
      </button>

      {quickDispatch}
      {nav}
      {footer}
    </aside>
  );
}
