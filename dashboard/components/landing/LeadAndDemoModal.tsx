"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
  DisconnectReason,
  type RemoteTrack,
  type TranscriptionSegment,
  type Participant,
} from "livekit-client";
import {
  GraduationCap,
  Headphones,
  HeartPulse,
  PhoneCall,
  CalendarDays,
  Megaphone,
  Users,
  Workflow,
  Mic,
  MicOff,
  PhoneOff,
  LoaderCircle,
  X,
  ArrowLeft,
  Sparkles,
  RotateCcw,
  MessageSquareText,
} from "lucide-react";
import landingStyles from "./LandingPage.module.css";

interface LeadAndDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedRole?: string | null;
}

export interface AssistantItem {
  id: string;
  name: string;
  description?: string | null;
  role: string;
  active: boolean;
}

interface TranscriptEntry {
  id: string;
  speaker: "user" | "agent";
  text: string;
  final: boolean;
}

const LEAD_SESSION_KEY = "jjv_demo_lead_v2";
const WAVE_BARS = 24;

const DEFAULT_ASSISTANTS: AssistantItem[] = [
  { id: "caaad76e39781563d9ee13de0", name: "Academy Assistant", role: "academy", active: true },
  { id: "cmuv65lxx0013v7f4thzf2qtv", name: "Appointment Booker", role: "appointment", active: true },
  { id: "ccc6c12cc5f975d64b659ec72", name: "Clinic Assistant", role: "clinic", active: true },
  { id: "cmuv6w9d70017v7f4j8kth708", name: "Customer Support", role: "support", active: true },
  { id: "c40c4a0181bf251ca929f0706", name: "IVR Assistant", role: "ivr", active: true },
  { id: "cmuv75n1j0019v7f434t6xj6q", name: "Marketing Outreach", role: "marketing", active: true },
  { id: "cmuv6fea90015v7f4fexyfx8g", name: "Outbound Sales", role: "sales", active: true },
  { id: "cmuv4xd8i0011v7f4fgsgfr5x", name: "Receptionist", role: "receptionist", active: true },
  {
    id: "cmvxs7rk10001v7e8kcdra9ez",
    name: "Hospital Assistant",
    role: "hospital",
    active: true,
  },
];

const PREFERRED_ORDER = [
  "academy",
  "appointment",
  "clinic",
  "hospital",
  "support",
  "ivr",
  "marketing",
  "sales",
  "receptionist",
  "vasan",
];

function sortAssistantsForGallery(list: AssistantItem[]): AssistantItem[] {
  return [...list].sort((a, b) => {
    const ia = PREFERRED_ORDER.indexOf(a.role);
    const ib = PREFERRED_ORDER.indexOf(b.role);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
}

const STATE_CITIES: Record<string, string[]> = {
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Vellore", "Erode", "Other"],
  "Karnataka": ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi", "Belagavi", "Other"],
  "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Other"],
  "Delhi NCR": ["New Delhi", "Noida", "Gurugram", "Faridabad", "Ghaziabad", "Other"],
  "Telangana": ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Other"],
  "Kerala": ["Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur", "Other"],
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Other"],
  "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Other"],
  "West Bengal": ["Kolkata", "Howrah", "Siliguri", "Durgapur", "Other"],
  "Other": ["Other"],
};

const roleIcons: Record<string, typeof Users> = {
  academy: GraduationCap,
  clinic: HeartPulse,
  hospital: HeartPulse,
  vasan: HeartPulse,
  ivr: Workflow,
  appointment: CalendarDays,
  support: Headphones,
  marketing: Megaphone,
  sales: PhoneCall,
  receptionist: Users,
};

