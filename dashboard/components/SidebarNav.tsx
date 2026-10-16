"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "@/lib/sidebar-context";
import {
  LayoutDashboard,
  Bot,
  Users,
  Megaphone,
  Activity,
  Settings,
  Sparkles,
  Calendar,
  Server,
} from "lucide-react";

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assistants", label: "Assistants", icon: Bot },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  // API keys are a tab of Settings (/settings?tab=api-keys).
  // Costs & Usage is a section of Overview (/#costs).
  // Do-Not-Call, Phone numbers and Calls are sections of Contacts
  // (?section=dnc|numbers|calls)
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/live-logs", label: "Live Logs", icon: Activity },
  { href: "/providers", label: "Providers", icon: Server },
  { href: "/demo", label: "Demo", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/team", label: "Team", icon: Users },
];

export default function SidebarNav() {
  const path = usePathname();
  const { collapsed, setCollapsed } = useSidebar();

  // Choosing a destination collapses the sidebar so the page it opens gets
  // the width. Only from md upwards: on mobile the sidebar is the drawer and
  // collapsing it would be meaningless. Expanding again is one click.
  const onNavigate = () => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      setCollapsed(true);
    }
  };
  return (
    <nav className="flex w-full flex-col gap-1">
      {links.map(({ href, label, icon: Icon }) => {
        const active =
          path === href || (href !== "/" && path.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            // Native title doubles as the collapsed-mode tooltip and works on
            // keyboard focus; aria-label keeps the name for screen readers once
            // the visible text is gone.
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center rounded-xl text-sm transition ${
              collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2"
            } ${
              active
                ? "bg-white/[0.06] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                : "text-gray-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r bg-gradient-to-b from-cyan-400 to-violet-400" />
            )}
            <Icon
              size={16}
              className={
                active
                  ? "text-cyan-300"
                  : "text-gray-500 group-hover:text-gray-300"
              }
            />
            {!collapsed && label}
          </Link>
        );
      })}
    </nav>
  );
}
