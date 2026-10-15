"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Mic, AudioLines, Loader2, AlertTriangle, ChevronDown, Trash2, Radio } from "lucide-react";

type RecStatus = "NONE" | "NOT_CONFIGURED" | "STARTING" | "RECORDING" | "PROCESSING" | "READY" | "FAILED";
type RecData = {
  status: RecStatus;
  durationSeconds: number | null;
  egressId: string | null;
  error: string | null;
  filename: string;
  hasRecording: boolean;
  playbackUrl: string | null;
  /** Which backend is serving the audio, for the source badge. */
  source?: "VOBIZ" | "LOCAL" | null;
  sourceLabel?: string | null;
};

/**
 * "Source: Vobiz" / "Local fallback" badge.
 *
 * Operators need to know whether they are hearing the carrier's copy or the
 * locally mixed fallback — they sound different, and a support conversation
 * depends on which one is on screen. Deliberately shows only the label: no
 * provider call/recording ids, and nothing credential-derived.
 */
function SourceBadge({ source, label }: { source?: "VOBIZ" | "LOCAL" | null; label?: string | null }) {
  if (!source) return null;
  const vobiz = source === "VOBIZ";
  return (
    <span
      title={vobiz
        ? "Served from the telephony provider's own recording"
        : "Served from this server's local recording"}
      className={
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
        // cyan-300/gray-400 deliberately: the light-theme remap layer in
        // globals.css covers [class*="text-cyan-3"] and .text-gray-400 but NOT
        // text-cyan-200, which would stay near-invisible on a light background.
        (vobiz
          ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
          : "border-white/10 bg-white/5 text-gray-400")
      }
    >
      <Radio size={9} aria-hidden /> {label || (vobiz ? "Vobiz" : "Local")}
    </span>
  );
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// Private call-recording card. Fetches recording status + a short-lived signed
// playback URL from /api/calls/[id]/recording (the bucket stays private). Shows
// the right state (not configured / starting / recording / processing / ready /
// failed) and, when READY, a native audio player (play/pause/seek/time/volume/
// replay) plus a Download button that hits the signed-download endpoint. Works
// for historical calls too — it keys off the call id, not the live stream.
export default function CallRecording({
  callId,
  durationSeconds,
  variant = "card",
}: {
  callId: string | null;
  durationSeconds?: number | null;
  variant?: "card" | "plain";
}) {
  const [data, setData] = useState<RecData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    if (!callId) { setData(null); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/calls/${callId}/recording`, { cache: "no-store" });
      if (!r.ok) { setData(null); return; }
      const j = (await r.json()) as RecData;
      if (!stopRef.current) setData(j);
    } catch { /* keep previous */ }
    finally { if (!stopRef.current) setLoading(false); }
  }, [callId]);

  useEffect(() => {
    stopRef.current = false;
    load();
    return () => { stopRef.current = true; };
  }, [load]);

  // While the recording is still in flight, poll so the card flips to READY
  // (and the player appears) on its own without a manual refresh.
  useEffect(() => {
    const s = data?.status;
    if (s !== "STARTING" && s !== "RECORDING" && s !== "PROCESSING") return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data?.status, load]);

  const status: RecStatus = data?.status ?? "NONE";
  const dur = data?.durationSeconds ?? durationSeconds ?? null;

  const wrap = (inner: React.ReactNode) =>
    variant === "plain" ? <div className="space-y-3">{inner}</div> : <div className="glass rounded-2xl p-5 space-y-3">{inner}</div>;

  const Header = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AudioLines size={16} className="text-cyan-300" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">Recording</h2>
      </div>
      {dur ? <span className="text-xs font-mono text-gray-500 tabular-nums">{fmt(dur)}</span> : null}
    </div>
  );

  // Terminal "no player" states.
  if (status === "NONE" || status === "NOT_CONFIGURED" || (!callId && !loading)) {
    const configured = status !== "NOT_CONFIGURED";
    return wrap(
      <>
        {Header}
        <div className="flex items-center gap-3 text-gray-400">
          <Mic size={18} className="text-gray-600" />
          <div>
            <div className="text-sm font-medium text-gray-300">
              {status === "NOT_CONFIGURED" ? "Recording not configured" : loading ? "Checking recording…" : "No recording for this call"}
            </div>
            {!configured ? (
              <div className="text-xs text-gray-500 mt-0.5">
                The recording backend is set to Cloudflare R2 but its credentials are missing. Set RECORDING_BACKEND=local to record on this server instead.
              </div>
            ) : !loading ? (
              <div className="text-xs text-gray-500 mt-0.5">
                This call has no stored audio. Recordings are saved on this server for calls placed with recording enabled.
              </div>
            ) : null}
          </div>
        </div>
      </>,
    );
  }

  if (status === "STARTING" || status === "RECORDING" || status === "PROCESSING") {
    const label = status === "STARTING" ? "Starting recording…" : status === "RECORDING" ? "Recording in progress…" : "Recording processing…";
    return wrap(
      <>
        {Header}
        <div className="flex items-center gap-2 text-sm text-amber-300">
          <Loader2 size={15} className="animate-spin" /> {label}
        </div>
      </>,
    );
  }

  if (status === "FAILED") {
    return wrap(
      <>
        {Header}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle size={15} /> Recording failed
            {data?.error && (
              <button type="button" onClick={() => setShowReason((v) => !v)} className="ml-1 inline-flex items-center gap-1 rounded border border-red-500/30 px-1.5 py-0.5 text-[11px] text-red-300 hover:bg-red-500/10">
                <ChevronDown size={11} className={showReason ? "rotate-180 transition" : "transition"} /> View reason
              </button>
            )}
          </div>
          {showReason && data?.error && <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-2 text-[11px] text-red-200 break-words">{data.error}</div>}
        </div>
      </>,
    );
  }

  // Delete the recording file + clear the row (confirmed by the operator first).
  const onDelete = async () => {
    if (!callId || deleting) return;
    if (!window.confirm("Delete this call recording? The audio file is permanently removed. The call record and transcript are kept.")) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/calls/${callId}/recording/delete`, { method: "POST" });
      if (r.ok) { setDeleted(true); setData(null); }
    } catch { /* surfaced by the reload below */ }
    finally { setDeleting(false); void load(); }
  };

  if (deleted) {
    return wrap(
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Trash2 size={14} /> Recording deleted. The call record and transcript are unchanged.
      </div>,
    );
  }

  // READY — real player + download + delete.
  return wrap(
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AudioLines size={16} className="text-cyan-300" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">Recording</h2>
          <SourceBadge source={data?.source} label={data?.sourceLabel} />
        </div>
        <div className="flex items-center gap-3">
          {dur ? <span className="text-xs font-mono text-gray-500 tabular-nums">{fmt(dur)}</span> : null}
          {callId && data?.playbackUrl && (
            <a
              href={`/api/calls/${callId}/recording/download`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              <Download size={12} /> Download
            </a>
          )}
          {/* Delete removes the LOCAL file only. For a Vobiz-sourced recording
              that would delete the fallback while playback kept streaming from
              the carrier — a misleading action, so it is hidden rather than
              silently doing something else. */}
          {callId && data?.playbackUrl && data?.source !== "VOBIZ" && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              title="Delete this recording file"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
            </button>
          )}
        </div>
      </div>
      {data?.playbackUrl ? (
        <audio controls preload="none" src={data.playbackUrl} className="w-full [&::-webkit-media-controls-panel]:bg-white/[0.03]">
          Your browser does not support audio playback.
        </audio>
      ) : (
        <div className="text-xs text-gray-500">Preparing playback URL…</div>
      )}
    </>,
  );
}
