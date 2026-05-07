"use client";

import { Download, Mic, AudioLines } from "lucide-react";

export default function CallRecording({
  url,
  durationSeconds,
}: {
  url: string | null;
  durationSeconds?: number | null;
}) {
  if (!url) {
    return (
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-3 text-gray-400">
          <Mic size={18} className="text-gray-600" />
          <div>
            <div className="text-sm font-medium text-gray-300">
              No recording available
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Recording requires R2 credentials in voice-service settings.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const filename = (() => {
    try {
      const u = new URL(url);
      return u.pathname.split("/").pop() || "recording.ogg";
    } catch {
      return "recording.ogg";
    }
  })();

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="glass rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AudioLines size={16} className="text-cyan-300" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Recording
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {durationSeconds ? (
            <span className="text-xs font-mono text-gray-500 tabular-nums">
              {fmt(durationSeconds)}
            </span>
          ) : null}
          <a
            href={url}
            download={filename}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/10 hover:text-white transition"
          >
            <Download size={12} /> Download
          </a>
        </div>
      </div>
      <audio
        controls
        src={url}
        className="w-full [&::-webkit-media-controls-panel]:bg-white/[0.03]"
      >
        Your browser does not support audio playback.
      </audio>
    </div>
  );
}
