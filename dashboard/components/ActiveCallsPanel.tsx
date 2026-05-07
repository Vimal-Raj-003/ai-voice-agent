import { Activity } from "lucide-react";

type ActiveCall = {
  roomId: string;
  phoneNumber: string | null;
  callerName: string | null;
  status: string | null;
  startedAt: Date;
};

function elapsed(from: Date): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export default function ActiveCallsPanel({ calls }: { calls: ActiveCall[] }) {
  return (
    <div className="glass rounded-2xl p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-emerald-400 glow-pulse" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Active calls
          </h2>
        </div>
        <span className="text-[10px] text-gray-500 font-mono">
          {calls.length} live
        </span>
      </div>
      {calls.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-10 text-center">
          <Activity size={28} className="text-gray-600 mb-2" />
          <div className="text-sm text-gray-400">No live calls right now.</div>
          <div className="text-xs text-gray-600 mt-1">
            Use Quick dispatch in the sidebar to start one.
          </div>
        </div>
      ) : (
        <ul className="space-y-2 flex-1">
          {calls.map((c) => (
            <li
              key={c.roomId}
              className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {c.callerName || c.phoneNumber || "Unknown"}
                </div>
                <div className="text-[11px] text-gray-500 font-mono">
                  {c.phoneNumber ?? "no number"} · {c.status ?? "active"}
                </div>
              </div>
              <div className="text-xs text-cyan-300 font-mono tabular-nums">
                {elapsed(c.startedAt)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
