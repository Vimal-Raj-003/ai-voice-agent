"use client";
import { useEffect, useRef, useState } from "react";
import { DisconnectReason, Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import {
  installLiveKitLogRouting, attachRoomLifecycleLogging, logRoomConnect,
  disconnectOnce, logMount,
} from "@/lib/livekitLifecycle";
import { Mic, PhoneOff, Sparkles } from "lucide-react";
import DemoAudioMonitor from "./DemoAudioMonitor";
import Select from "./Select";

export type DemoAssistantOption={id:string;assistant_name:string;engine:string;model:string|null;voice:string|null;sandbox:boolean};

export default function DemoWidget({config:initialConfig,assistants,initialAssistantId,onFinished}: {config?: {
  engine: string; assistant_name: string | null; model: string | null; voice: string | null; sandbox: boolean;
} | null;assistants?:DemoAssistantOption[];initialAssistantId?:string;onFinished?:()=>void}) {
  const [assistantId,setAssistantId]=useState(initialAssistantId||assistants?.[0]?.id||'');
  const [callId,setCallId]=useState<string|null>(null);
  const config=assistants?.find(a=>a.id===assistantId)||initialConfig;
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "reconnecting" | "ended" | "error">("idle");
  const [error, setError] = useState<string>("");
  const [room, setRoom] = useState<Room | null>(null);
  // One room per session, and a handle that survives re-render so unmount can
  // always reach the live room (state is stale inside a cleanup closure).
  const roomRef = useRef<Room | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);
  const attemptRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    installLiveKitLogRouting();
    const unmount = logMount("demo");
    return () => {
      mountedRef.current = false;
      attemptRef.current?.abort();
      attemptRef.current = null;
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
    if (attemptRef.current || roomRef.current) return;
    const attempt = new AbortController();
    attemptRef.current = attempt;
    const current = () => mountedRef.current && attemptRef.current === attempt && !attempt.signal.aborted;
    let lkRoom: Room | null = null;
    setStatus("connecting");
    setCallId(null);
    setError("");
    try {
      const r = await fetch("/api/demo/proxy", { method: "POST", signal: attempt.signal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify(assistantId?{assistantId}:{}) });
      if (!current()) return;
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `proxy ${r.status}`);
      }
      const { token, room: roomName, url,call_id,assistant_id } = await r.json();
      if (!current()) return;
      if (assistants && assistant_id !== assistantId) throw new Error('The server did not confirm the selected assistant. Refresh and try again. No audio was connected.');
      if (!token || !url) throw new Error("The demo connection could not be prepared. Please try again.");
      if(call_id)setCallId(call_id);
      lkRoom = new Room({ adaptiveStream: true, dynacast: true });
      const ownedRoom = lkRoom;
      roomRef.current = lkRoom;
      const detachLifecycle = attachRoomLifecycleLogging(lkRoom, "demo");
      const audioElements = new Set<HTMLAudioElement>();
      detachRef.current = () => {
        detachLifecycle();
        ownedRoom.off(RoomEvent.TrackSubscribed, onTrack);
        ownedRoom.off(RoomEvent.Disconnected, onDisconnected);
        ownedRoom.off(RoomEvent.Reconnecting, onReconnecting);
        ownedRoom.off(RoomEvent.Reconnected, onReconnected);
        for (const el of audioElements) el.remove();
        audioElements.clear();
      };
      const onTrack = (track: RemoteTrack) => {
        if (!current()) return;
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.style.display = "none";
          el.autoplay = true;
          el.muted = false;
          document.body.appendChild(el);
          audioElements.add(el);
          // Some browsers won't autoplay media that attaches a few seconds
          // after the click gesture. Explicitly start playback and swallow the
          // promise rejection so a blocked autoplay doesn't crash the handler.
          void el.play().catch((e) => console.warn("remote audio autoplay blocked", e));
        }
      };
      const onDisconnected = (reason?: DisconnectReason) => {
        if (!current()) return;
        attempt.abort();
        attemptRef.current = null;
        detachRef.current?.();
        detachRef.current = null;
        roomRef.current = null;
        setRoom(null);
        onFinished?.();
        const normal = reason === undefined || [DisconnectReason.CLIENT_INITIATED,
          DisconnectReason.ROOM_DELETED, DisconnectReason.PARTICIPANT_REMOVED].includes(reason);
        setStatus(normal ? "ended" : "error");
        if (!normal) setError("The call disconnected. Check your connection and start again when ready.");
      };
      const onReconnecting = () => { if (current()) setStatus("reconnecting"); };
      const onReconnected = () => { if (current()) setStatus("connected"); };
      lkRoom.on(RoomEvent.TrackSubscribed, onTrack);
      lkRoom.on(RoomEvent.Disconnected, onDisconnected);
      lkRoom.on(RoomEvent.Reconnecting, onReconnecting);
      lkRoom.on(RoomEvent.Reconnected, onReconnected);
      logRoomConnect("demo", roomName);
      await lkRoom.connect(url, token);
      if (!current()) return;
      await lkRoom.localParticipant.setMicrophoneEnabled(true);
      if (!current()) {
        // Permission may resolve after navigation or Cancel. Stop any late track.
        for (const publication of lkRoom.localParticipant.audioTrackPublications.values()) publication.track?.stop();
        return;
      }
      setRoom(lkRoom);
      setStatus("connected");
      console.log("demo connected", { roomName });
    } catch (exc) {
      if (!current()) return;
      const msg = exc instanceof Error ? exc.message : String(exc);
      setError(msg);
      await disconnectOnce(lkRoom, "demo", "connection failed");
      if (!current()) return;
      detachRef.current?.();
      detachRef.current = null;
      setRoom(null);
      setStatus("error");
      roomRef.current = null;
      attemptRef.current = null;
      onFinished?.();
    }
  }

  async function stop() {
    attemptRef.current?.abort();
    attemptRef.current = null;
    // Disconnect FIRST, then drop the listeners: detaching early would remove
    // the handler that reports RoomEvent.Disconnected and its reason.
    await disconnectOnce(roomRef.current ?? room, "demo", "user ended the call");
    detachRef.current?.();
    detachRef.current = null;
    roomRef.current = null;
    if (mountedRef.current) {
      setRoom(null);
      setStatus("ended");
      onFinished?.();
    }
  }

  return (
    <div className="grid shrink-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="glass min-w-0 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Sparkles size={17}/>Test your assistant</h2>
        {assistants&&<label className="mt-4 block space-y-1 text-sm"><span className="text-gray-400">Assistant</span>
          <Select name="demoAssistant" defaultValue={assistantId} onChange={setAssistantId}
            disabled={['connecting','connected','reconnecting'].includes(status)}
            placeholder="Select an assistant" options={assistants.map(a=>({value:a.id,label:a.assistant_name}))}/></label>}
        {config && <div className="mt-3 space-y-1 text-xs text-gray-400">
          <p>{config.engine === "gemini-live" ? "Gemini Live" : config.engine === "gpt-live" ? "OpenAI GPT-Live" : config.engine==='pipeline'?"STT → LLM → TTS":"Existing configuration"}
            {config.voice ? ` · ${config.voice}` : ""}</p>
          {config.sandbox && <p>Test mode: booking, messages and transfers are simulated.</p>}
        </div>}
        <div className="mt-4 flex">
          {!["connected", "reconnecting", "connecting"].includes(status) ? (
            <button onClick={start} disabled={!!assistants&&!assistantId} className="rounded-lg bg-violet-300 text-black px-4 py-2 font-medium inline-flex items-center gap-2 disabled:opacity-50">
              <Mic size={16} /> {status === "connecting" ? "Connecting…" : "Start call"}
            </button>
          ) : (
            <button onClick={stop} className="rounded-full bg-red-500 text-white px-6 py-3 font-medium inline-flex items-center gap-2">
              <PhoneOff size={16} /> {status === "connecting" ? "Cancel" : "End call"}
            </button>
          )}
        </div>
        <div role="status" aria-live="polite" className="mt-4 text-xs text-gray-400">Status: {status}</div>
        {config?.engine==='gemini-live'&&<p className="mt-1 text-[11px] text-gray-400">Browser demos end after 3 minutes. Phone calls use the assistant’s saved call limits.</p>}
        {error && <div role="alert" className="mt-2 text-sm text-red-400">{error}</div>}
        {callId&&<a href={`/calls/${callId}/logs`} className="mt-3 inline-block text-sm text-violet-300 underline">View this demo’s logs</a>}
      </div>

      {/* Debug-only audio activity monitor (reuses the existing LiveKit tracks). */}
      <DemoAudioMonitor room={room} />
    </div>
  );
}
