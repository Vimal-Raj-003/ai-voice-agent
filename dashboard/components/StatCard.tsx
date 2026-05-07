import type { LucideIcon } from "lucide-react";

type Tone = "cyan" | "violet" | "emerald" | "magenta";

const toneStyles: Record<
  Tone,
  { ring: string; icon: string; bar: string }
> = {
  cyan: {
    ring: "from-cyan-400/40 via-cyan-400/0 to-cyan-400/0",
    icon: "text-cyan-300",
    bar: "from-cyan-400 to-cyan-200",
  },
  violet: {
    ring: "from-violet-400/40 via-violet-400/0 to-violet-400/0",
    icon: "text-violet-300",
    bar: "from-violet-400 to-fuchsia-300",
  },
  emerald: {
    ring: "from-emerald-400/40 via-emerald-400/0 to-emerald-400/0",
    icon: "text-emerald-300",
    bar: "from-emerald-400 to-emerald-200",
  },
  magenta: {
    ring: "from-pink-400/40 via-pink-400/0 to-pink-400/0",
    icon: "text-pink-300",
    bar: "from-pink-400 to-rose-300",
  },
};

export default function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "cyan",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  const t = toneStyles[tone];
  return (
    <div
      className={`glass relative overflow-hidden rounded-2xl p-5 transition hover:-translate-y-[1px]`}
    >
      <div
        className={`absolute -top-1/2 -right-1/2 size-[120%] rounded-full bg-gradient-to-br ${t.ring} pointer-events-none blur-3xl opacity-60`}
      />
      <div className="relative flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-widest text-gray-400">
          {label}
        </div>
        {Icon && <Icon size={16} className={t.icon} />}
      </div>
      <div className="relative mt-3 text-3xl font-bold tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="relative mt-1 text-xs text-gray-500">{hint}</div>
      )}
      <div
        className={`absolute bottom-0 left-0 h-[2px] w-full bg-gradient-to-r ${t.bar} opacity-60`}
      />
    </div>
  );
}
