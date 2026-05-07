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
import QuickDispatch from "./QuickDispatch";

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

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="glass w-64 shrink-0 m-3 mr-0 rounded-2xl p-4 flex flex-col gap-3 sticky top-3 self-start max-h-[calc(100vh-1.5rem)] overflow-y-auto">
      <div className="px-3 pt-2 pb-1">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-gradient-to-br from-cyan-400 via-violet-400 to-pink-400 glow-violet flex items-center justify-center">
            <Sparkles size={14} className="text-black" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-violet-300/80">
              Rapid X AI
            </div>
            <div className="text-base font-bold text-gradient">OutboundAI</div>
          </div>
        </div>
      </div>

      <QuickDispatch />

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

      <div className="mt-auto pt-4 px-3 text-[10px] text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-400 glow-pulse" />
          <span>system online</span>
        </div>
      </div>
    </aside>
  );
}
