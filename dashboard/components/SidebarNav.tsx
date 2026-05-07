"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  Users,
  Megaphone,
  PhoneCall,
  Activity,
  Settings,
  Sparkles,
  Calendar,
  Webhook,
} from "lucide-react";

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assistants", label: "Assistants", icon: Bot },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/live-logs", label: "Live Logs", icon: Activity },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/demo", label: "Demo", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function SidebarNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {links.map(({ href, label, icon: Icon }) => {
        const active =
          path === href || (href !== "/" && path.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={`group relative flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition ${
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
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
