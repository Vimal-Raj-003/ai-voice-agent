"use client";
import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  installLiveKitLogRouting, attachRoomLifecycleLogging, logRoomConnect,
  disconnectOnce, logMount,
} from "@/lib/livekitLifecycle";
import { Mic, PhoneOff, Sparkles } from "lucide-react";
import DemoAudioMonitor from "./DemoAudioMonitor";

export default function DemoWidget() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "ended" | "error">("idle");
  const [error, setError] = useState<string>("");
  const [room, setRoom] = useState<Room | null>(null);
  // One room per session, and a handle that survives re-render so unmount can
  // always reach the live room (state is stale inside a cleanup closure).
  const roomRef = useRef<Room | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    installLiveKitLogRouting();
    const unmount = logMount("demo");
    return () => {
      unmount();
      // Leaving the page mid-call previously left the room connected; the
      // browser tore the peer connection down abruptly, which is exactly when
      // the DataChannel aborts appear.
      detachRef.current?.();
      detachRef.current = null;
      void disconnectOnce(roomRef.current, "demo", "component unmounted");
      roomRef.current = null;
    };
  }, []);

  async function start() {
    if (startingRef.current || roomRef.current) return;   // no duplicate rooms
    startingRef.current = true;
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
      roomRef.current = lkRoom;
      detachRef.current = attachRoomLifecycleLogging(lkRoom, "demo");
      lkRoom.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.style.display = "none";
          el.autoplay = true;
          el.muted = false;
          document.body.appendChild(el);
          // Some browsers won't autoplay media that attaches a few seconds
          // after the click gesture. Explicitly start playback and swallow the
          // promise rejection so a blocked autoplay doesn't crash the handler.
          void el.play().catch((e) => console.warn("remote audio autoplay blocked", e));
        }
      });
      lkRoom.on(RoomEvent.Disconnected, () => setStatus("ended"));
      logRoomConnect("demo", roomName);
      await lkRoom.connect(url, token);
      await lkRoom.localParticipant.setMicrophoneEnabled(true);
      setRoom(lkRoom);
      setStatus("connected");
      console.log("demo connected", { roomName });
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      setError(msg);
      setStatus("error");
      roomRef.current = null;
    } finally {
      startingRef.current = false;
    }
  }

  async function stop() {
    // Disconnect FIRST, then drop the listeners: detaching early would remove
    // the handler that reports RoomEvent.Disconnected and its reason.
    await disconnectOnce(roomRef.current ?? room, "demo", "user ended the call");
    detachRef.current?.();
    detachRef.current = null;
    roomRef.current = null;
    setRoom(null);
    setStatus("ended");
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 items-start">
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

      {/* Debug-only audio activity monitor (reuses the existing LiveKit tracks). */}
      <DemoAudioMonitor room={room} />
    </div>
  );
}
