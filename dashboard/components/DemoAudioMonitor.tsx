"use client";
import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { Mic, Volume2 } from "lucide-react";

// Debug-only audio activity monitor for the Demo call. It REUSES the existing
// LiveKit tracks (local mic + subscribed agent audio) — it never calls
// getUserMedia or creates a second capture path, and it only READS levels via
// Web Audio AnalyserNodes, so it cannot affect the voice pipeline.

const BAR_COUNT = 20;
const FPS = 25;

type MicStatus = "inactive" | "muted" | "too_low" | "listening" | "voice";

const MIC_STATUS_LABEL: Record<MicStatus, string> = {
  inactive: "Mic inactive",
  muted: "Muted",
  too_low: "Input too low",
  listening: "Listening",
  voice: "Voice detected",
};

function makeAnalyser(ctx: AudioContext, mst: MediaStreamTrack): AnalyserNode {
  const src = ctx.createMediaStreamSource(new MediaStream([mst]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  src.connect(analyser);
  // NOTE: analyser is intentionally NOT connected to ctx.destination — this is a
  // read-only tap, so it adds no audible path and can't echo.
  return analyser;
}

// RMS of the time-domain buffer → approximate dBFS.
function levelFromAnalyser(analyser: AnalyserNode, buf: Float32Array): { rms: number; db: number } {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  const db = rms > 1e-7 ? 20 * Math.log10(rms) : -100;
  return { rms, db };
}

function barsFromAnalyser(analyser: AnalyserNode, freq: Uint8Array): number[] {
  analyser.getByteFrequencyData(freq);
  const out: number[] = new Array(BAR_COUNT);
  const per = Math.floor(freq.length / BAR_COUNT);
  for (let b = 0; b < BAR_COUNT; b++) {
    let s = 0;
    for (let i = 0; i < per; i++) s += freq[b * per + i];
    out[b] = s / per / 255; // 0..1
  }
  return out;
}

export default function DemoAudioMonitor({ room }: { room: Room | null }) {
  const [micBars, setMicBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));
  const [agentBars, setAgentBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));
  const [micDb, setMicDb] = useState<number>(-100);
  const [micStatus, setMicStatus] = useState<MicStatus>("inactive");
  const [agentActive, setAgentActive] = useState(false);
  const [info, setInfo] = useState({ published: false, muted: false, connected: false, roomName: "" });

  useEffect(() => {
    if (!room) {
      setMicStatus("inactive");
      setMicBars(new Array(BAR_COUNT).fill(0));
      setAgentBars(new Array(BAR_COUNT).fill(0));
      setMicDb(-100);
      setAgentActive(false);
      setInfo({ published: false, muted: false, connected: false, roomName: "" });
      return;
    }

    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    void ctx.resume().catch(() => {});

    let micAnalyser: AnalyserNode | null = null;
    let agentAnalyser: AnalyserNode | null = null;
    let micTrackId = "";
    let agentTrackId = "";
    const timeBuf = new Float32Array(256);
    const freqBuf = new Uint8Array(256);
    let raf = 0;
    let last = 0;
    let cancelled = false;

    const getMicTrack = (): MediaStreamTrack | null => {
      const pub = room.localParticipant?.getTrackPublication(Track.Source.Microphone);
      return pub?.track?.mediaStreamTrack ?? null;
    };

    const onAgentTrack = () => {
      // First subscribed remote audio track = the agent's TTS output.
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          const t = pub.track;
          if (t && t.kind === Track.Kind.Audio && t.mediaStreamTrack) {
            if (agentTrackId !== t.mediaStreamTrack.id) {
              agentTrackId = t.mediaStreamTrack.id;
              try { agentAnalyser = makeAnalyser(ctx, t.mediaStreamTrack); } catch { /* ignore */ }
            }
            return;
          }
        }
      }
    };

    const onSub = () => onAgentTrack();
    room.on(RoomEvent.TrackSubscribed, onSub);
    room.on(RoomEvent.TrackUnsubscribed, onSub);

    const loop = (ts: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      if (ts - last < 1000 / FPS) return;
      last = ts;

      // (Re)bind the mic analyser to whatever the local mic track currently is —
      // handles the track being published slightly after connect, or re-published.
      const mst = getMicTrack();
      const pub = room.localParticipant?.getTrackPublication(Track.Source.Microphone);
      const muted = !!pub?.isMuted;
      const connected = room.state === "connected";
      if (mst && mst.id !== micTrackId) {
        micTrackId = mst.id;
        try { micAnalyser = makeAnalyser(ctx, mst); } catch { micAnalyser = null; }
      }
      if (!mst) { micAnalyser = null; micTrackId = ""; }

      setInfo({ published: !!pub?.track, muted, connected, roomName: room.name || "" });

      if (!connected || !micAnalyser) {
        setMicStatus("inactive");
        setMicBars((b) => (b.some((x) => x) ? new Array(BAR_COUNT).fill(0) : b));
        setMicDb(-100);
      } else if (muted) {
        setMicStatus("muted");
        setMicBars(new Array(BAR_COUNT).fill(0));
        setMicDb(-100);
      } else {
        const { db } = levelFromAnalyser(micAnalyser, timeBuf);
        setMicDb((prev) => prev * 0.6 + db * 0.4); // smooth
        setMicBars(barsFromAnalyser(micAnalyser, freqBuf));
        setMicStatus(db < -55 ? "too_low" : db < -35 ? "listening" : "voice");
      }

      if (!agentAnalyser) onAgentTrack();
      if (agentAnalyser) {
        const { db } = levelFromAnalyser(agentAnalyser, timeBuf);
        setAgentBars(barsFromAnalyser(agentAnalyser, freqBuf));
        setAgentActive(db > -50);
      } else {
        setAgentActive(false);
        setAgentBars((b) => (b.some((x) => x) ? new Array(BAR_COUNT).fill(0) : b));
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      room.off(RoomEvent.TrackSubscribed, onSub);
      room.off(RoomEvent.TrackUnsubscribed, onSub);
      void ctx.close().catch(() => {});
    };
  }, [room]);

  const statusTone =
    micStatus === "voice"
      ? "text-emerald-300"
      : micStatus === "listening"
        ? "text-amber-300"
        : micStatus === "too_low" || micStatus === "muted"
          ? "text-red-300"
          : "text-gray-400";

  const dbText = micDb <= -99 ? "—" : `${micDb.toFixed(0)} dB`;

  return (
    <div className="rounded-3xl border border-white/10 bg-black/30 p-6 w-full max-w-xs text-left">
      {/* MIC INPUT */}
      <div className="flex items-center gap-2">
        <Mic size={16} className="text-purple-300" />
        <span className="text-sm font-semibold tracking-wide">MIC INPUT</span>
        <span className={`ml-auto text-xs font-mono ${statusTone}`}>{MIC_STATUS_LABEL[micStatus]}</span>
      </div>

      <div className="mt-3 flex items-end gap-[3px] h-16">
        {micBars.map((v, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-[height] duration-75 ${
              micStatus === "voice" ? "bg-emerald-400" : micStatus === "listening" ? "bg-amber-400" : "bg-white/20"
            }`}
            style={{ height: `${Math.max(4, Math.min(100, v * 140))}%` }}
          />
        ))}
      </div>

      {/* overall level bar + dB */}
      <div className="mt-3 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${micStatus === "voice" ? "bg-emerald-400" : micStatus === "listening" ? "bg-amber-400" : "bg-white/30"}`}
            style={{ width: `${Math.max(0, Math.min(100, ((micDb + 70) / 70) * 100))}%` }}
          />
        </div>
        <span className="w-12 text-right text-[10px] font-mono text-gray-400">{dbText}</span>
      </div>

      {/* AGENT OUTPUT */}
      <div className="mt-5 flex items-center gap-2">
        <Volume2 size={16} className="text-blue-300" />
        <span className="text-sm font-semibold tracking-wide">AGENT OUTPUT</span>
        <span className={`ml-auto text-xs font-mono ${agentActive ? "text-blue-300" : "text-gray-500"}`}>
          {agentActive ? "Agent speaking" : "Silent"}
        </span>
      </div>
      <div className="mt-3 flex items-end gap-[3px] h-10">
        {agentBars.map((v, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-[height] duration-75 ${agentActive ? "bg-blue-400" : "bg-white/15"}`}
            style={{ height: `${Math.max(4, Math.min(100, v * 140))}%` }}
          />
        ))}
      </div>

      {/* diagnostics */}
      <div className="mt-5 space-y-1 border-t border-white/10 pt-3 text-[10px] font-mono text-gray-500">
        <div className="flex justify-between"><span>LiveKit</span><span className={info.connected ? "text-emerald-300" : "text-red-300"}>{info.connected ? "connected" : "disconnected"}</span></div>
        <div className="flex justify-between"><span>mic published</span><span className={info.published ? "text-emerald-300" : "text-gray-500"}>{info.published ? "YES" : "NO"}</span></div>
        <div className="flex justify-between"><span>mic muted</span><span className={info.muted ? "text-red-300" : "text-gray-500"}>{info.muted ? "YES" : "NO"}</span></div>
        <div className="flex justify-between"><span>room</span><span className="text-gray-400">{info.roomName || "—"}</span></div>
      </div>
    </div>
  );
}