function makeAnalyser(ctx: AudioContext, mst: MediaStreamTrack): AnalyserNode {
  const src = ctx.createMediaStreamSource(new MediaStream([mst]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.65;
  src.connect(analyser);
  return analyser;
}

export const LeadAndDemoModal: React.FC<LeadAndDemoModalProps> = ({
  isOpen,
  onClose,
  preselectedRole,
}) => {
  const [step, setStep] = useState<"lead" | "assistants" | "call">("lead");
  const [assistants, setAssistants] = useState<AssistantItem[]>(DEFAULT_ASSISTANTS);
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantItem | null>(null);

  const [formData, setFormData] = useState({
    fullName: "",
    countryCode: "+91",
    phone: "",
    email: "",
    businessName: "",
    businessType: "",
    country: "IN India",
    state: "",
    city: "",
    customCity: "",
    description: "",
  });
  const [formError, setFormError] = useState("");
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);

  const [callStatus, setCallStatus] = useState<"idle" | "connecting" | "connected" | "ended" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // Dual-channel real-time voice wobbling state (User Mic + Agent Output)
  const [waveBars, setWaveBars] = useState<number[]>(() => new Array(WAVE_BARS).fill(0.08));
  const [agentLevel, setAgentLevel] = useState(0);
  const [userLevel, setUserLevel] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  // Live Real-Time Multilingual Transcript (User + Agent in spoken language)
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);

  const activeRoomRef = useRef<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<Set<HTMLAudioElement>>(new Set());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Auto-scroll live transcript panel smoothly as words stream in
  useEffect(() => {
    if (transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [transcripts]);

  const upsertTranscript = useCallback(
    (id: string, speaker: "user" | "agent", text: string, isFinal: boolean) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      setTranscripts((prev) => {
        const idx = prev.findIndex((item) => item.id === id);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { id, speaker, text: cleaned, final: isFinal };
          return updated;
        }
        // Deduplicate when both LiveKit legacy TranscriptionReceived & lk.transcription text stream emit the same utterance
        const last = prev[prev.length - 1];
        if (
          last &&
          last.speaker === speaker &&
          (last.text === cleaned || cleaned.startsWith(last.text) || last.text.startsWith(cleaned))
        ) {
          const updated = [...prev];
          updated[prev.length - 1] = {
            id: last.id,
            speaker,
            text: cleaned.length >= last.text.length ? cleaned : last.text,
            final: isFinal || last.final,
          };
          return updated;
        }
        return [...prev, { id, speaker, text: cleaned, final: isFinal }];
      });
    },
    []
  );

  const cleanupCall = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try {
        void audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }
    if (roomRef.current) {
      try {
        roomRef.current.unregisterTextStreamHandler("lk.transcription");
      } catch {
        // ignore
      }
      try {
        roomRef.current.disconnect();
      } catch {
        // ignore
      }
      roomRef.current = null;
    }
    audioElementsRef.current.forEach((el) => {
      try {
        el.pause();
        el.srcObject = null;
        el.remove();
      } catch {
        // ignore
      }
    });
    audioElementsRef.current.clear();
    setAgentLevel(0);
    setUserLevel(0);
    setAgentSpeaking(false);
    setUserSpeaking(false);
    setWaveBars(new Array(WAVE_BARS).fill(0.08));
  }, []);

  const releaseActiveRoom = useCallback(async () => {
    const roomToClose = activeRoomRef.current;
    activeRoomRef.current = null;
    if (!roomToClose) return;
    try {
      await fetch("/api/demo/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: roomToClose }),
        keepalive: true,
      });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onPageHide = () => {
      const roomToClose = activeRoomRef.current;
      if (roomToClose) {
        activeRoomRef.current = null;
        fetch("/api/demo/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: roomToClose }),
          keepalive: true,
        }).catch(() => {});
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/demo/public")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.assistants && Array.isArray(data.assistants) && data.assistants.length > 0) {
          setAssistants(sortAssistantsForGallery(data.assistants));
        }
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      cleanupCall();
      void releaseActiveRoom();
      setCallStatus("idle");
      setCallDuration(0);
      setErrorMsg("");
      return;
    }

    try {
      const cached = sessionStorage.getItem(LEAD_SESSION_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.fullName && parsed?.phone && parsed?.email) {
          setFormData((prev) => ({ ...prev, ...parsed }));
          setStep("assistants");
          return;
        }
      }
    } catch {
      // ignore
    }
    setStep("lead");
  }, [isOpen, cleanupCall, releaseActiveRoom]);

  useEffect(() => {
    if (callStatus === "connected") {
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callStatus]);

  // Start dual-channel Web Audio analyser for organic voice wobbling (both User & Agent)
  const startDualAudioWobble = useCallback((lkRoom: Room) => {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      void ctx.resume().catch(() => {});
      audioContextRef.current = ctx;

      let micAnalyser: AnalyserNode | null = null;
      let agentAnalyser: AnalyserNode | null = null;
      let micTrackId = "";
      let agentTrackId = "";
      const agentFreq = new Uint8Array(128);
      const micFreq = new Uint8Array(128);
      let lastTs = 0;

      const tick = (ts: number) => {
        if (!roomRef.current) return;
        animFrameRef.current = requestAnimationFrame(tick);
        if (ts - lastTs < 36) return;
        lastTs = ts;

        // Bind local user mic track
        const micPub = lkRoom.localParticipant?.getTrackPublication(Track.Source.Microphone);
        const micMst = micPub?.track?.mediaStreamTrack ?? null;
        if (micMst && micMst.id !== micTrackId) {
          micTrackId = micMst.id;
          try {
            micAnalyser = makeAnalyser(ctx, micMst);
          } catch {
            micAnalyser = null;
          }
        }

        // Bind remote agent audio track
        for (const p of lkRoom.remoteParticipants.values()) {
          for (const pub of p.trackPublications.values()) {
            const t = pub.track;
            if (t && t.kind === Track.Kind.Audio && t.mediaStreamTrack) {
              if (agentTrackId !== t.mediaStreamTrack.id) {
                agentTrackId = t.mediaStreamTrack.id;
                try {
                  agentAnalyser = makeAnalyser(ctx, t.mediaStreamTrack);
                } catch {
                  agentAnalyser = null;
                }
              }
            }
          }
        }

        let aSum = 0;
        if (agentAnalyser) {
          agentAnalyser.getByteFrequencyData(agentFreq);
          for (let i = 0; i < agentFreq.length; i++) aSum += agentFreq[i];
        }
        const aAvg = agentAnalyser ? aSum / agentFreq.length : 0;

        let uSum = 0;
        const muted = !!micPub?.isMuted;
        if (micAnalyser && !muted) {
          micAnalyser.getByteFrequencyData(micFreq);
          for (let i = 0; i < micFreq.length; i++) uSum += micFreq[i];
        }
        const uAvg = micAnalyser && !muted ? uSum / micFreq.length : 0;

        setAgentLevel(aAvg);
        setUserLevel(uAvg);
        const isAgentActive = aAvg > 9;
        const isUserActive = uAvg > 12;
        setAgentSpeaking(isAgentActive);
        setUserSpeaking(!isAgentActive && isUserActive);

        // Compute symmetrical wobbling waveform bars from whichever voice is stronger
        const activeFreq = aAvg >= uAvg ? agentFreq : micFreq;
        const hasSignal = isAgentActive || isUserActive;
        const nextBars = new Array(WAVE_BARS);
        const half = WAVE_BARS / 2;
        for (let i = 0; i < WAVE_BARS; i++) {
          const distFromCenter = Math.abs(i - (half - 0.5)) / half;
          const envelope = Math.cos(distFromCenter * (Math.PI / 2));
          const binIdx = Math.min(activeFreq.length - 1, Math.floor(distFromCenter * 48));
          const raw = activeFreq[binIdx] / 255;
          const idleRipple = 0.08 + 0.04 * Math.sin(ts / 240 + i * 0.55);
          nextBars[i] = hasSignal
            ? Math.max(0.1, Math.min(1, raw * envelope * 1.45 + 0.08))
            : idleRipple;
        }
        setWaveBars(nextBars);
      };

      animFrameRef.current = requestAnimationFrame(tick);
    } catch {
      // ignore audio context errors
    }
  }, []);

  const resolvedCity = formData.city === "Other" ? formData.customCity.trim() : formData.city;

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName.trim()) {
      setFormError("Please enter your full name.");
      return;
    }
    const digitsOnly = formData.phone.replace(/\D/g, "");
    if (digitsOnly.length < 7) {
      setFormError("Please enter a valid phone number.");
      return;
    }
    if (!formData.email.trim() || !formData.email.includes("@")) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (!formData.businessName.trim()) {
      setFormError("Please enter your business name.");
      return;
    }
    if (!formData.businessType) {
      setFormError("Please select your business type.");
      return;
    }
    if (formData.country === "IN India") {
      if (!formData.state) {
        setFormError("Please select your state.");
        return;
      }
      if (!resolvedCity) {
        setFormError("Please select or enter your city.");
        return;
      }
    }

    setFormError("");
    setIsSubmittingLead(true);

    try {
      sessionStorage.setItem(LEAD_SESSION_KEY, JSON.stringify(formData));
    } catch {
      // ignore
    }

    try {
      await fetch("/api/demo/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: {
            fullName: formData.fullName.trim(),
            phone: `${formData.countryCode} ${formData.phone.trim()}`,
            email: formData.email.trim(),
            businessName: formData.businessName.trim(),
            businessType: formData.businessType,
            country: formData.country,
            state: formData.state || undefined,
            city: resolvedCity || undefined,
            description: formData.description.trim() || undefined,
          },
        }),
      });
    } catch {
      // best effort
    } finally {
      setIsSubmittingLead(false);
      setStep("assistants");
    }
  };

  const handleStartCall = async (assistant: AssistantItem) => {
    setSelectedAssistant(assistant);
    setStep("call");
    cleanupCall();
    setTranscripts([]);
    setCallStatus("connecting");
    setErrorMsg("");

    await releaseActiveRoom();

    try {
      const payload = {
        assistantId: assistant.id,
        lead: {
          fullName: formData.fullName.trim(),
          phone: `${formData.countryCode} ${formData.phone.trim()}`,
          email: formData.email.trim(),
          businessName: formData.businessName.trim(),
          businessType: formData.businessType,
          country: formData.country,
          state: formData.state,
          city: resolvedCity,
          description: formData.description.trim() || undefined,
        },
      };

      let res = await fetch("/api/demo/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok && (res.status === 409 || res.status === 502)) {
        await new Promise((r) => setTimeout(r, 1500));
        res = await fetch("/api/demo/public", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Unable to connect voice session right now.");
      }

      const tokenData = await res.json();
      const { token, url, room: roomName } = tokenData;
      activeRoomRef.current = roomName || null;

      if (!token || !url) {
        throw new Error("Voice session credentials could not be created.");
      }

      const lkRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = lkRoom;

      // 1. Subscribe to LiveKit standard TranscriptionReceived events
      lkRoom.on(
        RoomEvent.TranscriptionReceived,
        (segments: TranscriptionSegment[], participant?: Participant) => {
          const isUser = participant?.identity === "demo-user";
          for (const seg of segments) {
            if (seg.text) {
              upsertTranscript(seg.id, isUser ? "user" : "agent", seg.text, !!seg.final);
            }
          }
        }
      );

      // 2. Subscribe to LiveKit Agents 1.x 'lk.transcription' real-time text streams
      try {
        lkRoom.registerTextStreamHandler("lk.transcription", async (reader, participantInfo) => {
          const attrs = reader.info?.attributes || {};
          const segId = attrs["lk.segment_id"] || reader.info?.id || `seg_${Date.now()}`;
          const localMicSid = lkRoom.localParticipant?.getTrackPublication(
            Track.Source.Microphone
          )?.trackSid;
          const transcribedTrackId = attrs["lk.transcribed_track_id"];
          const isUser =
            participantInfo?.identity === "demo-user" ||
            (!!localMicSid && transcribedTrackId === localMicSid);

          let accumulated = "";
          try {
            for await (const chunk of reader) {
              accumulated += chunk;
              upsertTranscript(segId, isUser ? "user" : "agent", accumulated, false);
            }
            const isFinal = attrs["lk.transcription_final"] !== "false";
            upsertTranscript(segId, isUser ? "user" : "agent", accumulated, isFinal);
          } catch {
            // ignore stream close
          }
        });
      } catch {
        // handler already registered or unsupported
      }

      // 3. Subscribe to remote agent voice audio track
      lkRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.style.display = "none";
          el.autoplay = true;
          document.body.appendChild(el);
          audioElementsRef.current.add(el);
          void el.play().catch(() => {});
        }
      });

      lkRoom.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        cleanupCall();
        void releaseActiveRoom();
        const normal =
          reason === undefined ||
          [
            DisconnectReason.CLIENT_INITIATED,
            DisconnectReason.ROOM_DELETED,
            DisconnectReason.PARTICIPANT_REMOVED,
          ].includes(reason);
        setCallStatus(normal ? "ended" : "error");
        if (!normal) {
          setErrorMsg("Call ended unexpectedly. Click Call Again to reconnect.");
        }
      });

      await lkRoom.connect(url, token);
      await lkRoom.localParticipant.setMicrophoneEnabled(true);

      setCallStatus("connected");
      setIsMuted(false);
      startDualAudioWobble(lkRoom);
    } catch (err) {
      cleanupCall();
      await releaseActiveRoom();
      setCallStatus("error");
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Please allow microphone permission in your browser and try again."
      );
    }
  };

  const handleEndCall = async () => {
    cleanupCall();
    setCallStatus("ended");
    await releaseActiveRoom();
  };

  const toggleMute = async () => {
    if (!roomRef.current) return;
    const nextMuted = !isMuted;
    try {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!nextMuted);
      setIsMuted(nextMuted);
    } catch {
      // ignore
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  const modalWidthClass =
    step === "assistants"
      ? "max-w-[980px]"
      : step === "call"
      ? "max-w-[880px]"
      : "max-w-[660px]";

  const availableCities = formData.state ? STATE_CITIES[formData.state] || ["Other"] : [];
  const combinedEnergy = Math.max(agentLevel, userLevel);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/85 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
    >
      {/* Unified Cyber-Emerald Brand Modal Card — Zero Inner Scroll Clutter */}
      <div
        className={`relative w-full ${modalWidthClass} overflow-hidden rounded-2xl transition-all duration-300 ${landingStyles.cyberModalSurface}`}
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#9eff00]/20 bg-[#040902]/90">
          <div className="flex items-center gap-2.5 min-w-0">
            {step !== "lead" && (
              <button
                type="button"
                onClick={async () => {
                  if (step === "call") {
                    await handleEndCall();
                    setStep("assistants");
                  } else {
                    setStep("lead");
                  }
                }}
                className="p-1.5 rounded-lg text-gray-300 hover:text-[#9eff00] hover:bg-[#9eff00]/10 transition-colors cursor-pointer"
                title={step === "call" ? "Back to Voice Agents" : "Edit Details"}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}

            <div className="flex items-center gap-2 truncate">
              <span className="h-2 w-2 rounded-full bg-[#9eff00] shadow-[0_0_8px_#9eff00] animate-pulse flex-shrink-0" />
              <span className="text-xs font-bold tracking-wider uppercase text-[#9eff00] truncate">
                {step === "lead"
                  ? "Experience Live AI Voice Demo"
                  : step === "assistants"
                  ? "Select Your Industry Voice Agent"
                  : `Live Session • ${selectedAssistant?.name || "AI Voice Agent"}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {step === "assistants" && formData.fullName && (
              <button
                type="button"
                onClick={() => setStep("lead")}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-[#9eff00]/12 border border-[#9eff00]/30 text-[#d8ff99] hover:bg-[#9eff00]/20 transition-colors cursor-pointer"
              >
                <span className="max-w-[380px] truncate">
                  {formData.fullName}
                  {formData.businessName ? ` • ${formData.businessName}` : ""}
                  {formData.businessType ? ` (${formData.businessType})` : ""}
                </span>
                <span className="underline text-[#9eff00] ml-1 flex-shrink-0">Edit</span>
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                cleanupCall();
                await releaseActiveRoom();
                onClose();
              }}
              className="rounded-full p-1.5 text-gray-400 hover:bg-[#9eff00]/15 hover:text-[#9eff00] transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── STEP 1: COMPACT SINGLE-SCREEN LEAD CAPTURE (Cyber-Green Brand) ──── */}
        {step === "lead" && (
          <div className="px-5 py-5 sm:px-7 sm:py-6">
            <div className="flex items-center gap-3.5 mb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#9eff00] text-black shadow-[0_0_24px_rgba(158,255,0,0.45)] flex-shrink-0">
                <PhoneCall className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
                  Start Your Live AI Agent Call
                </h2>
                <p className="text-xs text-[#9cb097]">
                  Enter your details once to test any of our specialized AI voice agents live.
                </p>
              </div>
            </div>

            {formError && (
              <div className="mb-3 rounded-xl bg-red-500/15 border border-red-500/40 px-3.5 py-2 text-xs text-red-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleLeadSubmit} className="space-y-3">
              {/* Row 1: Full Name + Phone Number */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-5">
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                    FULL NAME *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="John Doe"
                    className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm text-white focus:border-[#9eff00] focus:outline-none focus:ring-1 focus:ring-[#9eff00]"
                  />
                </div>

                <div className="sm:col-span-7">
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                    PHONE NUMBER *
                  </label>
                  <div className="flex items-center rounded-xl border border-[#243d1c] bg-[#0b1508] focus-within:border-[#9eff00] focus-within:ring-1 focus-within:ring-[#9eff00] overflow-hidden">
                    <select
                      aria-label="Country code"
                      value={formData.countryCode}
                      onChange={(e) => setFormData({ ...formData, countryCode: e.target.value })}
                      className="pl-2.5 pr-1.5 py-2 text-xs font-bold border-r border-[#243d1c] focus:outline-none cursor-pointer"
                    >
                      <option value="+91">IN +91</option>
                      <option value="+1">US +1</option>
                      <option value="+44">UK +44</option>
                      <option value="+971">AE +971</option>
                      <option value="+65">SG +65</option>
                      <option value="+61">AU +61</option>
                    </select>
                    <input
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="98765 43210"
                      className="w-full px-3 py-2 text-sm focus:outline-none border-0"
                    />
                  </div>
                </div>
              </div>

              {/* Row 2: Email + Business Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                    EMAIL ADDRESS *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="john@company.com"
                    className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm focus:border-[#9eff00] focus:outline-none focus:ring-1 focus:ring-[#9eff00]"
                  />
                </div>
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                    BUSINESS NAME *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.businessName}
                    onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                    placeholder="Acme Corp"
                    className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm focus:border-[#9eff00] focus:outline-none focus:ring-1 focus:ring-[#9eff00]"
                  />
                </div>
              </div>

              {/* Row 3: Business Type + Country */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                    BUSINESS / SERVICE TYPE *
                  </label>
                  <select
                    required
                    value={formData.businessType}
                    onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                    className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm focus:border-[#9eff00] focus:outline-none cursor-pointer"
                  >
                    <option value="">Select service or industry</option>
                    <option value="Hospital Appointment Booking">Hospital Appointment Booking</option>
                    <option value="Clinic Appointment Booking">Clinic Appointment Booking</option>
                    <option value="Dental Appointment Booking">Dental Appointment Booking</option>
                    <option value="Hospital Management Software (HMS)">Hospital Management Software (HMS)</option>
                    <option value="Software & AI Services">Software & AI Services</option>
                    <option value="Academic & Coaching Agency">Academic & Coaching Agency</option>
                    <option value="Customer Support / IVR">Customer Support / Conversational IVR</option>
                    <option value="Real Estate">Real Estate & Property</option>
                    <option value="E-Commerce & Retail">E-Commerce & Retail</option>
                    <option value="Banking & Finance">Banking & Finance</option>
                    <option value="Hospitality & Travel">Hospitality & Travel</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                    COUNTRY *
                  </label>
                  <select
                    value={formData.country}
                    onChange={(e) =>
                      setFormData({ ...formData, country: e.target.value, state: "", city: "" })
                    }
                    className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm focus:border-[#9eff00] focus:outline-none cursor-pointer"
                  >
                    <option value="IN India">IN India</option>
                    <option value="US United States">US United States</option>
                    <option value="AE United Arab Emirates">AE United Arab Emirates</option>
                    <option value="GB United Kingdom">GB United Kingdom</option>
                    <option value="SG Singapore">SG Singapore</option>
                    <option value="AU Australia">AU Australia</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              {/* Row 4: State + City */}
              {formData.country === "IN India" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                      STATE *
                    </label>
                    <select
                      required
                      value={formData.state}
                      onChange={(e) =>
                        setFormData({ ...formData, state: e.target.value, city: "", customCity: "" })
                      }
                      className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm focus:border-[#9eff00] focus:outline-none cursor-pointer"
                    >
                      <option value="">Select state</option>
                      {Object.keys(STATE_CITIES).map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                      CITY *
                    </label>
                    {formData.city === "Other" ? (
                      <input
                        type="text"
                        required
                        value={formData.customCity}
                        onChange={(e) => setFormData({ ...formData, customCity: e.target.value })}
                        placeholder="Enter city"
                        className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm focus:border-[#9eff00] focus:outline-none"
                      />
                    ) : (
                      <select
                        required
                        disabled={!formData.state}
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                        className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm disabled:opacity-60 focus:border-[#9eff00] focus:outline-none cursor-pointer"
                      >
                        <option value="">
                          {formData.state ? "Select city" : "Select a state first"}
                        </option>
                        {availableCities.map((ct) => (
                          <option key={ct} value={ct}>
                            {ct}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                      STATE / REGION
                    </label>
                    <input
                      type="text"
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      placeholder="State / Region"
                      className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm focus:border-[#9eff00] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                      CITY
                    </label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      placeholder="City"
                      className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm focus:border-[#9eff00] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Row 5: Compact Description (Optional) */}
              <div>
                <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#b5c7b0] mb-1">
                  DESCRIPTION <span className="text-[#6c8266] font-normal">(OPTIONAL)</span>
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional: Custom workflow or call goal..."
                  className="w-full rounded-xl border border-[#243d1c] bg-[#0b1508] px-3 py-2 text-sm focus:border-[#9eff00] focus:outline-none"
                />
              </div>

              <div className="pt-1.5">
                <button
                  type="submit"
                  disabled={isSubmittingLead}
                  className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-[#9eff00] hover:bg-[#bfff40] py-3 px-6 font-extrabold text-sm uppercase tracking-wider text-black shadow-[0_0_28px_rgba(158,255,0,0.4)] hover:shadow-[0_0_36px_rgba(158,255,0,0.65)] transition-all disabled:opacity-60 cursor-pointer"
                >
                  {isSubmittingLead ? (
                    <LoaderCircle className="w-5 h-5 animate-spin text-black" />
                  ) : (
                    <>
                      <PhoneCall className="w-4 h-4 text-black" />
                      <span>TEST WITH AI CALL</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── STEP 2: 9 CYBER-EMERALD ASSISTANT ORBS (Zero Scroll, Zero Model/Voice Names) ─ */}
        {step === "assistants" && (
          <div className="px-4 sm:px-7 py-4 sm:py-5">
            <div className="text-center mb-3">
              <h2 className="text-lg sm:text-2xl font-extrabold tracking-tight text-white">
                Choose an AI Voice Agent to Speak Live
              </h2>
              <p className="text-xs text-[#9cb097] mt-0.5">
                Click any specialized agent below — speaks naturally in English, Tamil, Telugu, Kannada, Malayalam &amp; Hindi with live captions.
              </p>
            </div>

            <div className={landingStyles.orbGrid}>
              {assistants.map((assistant) => {
                const Icon = roleIcons[assistant.role] || Users;
                const isHighlighted = preselectedRole === assistant.role;
                return (
                  <article
                    key={assistant.id}
                    className={`${landingStyles.orbStation} ${
                      isHighlighted ? landingStyles.orbHighlighted : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleStartCall(assistant)}
                      className={landingStyles.orbButton}
                      aria-label={`Start live call with ${assistant.name}`}
                    >
                      <Icon
                        size={28}
                        strokeWidth={1.7}
                        aria-hidden="true"
                        className={landingStyles.orbIcon}
                      />
                      <h3 className={landingStyles.orbTitle}>{assistant.name}</h3>
                      <span className={landingStyles.orbStatus}>
                        <i className={landingStyles.orbStatusDot} />
                        Active
                      </span>
                    </button>
                    <span className={landingStyles.orbPlinth} aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => handleStartCall(assistant)}
                      className={landingStyles.tryDemoBtn}
                    >
                      Try Demo
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* ── STEP 3: LIVE VOICE STUDIO — WOBBLING ORB + REAL-TIME MULTILINGUAL TRANSCRIPT ─ */}
        {step === "call" && selectedAssistant && (
          <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
            {/* Left Column: Reactive Wobbling Voice Orb + Waveform + Call Controls */}
            <div className="md:col-span-5 flex flex-col items-center justify-between rounded-2xl border border-[#9eff00]/20 bg-[#071104]/85 p-5 text-center">
              <div className="w-full">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#9eff00]/12 border border-[#9eff00]/30 text-[#9eff00]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#9eff00] animate-ping" />
                  Live AI Agent
                </span>
                <h3 className="text-xl sm:text-2xl font-extrabold text-white mt-2.5">
                  {selectedAssistant.name}
                </h3>
                {formData.fullName && (
                  <p className="text-xs text-[#9cb097] mt-1">
                    Caller: <strong className="text-white">{formData.fullName}</strong>
                    {formData.businessName ? ` • ${formData.businessName}` : ""}
                  </p>
                )}
              </div>

              {/* Organic Wobbling Voice Sphere */}
              <div className="relative my-5 flex h-36 w-36 items-center justify-center">
                {/* Outer reactive aura */}
                <div
                  className="absolute inset-0 rounded-full bg-[#9eff00]/25 blur-2xl transition-transform duration-100 pointer-events-none"
                  style={{
                    transform: `scale(${1 + (combinedEnergy / 100) * 0.85})`,
                    opacity: callStatus === "connected" ? 0.85 : 0.25,
                  }}
                />
                {/* Secondary sonic ring */}
                <div
                  className="absolute inset-2 rounded-full border border-[#9eff00]/40 transition-transform duration-100 pointer-events-none"
                  style={{
                    transform: `scale(${1 + (combinedEnergy / 120) * 0.5})`,
                  }}
                />
                {/* Core wobbling 3D orb */}
                <div
                  className={`relative flex h-28 w-28 items-center justify-center border-2 transition-all duration-150 ${
                    agentSpeaking || userSpeaking ? landingStyles.wobbleActive : "rounded-full"
                  } ${
                    agentSpeaking
                      ? "border-[#9eff00] shadow-[0_0_42px_rgba(158,255,0,0.55)] bg-gradient-to-br from-[#234712] to-[#0a1605]"
                      : userSpeaking
                      ? "border-[#ffd600] shadow-[0_0_36px_rgba(255,214,0,0.45)] bg-gradient-to-br from-[#38330d] to-[#0c1406]"
                      : "border-[#9eff00]/45 shadow-[0_0_24px_rgba(158,255,0,0.2)] bg-gradient-to-br from-[#162b0d] to-[#081105]"
                  }`}
                  style={{
                    transform: `scale(${1 + (combinedEnergy / 220) * 0.22})`,
                  }}
                >
                  {(() => {
                    const RoleIcon = roleIcons[selectedAssistant.role] || Users;
                    return (
                      <RoleIcon
                        className={`w-12 h-12 transition-colors duration-150 ${
                          agentSpeaking
                            ? "text-[#9eff00]"
                            : userSpeaking
                            ? "text-[#ffd600]"
                            : "text-[#c8f780]"
                        }`}
                      />
                    );
                  })()}
                </div>
              </div>

              {/* Dynamic Voice Wobble Bars + Status + Timer */}
              <div className="w-full space-y-3">
                {callStatus === "connecting" && (
                  <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[#ffd600]">
                    <LoaderCircle className="w-4 h-4 animate-spin" />
                    <span>Connecting instant voice channel...</span>
                  </div>
                )}

                {callStatus === "connected" && (
                  <>
                    <div className="flex items-center justify-center gap-[3px] h-9 px-2">
                      {waveBars.map((val, idx) => (
                        <div
                          key={idx}
                          className="w-1.5 rounded-full transition-all duration-75"
                          style={{
                            height: `${Math.max(5, Math.round(val * 34))}px`,
                            backgroundColor: agentSpeaking
                              ? "#9eff00"
                              : userSpeaking
                              ? "#ffd600"
                              : "rgba(158, 255, 0, 0.35)",
                          }}
                        />
                      ))}
                    </div>

                    <div className="flex items-center justify-center gap-3">
                      <span className="text-2xl font-mono font-extrabold text-white tracking-widest">
                        {formatTimer(callDuration)}
                      </span>
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10">
                        {agentSpeaking ? (
                          <span className="text-[#9eff00]">● Agent Speaking</span>
                        ) : userSpeaking ? (
                          <span className="text-[#ffd600]">● You Are Speaking</span>
                        ) : isMuted ? (
                          <span className="text-red-400">● Mic Muted</span>
                        ) : (
                          <span className="text-[#b5c7b0]">● Listening...</span>
                        )}
                      </span>
                    </div>
                  </>
                )}

                {callStatus === "ended" && (
                  <div>
                    <p className="text-sm font-bold text-white">Session Completed</p>
                    <p className="text-xs text-[#9cb097]">Duration: {formatTimer(callDuration)}</p>
                  </div>
                )}

                {callStatus === "error" && (
                  <div className="rounded-xl bg-red-500/15 border border-red-500/40 p-2.5 text-xs text-red-300">
                    {errorMsg}
                  </div>
                )}

                {/* Controls */}
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                  {callStatus === "connected" && (
                    <button
                      type="button"
                      onClick={toggleMute}
                      className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                        isMuted
                          ? "bg-red-500/20 border-red-500/50 text-red-200"
                          : "bg-[#12240b] border-[#9eff00]/30 text-white hover:border-[#9eff00]"
                      }`}
                    >
                      {isMuted ? <MicOff className="w-4 h-4 text-red-400" /> : <Mic className="w-4 h-4 text-[#9eff00]" />}
                      <span>{isMuted ? "Unmute" : "Mute"}</span>
                    </button>
                  )}

                  {callStatus === "connected" || callStatus === "connecting" ? (
                    <button
                      type="button"
                      onClick={handleEndCall}
                      className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider shadow-[0_0_20px_rgba(220,38,38,0.4)] transition-all cursor-pointer"
                    >
                      <PhoneOff className="w-4 h-4" />
                      <span>End Call</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStartCall(selectedAssistant)}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#12240b] hover:bg-[#1a3310] border border-[#9eff00]/35 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-[#9eff00]" />
                        <span>Call Again</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep("assistants")}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#9eff00] hover:bg-[#bfff40] text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-black" />
                        <span>All Agents</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Live Real-Time Multilingual Conversation Transcript */}
            <div className="md:col-span-7 flex flex-col rounded-2xl border border-[#9eff00]/20 bg-[#060e04]/90 overflow-hidden h-[340px] sm:h-[370px]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#9eff00]/15 bg-[#091506]">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="w-4 h-4 text-[#9eff00]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-white">
                    Live Conversation Transcript
                  </span>
                </div>
                <span className="text-[11px] text-[#9cb097]">
                  Auto-detects spoken language
                </span>
              </div>

              <div
                ref={transcriptBoxRef}
                className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth"
              >
                {transcripts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-6">
                    <p className="text-xs sm:text-sm text-[#9cb097] leading-relaxed">
                      {callStatus === "connecting"
                        ? "Preparing live transcript stream..."
                        : "Start speaking in English, Tamil, Telugu, Kannada, Malayalam, or Hindi — real-time captions for both you and the AI agent will appear here."}
                    </p>
                  </div>
                ) : (
                  transcripts.map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex flex-col ${
                        entry.speaker === "user" ? "items-end" : "items-start"
                      }`}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider mb-1 px-1 text-[#8ea688]">
                        {entry.speaker === "user"
                          ? formData.fullName || "You"
                          : selectedAssistant.name}
                      </span>
                      <div
                        className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed ${
                          entry.speaker === "user"
                            ? "bg-[#9eff00] text-black font-semibold rounded-br-sm"
                            : "bg-[#11220c] border border-[#9eff00]/25 text-[#f1f5f0] rounded-bl-sm"
                        }`}
                      >
                        {entry.text}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
