// Sidebar is a server component so it can read the NextAuth session and pass
// the admin's email to SignOutButton. Nav links live in a client child
// (SidebarNav) because they need usePathname for the active-route highlight.
import { Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import QuickDispatch from "./QuickDispatch";
import SidebarNav from "./SidebarNav";
import SignOutButton from "./SignOutButton";
import ThemeToggle from "./ThemeToggle";

export default async function Sidebar() {
  const session = await auth();
  return (
    <aside className="glass w-64 shrink-0 m-3 mr-0 rounded-2xl p-4 flex flex-col gap-3 sticky top-3 self-start max-h-[calc(100vh-1.5rem)] overflow-y-auto">
      <div className="px-3 pt-2 pb-1">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-gradient-to-br from-cyan-400 via-violet-400 to-pink-400 glow-violet flex items-center justify-center">
            <Sparkles size={16} className="text-black" />
          </div>
          <div>
            <div className="text-lg font-bold text-gradient leading-tight">
              Jilljill Voice
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">
              Voice AI platform
            </div>
          </div>
        </div>
      </div>

      <QuickDispatch />

      <SidebarNav />

      <div className="mt-auto pt-4 space-y-2">
        <ThemeToggle />
        <div className="flex items-center gap-1.5 px-3 text-[10px] text-gray-500">
          <span className="size-1.5 rounded-full bg-emerald-400 glow-pulse" />
          <span>system online</span>
        </div>
        <SignOutButton email={session?.user?.email} />
      </div>
    </aside>
  );
}
