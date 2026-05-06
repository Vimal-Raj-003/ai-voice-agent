"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Bot, Users, Megaphone, PhoneCall, Activity, Settings, Sparkles,
} from "lucide-react";

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assistants", label: "Assistants", icon: Bot },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/live-logs", label: "Live Logs", icon: Activity },
  { href: "/demo", label: "Demo", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-white/5 bg-black/40 backdrop-blur p-4 flex flex-col gap-1">
      <div className="px-3 py-4">
        <div className="text-xs uppercase tracking-widest text-purple-300/70">Rapid X AI</div>
        <div className="text-lg font-bold">OutboundAI</div>
      </div>
      {links.map(({ href, label, icon: Icon }) => {
        const active = path === href || (href !== "/" && path.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
              active ? "bg-white/10 text-white" : "text-gray-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </aside>
  );
}
