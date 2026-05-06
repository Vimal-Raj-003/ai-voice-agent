"use client";
import { useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { Mic, PhoneOff, Sparkles } from "lucide-react";

export default function DemoWidget() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "ended" | "error">("idle");
  const [error, setError] = useState<string>("");
  const [room, setRoom] = useState<Room | null>(null);

  async function start() {
    setStatus("connecting");
    setError("");
    try {
      const r = await fetch("/api/demo/proxy", { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `proxy ${r.status}`);
      }
      const { token, room: roomName, url } = await r.json();
      const lkRoom = new Room({ adaptiveStream: true, dynacast: true });
      lkRoom.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.style.display = "none";
          document.body.appendChild(el);
        }
      });
      lkRoom.on(RoomEvent.Disconnected, () => setStatus("ended"));
      await lkRoom.connect(url, token);
      await lkRoom.localParticipant.setMicrophoneEnabled(true);
      setRoom(lkRoom);
      setStatus("connected");
      console.log("demo connected", { roomName });
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      setError(msg);
      setStatus("error");
    }
  }

  async function stop() {
    await room?.disconnect();
    setRoom(null);
    setStatus("ended");
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-purple-500/10 to-blue-500/10 p-8 max-w-md text-center">
      <Sparkles className="mx-auto text-purple-300" size={28} />
      <h2 className="mt-2 text-2xl font-bold">Try the agent</h2>
      <p className="text-gray-400 text-sm mt-1">Open mic in your browser; the AI will pick up.</p>
      <div className="mt-6 flex justify-center">
        {status !== "connected" ? (
          <button onClick={start} disabled={status === "connecting"} className="rounded-full bg-white text-black px-6 py-3 font-medium inline-flex items-center gap-2 disabled:opacity-50">
            <Mic size={16} /> {status === "connecting" ? "Connecting…" : "Start call"}
          </button>
        ) : (
          <button onClick={stop} className="rounded-full bg-red-500 text-white px-6 py-3 font-medium inline-flex items-center gap-2">
            <PhoneOff size={16} /> End call
          </button>
        )}
      </div>
      <div className="mt-4 text-xs text-gray-500">Status: {status}</div>
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}
