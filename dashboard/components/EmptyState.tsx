import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { href: string; label: string };
};

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: Props) {
  return (
    <div className="glass rounded-2xl p-10 flex flex-col items-center justify-center text-center">
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400/30 via-violet-400/20 to-pink-400/20 blur-2xl" />
        <div className="relative size-14 rounded-full glass-strong flex items-center justify-center">
          <Icon size={22} className="text-cyan-300" />
        </div>
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 mt-1 max-w-md">{description}</p>
      )}
      {action && (
        <Link
          href={action.href}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 transition shadow-[0_0_20px_rgba(167,139,250,0.3)]"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
