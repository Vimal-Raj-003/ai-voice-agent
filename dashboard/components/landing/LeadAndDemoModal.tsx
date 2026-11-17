"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
  DisconnectReason,
  type RemoteTrack,
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
  engine: string;
  model: string;
  voice: string;
  active: boolean;
}

const LEAD_SESSION_KEY = "jjv_demo_lead_v1";

// Ordered to match Screenshot 3 (5 on Row 1 + 4 on Row 2)
const DEFAULT_ASSISTANTS: AssistantItem[] = [
  {
    id: "caaad76e39781563d9ee13de0",
    name: "Academy Assistant",
    role: "academy",
    engine: "gemini-live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Zephyr",
    active: true,
  },
  {
    id: "cmuv65lxx0013v7f4thzf2qtv",
    name: "Appointment Booker",
    role: "appointment",
    engine: "gemini-live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Despina",
    active: true,
  },
  {
    id: "ccc6c12cc5f975d64b659ec72",
    name: "Clinic Assistant",
    role: "clinic",
    engine: "gemini-live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Zephyr",
    active: true,
  },
  {
    id: "cmuv6w9d70017v7f4j8kth708",
    name: "Customer Support",
    role: "support",
    engine: "gemini-live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Zephyr",
    active: true,
  },
  {
    id: "c40c4a0181bf251ca929f0706",
    name: "IVR Assistant",
    role: "ivr",
    engine: "gemini-live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Zephyr",
    active: true,
  },
  {
    id: "cmuv75n1j0019v7f434t6xj6q",
    name: "Marketing Outreach",
    role: "marketing",
    engine: "gemini-live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Zephyr",
    active: true,
  },
  {
    id: "cmuv6fea90015v7f4fexyfx8g",
    name: "Outbound Sales",
    role: "sales",
    engine: "gemini-live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Algieba",
    active: true,
  },
  {
    id: "cmuv4xd8i0011v7f4fgsgfr5x",
    name: "Receptionist",
    role: "receptionist",
    engine: "gemini-live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Zephyr",
    active: true,
  },
  {
    id: "cmvxs7rk10001v7e8kcdra9ez",
    name: "Vasan Eye Care – AI Appointment Assistant",
    role: "vasan",
    engine: "gemini-live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Zephyr",
    active: true,
  },
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
  vasan: HeartPulse,
  ivr: Workflow,
  appointment: CalendarDays,
  support: Headphones,
  marketing: Megaphone,
  sales: PhoneCall,
  receptionist: Users,
};

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
  const [audioLevel, setAudioLevel] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);

  const activeRoomRef = useRef<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<Set<HTMLAudioElement>>(new Set());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

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
    analyserRef.current = null;
    setAudioLevel(0);
    setAgentSpeaking(false);
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

  // Ensure tab refresh/close immediately frees the active LiveKit room
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

  // Fetch live assistants from DB when modal opens
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

  // Restore saved lead in session so user doesn't have to re-fill form repeatedly
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

  // Call duration timer
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

  const startAudioVisualizer = (remoteTrack: RemoteTrack) => {
    try {
      const mediaStreamTrack = remoteTrack.mediaStreamTrack;
      if (!mediaStreamTrack) return;

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;

      const mediaStream = new MediaStream([mediaStreamTrack]);
      const source = ctx.createMediaStreamSource(mediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setAudioLevel(avg);
        setAgentSpeaking(avg > 10);
        animFrameRef.current = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch {
      // ignore visualizer errors
    }
  };

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
      // ignore storage quota
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
      // Lead persistence is best-effort so demo never blocks
    } finally {
      setIsSubmittingLead(false);
      setStep("assistants");
    }
  };

  const handleStartCall = async (assistant: AssistantItem) => {
    setSelectedAssistant(assistant);
    setStep("call");
    cleanupCall();
    setCallStatus("connecting");
    setErrorMsg("");

    // Release any previous active demo room before requesting a new dispatch
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

      // If previous room was still tearing down on LiveKit Cloud (409/502), wait 1.5s and retry once
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
        throw new Error(errorData.error || "Failed to initialize demo voice call.");
      }

      const tokenData = await res.json();
      const { token, url, room: roomName } = tokenData;
      activeRoomRef.current = roomName || null;

      if (!token || !url) {
        throw new Error("Invalid voice token received from service.");
      }

      const lkRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = lkRoom;

      lkRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.style.display = "none";
          el.autoplay = true;
          document.body.appendChild(el);
          audioElementsRef.current.add(el);
          void el.play().catch(() => {});
          startAudioVisualizer(track);
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
          setErrorMsg("The voice call ended unexpectedly. Please click Call Again.");
        }
      });

      await lkRoom.connect(url, token);
      await lkRoom.localParticipant.setMicrophoneEnabled(true);

      setCallStatus("connected");
      setIsMuted(false);
    } catch (err) {
      cleanupCall();
      await releaseActiveRoom();
      setCallStatus("error");
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Could not connect to microphone or voice service."
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
      ? "max-w-[1120px]"
      : step === "call"
      ? "max-w-xl"
      : "max-w-[540px]";

  const availableCities = formData.state ? STATE_CITIES[formData.state] || ["Other"] : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-xl overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      {/* Modal Card */}
      <div
        className={`relative w-full ${modalWidthClass} my-auto overflow-hidden rounded-3xl border shadow-[0_0_90px_rgba(112,68,255,0.28)] transition-all duration-300 ${
          step === "assistants"
            ? `${landingStyles.assistantGallerySurface} border-purple-200/80`
            : `${landingStyles.darkModalSurface} border-[#262c52] bg-gradient-to-b from-[#12152a] to-[#0b0d1b]`
        }`}
      >
        {/* Top Bar */}
        <div
          className={`flex items-center justify-between px-5 sm:px-7 py-3.5 border-b ${
            step === "assistants"
              ? "border-gray-200 bg-white/90 text-[#1e1b2e]"
              : "border-[#1f2547] bg-[#0d1022]/90 text-white"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
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
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  step === "assistants"
                    ? "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    : "text-gray-300 hover:text-white hover:bg-white/10"
                }`}
                title={step === "call" ? "Back to Assistants" : "Edit Your Details"}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}

            <div className="flex items-center gap-2 truncate">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span
                className={`text-xs font-semibold tracking-wider uppercase truncate ${
                  step === "assistants" ? "text-purple-800" : "text-purple-300"
                }`}
              >
                {step === "lead"
                  ? "Book A Demo"
                  : step === "assistants"
                  ? "Choose Your AI Voice Assistant"
                  : `Live Call • ${selectedAssistant?.name || "AI Agent"}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {step === "assistants" && formData.fullName && (
              <button
                type="button"
                onClick={() => setStep("lead")}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-900 hover:bg-purple-200 transition-colors cursor-pointer"
              >
                <span>
                  {formData.fullName}
                  {formData.businessName ? ` • ${formData.businessName}` : ""}
                </span>
                <span className="underline ml-1">Edit</span>
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                cleanupCall();
                await releaseActiveRoom();
                onClose();
              }}
              className={`rounded-full p-1.5 transition-colors cursor-pointer ${
                step === "assistants"
                  ? "text-gray-500 hover:bg-gray-200 hover:text-gray-900"
                  : "text-gray-400 hover:bg-white/10 hover:text-white"
              }`}
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── STEP 1: LEAD CAPTURE FORM (Matches Screenshot 2) ─────────────────── */}
        {step === "lead" && (
          <div className="px-6 py-7 sm:px-9 sm:py-8">
            {/* Glowing Purple Phone Badge */}
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-b from-[#7c5cff] to-[#6240f5] shadow-[0_0_28px_rgba(124,92,255,0.55)]">
              <PhoneCall className="w-6 h-6 text-white" />
            </div>

            <div className="text-center mb-6">
              <h2 className="text-2xl sm:text-[26px] font-extrabold tracking-tight text-white">
                Start Your AI Agent Call
              </h2>
              <p className="text-xs sm:text-sm text-[#949bc0] mt-1.5">
                Fill in your details and our Jill-Jill agent will connect with you instantly.
              </p>
            </div>

            {formError && (
              <div className="mb-4 rounded-xl bg-red-500/15 border border-red-500/40 px-4 py-2.5 text-center text-xs text-red-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleLeadSubmit} className="space-y-3.5">
              {/* Row 1: FULL NAME * + PHONE NUMBER * side-by-side */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                    FULL NAME *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="John Doe"
                    className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white placeholder-[#5e668c] focus:border-[#7c5cff] focus:outline-none focus:ring-1 focus:ring-[#7c5cff]"
                  />
                </div>

                <div className="sm:col-span-7">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                    PHONE NUMBER *
                  </label>
                  <div className="flex items-center rounded-xl border border-[#283059] bg-[#161a34] focus-within:border-[#7c5cff] focus-within:ring-1 focus-within:ring-[#7c5cff] overflow-hidden">
                    <select
                      aria-label="Country code"
                      value={formData.countryCode}
                      onChange={(e) => setFormData({ ...formData, countryCode: e.target.value })}
                      className="bg-[#161a34] pl-3 pr-2 py-2.5 text-xs font-bold text-white border-r border-[#283059] focus:outline-none cursor-pointer"
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
                      className="w-full bg-[#161a34] px-3 py-2.5 text-sm text-white placeholder-[#5e668c] focus:outline-none border-0"
                    />
                  </div>
                </div>
              </div>

              {/* EMAIL ADDRESS * */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                  EMAIL ADDRESS *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@company.com"
                  className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white placeholder-[#5e668c] focus:border-[#7c5cff] focus:outline-none focus:ring-1 focus:ring-[#7c5cff]"
                />
              </div>

              {/* BUSINESS NAME * */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                  BUSINESS NAME *
                </label>
                <input
                  type="text"
                  required
                  value={formData.businessName}
                  onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                  placeholder="Acme Corp"
                  className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white placeholder-[#5e668c] focus:border-[#7c5cff] focus:outline-none focus:ring-1 focus:ring-[#7c5cff]"
                />
              </div>

              {/* BUSINESS TYPE * */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                  BUSINESS TYPE *
                </label>
                <select
                  required
                  value={formData.businessType}
                  onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                  className="w-full sm:w-3/5 rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white focus:border-[#7c5cff] focus:outline-none cursor-pointer"
                >
                  <option value="">Select type</option>
                  <option value="Healthcare & Clinic">Healthcare & Clinic</option>
                  <option value="Education & Academy">Education & Academy</option>
                  <option value="Real Estate">Real Estate</option>
                  <option value="E-Commerce & Retail">E-Commerce & Retail</option>
                  <option value="Banking & Finance">Banking & Finance</option>
                  <option value="Customer Support / IVR">Customer Support / IVR</option>
                  <option value="IT & SaaS">IT & SaaS</option>
                  <option value="Hospitality & Travel">Hospitality & Travel</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* COUNTRY * */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                  COUNTRY *
                </label>
                <select
                  value={formData.country}
                  onChange={(e) =>
                    setFormData({ ...formData, country: e.target.value, state: "", city: "" })
                  }
                  className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white focus:border-[#7c5cff] focus:outline-none cursor-pointer"
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

              {/* STATE * & CITY * side-by-side */}
              {formData.country === "IN India" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                      STATE *
                    </label>
                    <select
                      required
                      value={formData.state}
                      onChange={(e) =>
                        setFormData({ ...formData, state: e.target.value, city: "", customCity: "" })
                      }
                      className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white focus:border-[#7c5cff] focus:outline-none cursor-pointer"
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
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                      CITY *
                    </label>
                    {formData.city === "Other" ? (
                      <input
                        type="text"
                        required
                        value={formData.customCity}
                        onChange={(e) => setFormData({ ...formData, customCity: e.target.value })}
                        placeholder="Enter your city"
                        className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white placeholder-[#5e668c] focus:border-[#7c5cff] focus:outline-none"
                      />
                    ) : (
                      <select
                        required
                        disabled={!formData.state}
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                        className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white disabled:opacity-60 focus:border-[#7c5cff] focus:outline-none cursor-pointer"
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                      STATE / REGION
                    </label>
                    <input
                      type="text"
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      placeholder="State / Province"
                      className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white placeholder-[#5e668c] focus:border-[#7c5cff] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                      CITY
                    </label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      placeholder="City"
                      className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2.5 text-sm text-white placeholder-[#5e668c] focus:border-[#7c5cff] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* DESCRIPTION (OPTIONAL) */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#9ba3c7] mb-1.5">
                  DESCRIPTION <span className="text-[#6c759e] font-normal">(OPTIONAL)</span>
                </label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional: Tell us briefly about your use case..."
                  className="w-full rounded-xl border border-[#283059] bg-[#161a34] px-3.5 py-2 text-sm text-white placeholder-[#5e668c] focus:border-[#7c5cff] focus:outline-none"
                />
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmittingLead}
                  className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#6549f7] via-[#7547f9] to-[#8048fb] py-3.5 px-6 font-bold text-sm sm:text-base text-white shadow-[0_8px_30px_rgba(117,71,249,0.5)] hover:shadow-[0_10px_38px_rgba(117,71,249,0.7)] hover:brightness-110 transition-all disabled:opacity-60 cursor-pointer"
                >
                  {isSubmittingLead ? (
                    <LoaderCircle className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <PhoneCall className="w-5 h-5" />
                      <span>TEST WITH AI Call</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── STEP 2: 9 ASSISTANT ORB STATIONS (Matches Screenshot 3) ─────────── */}
        {step === "assistants" && (
          <div className="px-4 sm:px-8 py-6 sm:py-8 max-h-[82vh] overflow-y-auto">
            <div className="text-center mb-2">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#1c1830]">
                Select an AI Assistant to Start Live Call
              </h2>
              <p className="text-xs sm:text-sm text-[#5b5675] mt-1">
                Click any assistant below to speak live in English, Tamil, or Tanglish — powered by{" "}
                <strong className="text-[#5b34c9]">Gemini 3.1 Flash Live</strong>.
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
                      aria-label={`Start demo call with ${assistant.name}`}
                    >
                      <Icon
                        size={36}
                        strokeWidth={1.6}
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
                    <span className={landingStyles.orbVoice}>{assistant.voice}</span>
                    <button
                      type="button"
                      onClick={() => handleStartCall(assistant)}
                      className={landingStyles.tryDemoBtn}
                    >
                      Try Demo
                    </button>
                    {assistant.role === "ivr" && (
                      <button
                        type="button"
                        onClick={() => handleStartCall(assistant)}
                        className={landingStyles.testTransferBtn}
                      >
                        Test transfer
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* ── STEP 3: LIVE WEBRTC VOICE CALL ─────────────────────────────────── */}
        {step === "call" && selectedAssistant && (
          <div className="px-6 py-9 sm:px-10 sm:py-11 text-center">
            {/* Pulsating 3D Orb */}
            <div className="relative mx-auto my-4 flex h-40 w-40 items-center justify-center">
              <div
                className="absolute inset-0 rounded-full bg-gradient-to-tr from-purple-500/35 to-[#9eff00]/35 blur-xl transition-all duration-150"
                style={{
                  transform: `scale(${1 + (audioLevel / 100) * 0.75})`,
                  opacity: callStatus === "connected" ? 0.8 : 0.25,
                }}
              />
              <div
                className={`relative flex h-32 w-32 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                  agentSpeaking
                    ? "border-[#9eff00] shadow-[0_0_50px_rgba(158,255,0,0.45)] bg-gradient-to-br from-[#5b477b] to-[#1e133d]"
                    : "border-purple-400/60 shadow-[0_0_32px_rgba(168,85,247,0.35)] bg-gradient-to-br from-[#483666] to-[#19132e]"
                }`}
                style={{
                  transform: agentSpeaking ? "scale(1.06)" : "scale(1)",
                }}
              >
                {(() => {
                  const RoleIcon = roleIcons[selectedAssistant.role] || Users;
                  return (
                    <RoleIcon
                      className={`w-14 h-14 transition-colors duration-200 ${
                        agentSpeaking ? "text-[#9eff00]" : "text-purple-200"
                      }`}
                    />
                  );
                })()}
              </div>
            </div>

            <h3 className="text-2xl font-bold text-white mb-2">
              {selectedAssistant.name}
            </h3>

            <div className="flex flex-wrap items-center justify-center gap-2 text-xs mb-3">
              <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-200 border border-purple-400/30">
                Voice: {selectedAssistant.voice}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-[#9eff00]/15 text-[#9eff00] border border-[#9eff00]/35 font-semibold">
                Gemini 3.1 Flash Live
              </span>
            </div>

            {formData.fullName && (
              <p className="text-xs text-[#9ba3c7] mb-5">
                Caller: <strong className="text-white">{formData.fullName}</strong>
                {formData.businessName ? ` • ${formData.businessName}` : ""}
              </p>
            )}

            {callStatus === "connecting" && (
              <div className="flex items-center justify-center gap-2 text-sm text-amber-300 mb-7">
                <LoaderCircle className="w-4 h-4 animate-spin" />
                <span>Connecting real-time voice session...</span>
              </div>
            )}

            {callStatus === "connected" && (
              <div className="mb-5 space-y-1">
                <div className="text-3xl font-mono font-bold text-white tracking-widest">
                  {formatTimer(callDuration)}
                </div>
                <p className="text-xs">
                  {agentSpeaking ? (
                    <span className="text-[#9eff00] font-semibold animate-pulse">
                      ● Assistant is speaking...
                    </span>
                  ) : (
                    <span className="text-[#a5add0]">Listening — speak naturally in English or Tamil...</span>
                  )}
                </p>
              </div>
            )}

            {callStatus === "ended" && (
              <div className="mb-6">
                <p className="text-sm font-semibold text-gray-200">Call Ended</p>
                <p className="text-xs text-[#8f97bd] mt-0.5">Duration: {formatTimer(callDuration)}</p>
              </div>
            )}

            {callStatus === "error" && (
              <div className="mb-6 rounded-xl bg-red-500/15 border border-red-500/40 p-3.5 max-w-md mx-auto text-xs text-red-300">
                {errorMsg || "Connection failed. Please check microphone permissions and try again."}
              </div>
            )}

            {callStatus === "connected" && (
              <div className="flex items-center justify-center gap-1.5 h-8 mb-7">
                {[...Array(9)].map((_, i) => {
                  const factor = Math.sin((i / 8) * Math.PI);
                  const barHeight = Math.max(6, Math.min(32, (audioLevel / 2) * factor + 6));
                  return (
                    <div
                      key={i}
                      className="w-1.5 rounded-full transition-all duration-75"
                      style={{
                        height: `${barHeight}px`,
                        backgroundColor: agentSpeaking ? "#9eff00" : "#a855f7",
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Call Controls */}
            <div className="flex flex-wrap items-center justify-center gap-3.5">
              {callStatus === "connected" && (
                <button
                  type="button"
                  onClick={toggleMute}
                  className={`flex items-center gap-2 px-5 py-3 rounded-2xl border font-semibold text-sm transition-all cursor-pointer ${
                    isMuted
                      ? "bg-red-500/20 border-red-500/50 text-red-200 hover:bg-red-500/30"
                      : "bg-white/10 border-white/20 text-white hover:bg-white/20"
                  }`}
                >
                  {isMuted ? <MicOff className="w-4 h-4 text-red-300" /> : <Mic className="w-4 h-4" />}
                  <span>{isMuted ? "Unmute" : "Mute"}</span>
                </button>
              )}

              {callStatus === "connected" || callStatus === "connecting" ? (
                <button
                  type="button"
                  onClick={handleEndCall}
                  className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm shadow-[0_0_24px_rgba(220,38,38,0.45)] transition-all cursor-pointer"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>End Call</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleStartCall(selectedAssistant)}
                    className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-sm transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Call Again</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("assistants")}
                    className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-[#6549f7] to-[#8048fb] text-white font-semibold text-sm shadow-[0_0_24px_rgba(117,71,249,0.45)] hover:brightness-110 transition-all cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>All 9 Assistants</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
