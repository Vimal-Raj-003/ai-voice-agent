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
  updatedAt: number;
}

const LEAD_SESSION_KEY = "jjv_demo_lead_v3";
const WAVE_BARS = 20;

function sanitizeLiveTranscript(raw: string, speaker: "user" | "agent"): string {
  if (!raw) return "";

  let text = raw
    .split(/\[APPLICATION CALL MEMORY/i)[0]
    .split(/\[VERIFIED BUSINESS KNOWLEDGE/i)[0]
    .split(/\[NATIVE VOICE\]/i)[0]
    .split(/BOOKING_NOT_CONFIRMED:/i)[0]
    .split(/TRANSFER_FAILED:/i)[0];

  text = text.replace(
    /\{\s*"(?:caller_evidence|direction|language|pending_question|phase|role|tone|entities|tool_state|spoken_details|active_work|booking_action_status)"[\s\S]*$/gi,
    ""
  );
  text = text.replace(/\[[A-Z_;\s=0-9]+\]/g, "");
  text = text.replace(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3040-\u30FF\u4E00-\u9FFF]+/g, "");
  text = text.replace(/\s+/g, " ").trim();

  if (!text || /^[\s.,!?…\-–—:;'"()[\]{}]+$/.test(text)) {
    return "";
  }
  if ((text.startsWith("{") && text.includes('":')) || text.startsWith('{"')) {
    return "";
  }
  if (speaker === "user" && text.length < 2) {
    return "";
  }
  return text;
}

function normalizeForDedup(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s.,!?…\-–—:;'"()]+/g, " ")
    .trim();
}

const DEFAULT_ASSISTANTS: AssistantItem[] = [
  { id: "caaad76e39781563d9ee13de0", name: "Academy Assistant", role: "academy", active: true },
  { id: "cmuv65lxx0013v7f4thzf2qtv", name: "Appointment Booker", role: "appointment", active: true },
  { id: "ccc6c12cc5f975d64b659ec72", name: "Clinic Assistant", role: "clinic", active: true },
  { id: "cmuv6w9d70017v7f4j8kth708", name: "Customer Support", role: "support", active: true },
  { id: "c40c4a0181bf251ca929f0706", name: "IVR Assistant", role: "ivr", active: true },
  { id: "cmuv75n1j0019v7f434t6xj6q", name: "Marketing Outreach", role: "marketing", active: true },
  { id: "cmuv6fea90015v7f4fexyfx8g", name: "Outbound Sales", role: "sales", active: true },
  { id: "cmuv4xd8i0011v7f4fgsgfr5x", name: "Receptionist", role: "receptionist", active: true },
  { id: "cmvxs7rk10001v7e8kcdra9ez", name: "Hospital Assistant", role: "vasan", active: true },
];

const PREFERRED_ORDER = [
  "academy",
  "appointment",
  "clinic",
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

// India-only states & major cities
const INDIA_STATES_CITIES: Record<string, string[]> = {
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Vellore", "Erode", "Tiruppur", "Hosur", "Other"],
  "Karnataka": ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi", "Belagavi", "Tumakuru", "Other"],
  "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Aurangabad", "Other"],
  "Delhi NCR": ["New Delhi", "Noida", "Gurugram", "Faridabad", "Ghaziabad", "Other"],
  "Telangana": ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Other"],
  "Kerala": ["Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur", "Kannur", "Other"],
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Nellore", "Other"],
  "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Other"],
  "West Bengal": ["Kolkata", "Howrah", "Siliguri", "Durgapur", "Other"],
  "Rajasthan": ["Jaipur", "Udaipur", "Jodhpur", "Kota", "Other"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Varanasi", "Agra", "Prayagraj", "Other"],
  "Madhya Pradesh": ["Indore", "Bhopal", "Gwalior", "Jabalpur", "Other"],
  "Punjab & Chandigarh": ["Chandigarh", "Ludhiana", "Amritsar", "Jalandhar", "Other"],
  "Puducherry": ["Puducherry", "Karaikal", "Other"],
  "Other State": ["Other"],
};

const roleIcons: Record<string, typeof Users> = {
  academy: GraduationCap,
  clinic: HeartPulse,
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
    phone: "",
    email: "",
    businessName: "",
    businessType: "",
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

  const [waveBars, setWaveBars] = useState<number[]>(() => new Array(WAVE_BARS).fill(0.08));
  const [agentLevel, setAgentLevel] = useState(0);
  const [userLevel, setUserLevel] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);

  const activeRoomRef = useRef<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<Set<HTMLAudioElement>>(new Set());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [transcripts]);

  const upsertTranscript = useCallback(
    (id: string, speaker: "user" | "agent", rawText: string, isFinal: boolean) => {
      const cleaned = sanitizeLiveTranscript(rawText, speaker);
      if (!cleaned) return;
      const now = Date.now();
      const normNew = normalizeForDedup(cleaned);
      if (!normNew) return;

      setTranscripts((prev) => {
        const byId = prev.findIndex((item) => item.id === id);
        if (byId !== -1) {
          const updated = [...prev];
          updated[byId] = { id, speaker, text: cleaned, final: isFinal, updatedAt: now };
          return updated;
        }

        for (let i = prev.length - 1; i >= Math.max(0, prev.length - 4); i--) {
          const candidate = prev[i];
          if (candidate.speaker !== speaker) continue;
          const normOld = normalizeForDedup(candidate.text);
          if (
            normOld === normNew ||
            normNew.startsWith(normOld) ||
            normOld.startsWith(normNew)
          ) {
            const updated = [...prev];
            updated[i] = {
              id: candidate.id,
              speaker,
              text: cleaned.length >= candidate.text.length ? cleaned : candidate.text,
              final: isFinal || candidate.final,
              updatedAt: now,
            };
            return updated;
          }
        }

        const last = prev[prev.length - 1];
        if (last && last.speaker === speaker) {
          // If previous bubble from same speaker was an interim draft (!last.final), REPLACE it cleanly (never duplicate/append!)
          if (!last.final) {
            const updated = [...prev];
            updated[prev.length - 1] = {
              id,
              speaker,
              text: cleaned,
              final: isFinal,
              updatedAt: now,
            };
            return updated;
          }
          // If two finalized chunks arrive back-to-back in the same speaking turn (<1.2s) and aren't duplicates, join smoothly
          if (isFinal && now - last.updatedAt < 1200 && !last.text.includes(cleaned) && !cleaned.includes(last.text)) {
            const updated = [...prev];
            updated[prev.length - 1] = {
              id: last.id,
              speaker,
              text: `${last.text} ${cleaned}`.replace(/\s+/g, " ").trim(),
              final: true,
              updatedAt: now,
            };
            return updated;
          }
        }

        return [...prev, { id, speaker, text: cleaned, final: isFinal, updatedAt: now }];
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
      // ignore
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
    if (digitsOnly.length !== 10) {
      setFormError("Please enter a valid 10-digit Indian mobile number.");
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
    if (!formData.state) {
      setFormError("Please select your state.");
      return;
    }
    if (!resolvedCity) {
      setFormError("Please select or enter your city.");
      return;
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
            phone: `+91 ${digitsOnly}`,
            email: formData.email.trim(),
            businessName: formData.businessName.trim(),
            businessType: formData.businessType,
            country: "India",
            state: formData.state,
            city: resolvedCity,
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
      const digitsOnly = formData.phone.replace(/\D/g, "");
      const payload = {
        assistantId: assistant.id,
        lead: {
          fullName: formData.fullName.trim(),
          phone: digitsOnly ? `+91 ${digitsOnly}` : "",
          email: formData.email.trim(),
          businessName: formData.businessName.trim(),
          businessType: formData.businessType,
          country: "India",
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

      // Single authoritative LiveKit TranscriptionReceived channel (eliminates dual-stream duplication)
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
          setErrorMsg("Call ended unexpectedly. Tap Call Again to reconnect.");
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
      ? "max-w-[960px]"
      : step === "call"
      ? "max-w-[900px]"
      : "max-w-[600px]";

  const availableCities = formData.state ? INDIA_STATES_CITIES[formData.state] || ["Other"] : [];
  const combinedEnergy = Math.max(agentLevel, userLevel);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-lg overflow-y-auto overscroll-contain"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative w-full ${modalWidthClass} my-auto overflow-hidden rounded-2xl transition-all duration-200 ${landingStyles.cyberModalSurface}`}
      >
        {/* Sticky Top Header Bar */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-2.5 sm:py-3 border-b border-[#7ed918]/20 bg-[#101913]/95 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
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
                className="p-1.5 rounded-lg text-gray-300 hover:text-[#8ee32b] hover:bg-[#7ed918]/10 transition-colors cursor-pointer"
                title={step === "call" ? "Back to Voice Agents" : "Edit Details"}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}

            <div className="flex items-center gap-2 truncate">
              <span className="h-2 w-2 rounded-full bg-[#8ee32b] animate-pulse flex-shrink-0" />
              <span className="text-[11px] sm:text-xs font-bold tracking-wider uppercase text-[#8ee32b] truncate">
                {step === "lead"
                  ? "Book Live Voice Demo"
                  : step === "assistants"
                  ? "Choose Industry Voice Agent"
                  : `Live Call • ${selectedAssistant?.name || "AI Voice Agent"}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {step === "assistants" && formData.fullName && (
              <button
                type="button"
                onClick={() => setStep("lead")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] sm:text-[11px] font-semibold bg-[#7ed918]/12 border border-[#7ed918]/25 text-[#d9f7b8] hover:bg-[#7ed918]/20 transition-colors cursor-pointer max-w-[160px] sm:max-w-none truncate"
              >
                <span className="truncate">{formData.fullName}</span>
                <span className="underline text-[#8ee32b] ml-0.5 flex-shrink-0">Edit</span>
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                cleanupCall();
                await releaseActiveRoom();
                onClose();
              }}
              className="rounded-full p-1.5 text-gray-400 hover:bg-[#7ed918]/15 hover:text-[#8ee32b] transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scroll-safe Modal Body (Fits 1 page cleanly, scrolls smoothly if phone keyboard opens) */}
        <div className="overflow-y-auto overscroll-contain flex-1">
          {/* ── STEP 1: INDIA-ONLY SINGLE-PAGE LEAD FORM (Mobile, Tablet & Desktop) ─ */}
          {step === "lead" && (
            <div className="px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex items-center gap-3 mb-3.5">
                <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-[#84de22] text-[#0e1710] shadow-[0_4px_16px_rgba(126,217,24,0.28)] flex-shrink-0">
                  <PhoneCall className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white leading-tight">
                    Start Your Live AI Agent Call
                  </h2>
                  <p className="text-[11px] sm:text-xs text-[#a8bba9]">
                    Quick one-time setup — test all 9 industry voice specialists live.
                  </p>
                </div>
              </div>

              {formError && (
                <div className="mb-3 rounded-xl bg-red-500/15 border border-red-500/40 px-3 py-2 text-xs text-red-300">
                  {formError}
                </div>
              )}

              <form onSubmit={handleLeadSubmit} className="space-y-2.5 sm:space-y-3">
                {/* Row 1: Full Name + Indian Mobile (+91 fixed) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#b8cab9] mb-1">
                      FULL NAME *
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="name"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      placeholder="Your full name"
                      className="w-full rounded-xl border border-[#2d4534] px-3 py-2 text-base sm:text-sm focus:border-[#84de22] focus:outline-none focus:ring-1 focus:ring-[#84de22]"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#b8cab9] mb-1">
                      MOBILE NUMBER *
                    </label>
                    <div className="flex items-center rounded-xl border border-[#2d4534] bg-[#1a2920] focus-within:border-[#84de22] focus-within:ring-1 focus-within:ring-[#84de22] overflow-hidden">
                      <span className="px-2.5 py-2 text-xs font-bold text-[#8ee32b] border-r border-[#2d4534] select-none flex-shrink-0">
                        +91
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        required
                        autoComplete="tel-national"
                        value={formData.phone}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                          })
                        }
                        placeholder="98765 43210"
                        className="w-full px-3 py-2 text-base sm:text-sm focus:outline-none border-0"
                      />
                    </div>
                  </div>
                </div>

                {/* Row 2: Email + Business Name */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#b8cab9] mb-1">
                      EMAIL ADDRESS *
                    </label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="you@company.com"
                      className="w-full rounded-xl border border-[#2d4534] px-3 py-2 text-base sm:text-sm focus:border-[#84de22] focus:outline-none focus:ring-1 focus:ring-[#84de22]"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#b8cab9] mb-1">
                      BUSINESS NAME *
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="organization"
                      value={formData.businessName}
                      onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                      placeholder="Company / Clinic / Academy"
                      className="w-full rounded-xl border border-[#2d4534] px-3 py-2 text-base sm:text-sm focus:border-[#84de22] focus:outline-none focus:ring-1 focus:ring-[#84de22]"
                    />
                  </div>
                </div>

                {/* Row 3: Business Type + State (2-col on ALL devices including Mobile!) */}
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#b8cab9] mb-1">
                      INDUSTRY *
                    </label>
                    <select
                      required
                      value={formData.businessType}
                      onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                      className="w-full rounded-xl border border-[#2d4534] px-2.5 sm:px-3 py-2 text-base sm:text-sm focus:border-[#84de22] focus:outline-none cursor-pointer"
                    >
                      <option value="">Select type</option>
                      <option value="Healthcare & Clinic">Healthcare / Clinic</option>
                      <option value="Education & Academy">Education / Academy</option>
                      <option value="Real Estate">Real Estate</option>
                      <option value="E-Commerce & Retail">E-Commerce / Retail</option>
                      <option value="Banking & Finance">Banking / Finance</option>
                      <option value="Customer Support / IVR">Support / IVR</option>
                      <option value="IT & SaaS">IT &amp; SaaS</option>
                      <option value="Hospitality & Travel">Hospitality</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#b8cab9] mb-1">
                      STATE *
                    </label>
                    <select
                      required
                      value={formData.state}
                      onChange={(e) =>
                        setFormData({ ...formData, state: e.target.value, city: "", customCity: "" })
                      }
                      className="w-full rounded-xl border border-[#2d4534] px-2.5 sm:px-3 py-2 text-base sm:text-sm focus:border-[#84de22] focus:outline-none cursor-pointer"
                    >
                      <option value="">Select state</option>
                      {Object.keys(INDIA_STATES_CITIES).map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 4: City + Optional Note (2-col on ALL devices so form stays 1 screen!) */}
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#b8cab9] mb-1">
                      CITY *
                    </label>
                    {formData.city === "Other" ? (
                      <input
                        type="text"
                        required
                        value={formData.customCity}
                        onChange={(e) => setFormData({ ...formData, customCity: e.target.value })}
                        placeholder="Enter city"
                        className="w-full rounded-xl border border-[#2d4534] px-2.5 sm:px-3 py-2 text-base sm:text-sm focus:border-[#84de22] focus:outline-none"
                      />
                    ) : (
                      <select
                        required
                        disabled={!formData.state}
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                        className="w-full rounded-xl border border-[#2d4534] px-2.5 sm:px-3 py-2 text-base sm:text-sm disabled:opacity-60 focus:border-[#84de22] focus:outline-none cursor-pointer"
                      >
                        <option value="">
                          {formData.state ? "Select city" : "Select state first"}
                        </option>
                        {availableCities.map((ct) => (
                          <option key={ct} value={ct}>
                            {ct}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#b8cab9] mb-1">
                      NOTE <span className="text-[#7c9480] font-normal">(OPTIONAL)</span>
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Optional use case..."
                      className="w-full rounded-xl border border-[#2d4534] px-2.5 sm:px-3 py-2 text-base sm:text-sm focus:border-[#84de22] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="pt-1.5">
                  <button
                    type="submit"
                    disabled={isSubmittingLead}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#84de22] hover:bg-[#94e838] py-3 px-5 font-extrabold text-sm uppercase tracking-wider text-[#0e1710] shadow-[0_6px_20px_rgba(126,217,24,0.28)] transition-all disabled:opacity-60 cursor-pointer"
                  >
                    {isSubmittingLead ? (
                      <LoaderCircle className="w-5 h-5 animate-spin text-[#0e1710]" />
                    ) : (
                      <>
                        <PhoneCall className="w-4 h-4 text-[#0e1710]" />
                        <span>TEST WITH AI CALL</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── STEP 2: 9 INDUSTRY VOICE AGENTS (3x3 Mobile/Tablet, 5x2 Desktop) ─ */}
          {step === "assistants" && (
            <div className="px-3 sm:px-6 py-3.5 sm:py-5">
              <div className="text-center mb-2.5 sm:mb-3">
                <h2 className="text-base sm:text-2xl font-extrabold tracking-tight text-white">
                  Choose an AI Voice Agent to Speak Live
                </h2>
                <p className="text-[11px] sm:text-xs text-[#a8bba9] mt-0.5">
                  Tap any role below to start an instant voice call with live captions.
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
                          size={26}
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

          {/* ── STEP 3: LIVE VOICE STUDIO (Responsive Mobile + Tablet + Desktop) ─ */}
          {step === "call" && selectedAssistant && (
            <div className="p-3.5 sm:p-5 grid grid-cols-1 md:grid-cols-12 gap-3.5 sm:gap-5 items-stretch">
              {/* Voice Sphere + Waveform + Controls */}
              <div className="md:col-span-5 flex flex-col items-center justify-between rounded-2xl border border-[#7ed918]/20 bg-[#17251c]/90 p-4 sm:p-5 text-center">
                <div className="w-full">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider bg-[#7ed918]/12 border border-[#7ed918]/25 text-[#8ee32b]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#8ee32b] animate-ping" />
                    Live Voice Session
                  </span>
                  <h3 className="text-lg sm:text-2xl font-extrabold text-white mt-1.5 sm:mt-2">
                    {selectedAssistant.name}
                  </h3>
                  {formData.fullName && (
                    <p className="text-[11px] sm:text-xs text-[#a8bba9] mt-0.5 truncate">
                      Caller: <strong className="text-white">{formData.fullName}</strong>
                      {formData.businessName ? ` • ${formData.businessName}` : ""}
                    </p>
                  )}
                </div>

                {/* Wobbling Voice Sphere (Compact on mobile so captions stay fully visible!) */}
                <div className="relative my-2.5 sm:my-5 flex h-24 w-24 sm:h-36 sm:w-36 items-center justify-center">
                  <div
                    className="absolute inset-0 rounded-full bg-[#7ed918]/20 blur-xl transition-transform duration-100 pointer-events-none"
                    style={{
                      transform: `scale(${1 + (combinedEnergy / 100) * 0.75})`,
                      opacity: callStatus === "connected" ? 0.8 : 0.25,
                    }}
                  />
                  <div
                    className={`relative flex h-20 w-20 sm:h-28 sm:w-28 items-center justify-center border-2 transition-all duration-150 ${
                      agentSpeaking || userSpeaking ? landingStyles.wobbleActive : "rounded-full"
                    } ${
                      agentSpeaking
                        ? "border-[#8ee32b] shadow-[0_0_28px_rgba(126,217,24,0.4)] bg-gradient-to-br from-[#294b30] to-[#142318]"
                        : userSpeaking
                        ? "border-[#f5ca3c] shadow-[0_0_26px_rgba(245,202,60,0.35)] bg-gradient-to-br from-[#3e3a1c] to-[#162219]"
                        : "border-[#7ed918]/40 shadow-[0_0_18px_rgba(126,217,24,0.16)] bg-gradient-to-br from-[#203626] to-[#131f16]"
                    }`}
                    style={{
                      transform: `scale(${1 + (combinedEnergy / 220) * 0.2})`,
                    }}
                  >
                    {(() => {
                      const RoleIcon = roleIcons[selectedAssistant.role] || Users;
                      return (
                        <RoleIcon
                          className={`w-9 h-9 sm:w-12 sm:h-12 transition-colors duration-150 ${
                            agentSpeaking
                              ? "text-[#8ee32b]"
                              : userSpeaking
                              ? "text-[#f5ca3c]"
                              : "text-[#c6eba0]"
                          }`}
                        />
                      );
                    })()}
                  </div>
                </div>

                <div className="w-full space-y-2.5">
                  {callStatus === "connecting" && (
                    <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[#f5ca3c]">
                      <LoaderCircle className="w-4 h-4 animate-spin" />
                      <span>Connecting live voice channel...</span>
                    </div>
                  )}

                  {callStatus === "connected" && (
                    <>
                      <div className="flex items-center justify-center gap-[3px] h-7 sm:h-9 px-2">
                        {waveBars.map((val, idx) => (
                          <div
                            key={idx}
                            className="w-1.5 rounded-full transition-all duration-75"
                            style={{
                              height: `${Math.max(4, Math.round(val * 30))}px`,
                              backgroundColor: agentSpeaking
                                ? "#8ee32b"
                                : userSpeaking
                                ? "#f5ca3c"
                                : "rgba(138, 224, 48, 0.35)",
                            }}
                          />
                        ))}
                      </div>

                      <div className="flex items-center justify-center gap-2.5">
                        <span className="text-xl sm:text-2xl font-mono font-extrabold text-white tracking-widest">
                          {formatTimer(callDuration)}
                        </span>
                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10">
                          {agentSpeaking ? (
                            <span className="text-[#8ee32b]">● Agent Speaking</span>
                          ) : userSpeaking ? (
                            <span className="text-[#f5ca3c]">● You Are Speaking</span>
                          ) : isMuted ? (
                            <span className="text-red-300">● Mic Muted</span>
                          ) : (
                            <span className="text-[#b8cab9]">● Listening...</span>
                          )}
                        </span>
                      </div>
                    </>
                  )}

                  {callStatus === "ended" && (
                    <div>
                      <p className="text-xs sm:text-sm font-bold text-white">Session Completed</p>
                      <p className="text-[11px] text-[#a8bba9]">Duration: {formatTimer(callDuration)}</p>
                    </div>
                  )}

                  {callStatus === "error" && (
                    <div className="rounded-xl bg-red-500/15 border border-red-500/40 p-2 text-xs text-red-300">
                      {errorMsg}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
                    {callStatus === "connected" && (
                      <button
                        type="button"
                        onClick={toggleMute}
                        className={`flex items-center gap-1.5 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl border font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                          isMuted
                            ? "bg-red-500/20 border-red-500/50 text-red-200"
                            : "bg-[#1e3124] border-[#7ed918]/30 text-white hover:border-[#8ee32b]"
                        }`}
                      >
                        {isMuted ? <MicOff className="w-4 h-4 text-red-300" /> : <Mic className="w-4 h-4 text-[#8ee32b]" />}
                        <span>{isMuted ? "Unmute" : "Mute"}</span>
                      </button>
                    )}

                    {callStatus === "connected" || callStatus === "connecting" ? (
                      <button
                        type="button"
                        onClick={handleEndCall}
                        className="flex items-center gap-1.5 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider shadow-[0_4px_16px_rgba(220,38,38,0.35)] transition-all cursor-pointer"
                      >
                        <PhoneOff className="w-4 h-4" />
                        <span>End Call</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleStartCall(selectedAssistant)}
                          className="flex items-center gap-1.5 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-[#1e3124] hover:bg-[#263d2d] border border-[#7ed918]/35 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-[#8ee32b]" />
                          <span>Call Again</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setStep("assistants")}
                          className="flex items-center gap-1.5 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-[#84de22] hover:bg-[#94e838] text-[#0e1710] font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-[#0e1710]" />
                          <span>All Agents</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Clean, Deduplicated, Multilingual Live Conversation Captions */}
              <div className="md:col-span-7 flex flex-col rounded-2xl border border-[#7ed918]/20 bg-[#15221a]/95 overflow-hidden h-[240px] sm:h-[360px]">
                <div className="flex items-center justify-between px-3.5 py-2.5 sm:px-4 sm:py-3 border-b border-[#7ed918]/15 bg-[#19291f] flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="w-4 h-4 text-[#8ee32b]" />
                    <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-white">
                      Live Conversation Captions
                    </span>
                  </div>
                  <span className="text-[10.5px] sm:text-[11px] text-[#a8bba9]">
                    Multilingual
                  </span>
                </div>

                <div
                  ref={transcriptBoxRef}
                  className="flex-1 overflow-y-auto overflow-x-hidden p-3.5 sm:p-4 space-y-3 scroll-smooth"
                >
                  {transcripts.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4">
                      <p className="text-xs sm:text-sm text-[#a8bba9] leading-relaxed">
                        {callStatus === "connecting"
                          ? "Preparing live conversation captions..."
                          : "Speak naturally in English, Tamil, Tanglish, or Hindi — your live conversation captions appear cleanly right here."}
                      </p>
                    </div>
                  ) : (
                    transcripts.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex flex-col min-w-0 ${
                          entry.speaker === "user" ? "items-end" : "items-start"
                        }`}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wider mb-1 px-1 text-[#97ad99]">
                          {entry.speaker === "user"
                            ? formData.fullName || "Caller"
                            : selectedAssistant.name}
                        </span>
                        <div
                          className={`max-w-[86%] rounded-2xl px-3.5 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm leading-relaxed break-words [overflow-wrap:anywhere] ${
                            entry.speaker === "user"
                              ? "bg-[#23422b] border border-[#84de22]/40 text-[#f3f8f4] font-medium rounded-br-sm shadow-sm"
                              : "bg-[#1b2c21] border border-white/10 text-[#edf3ee] rounded-bl-sm shadow-sm"
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
    </div>
  );
};
