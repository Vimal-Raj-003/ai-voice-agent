"use client";

import React, { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import styles from "../AssistantLibrary.module.css";

interface LeadAndDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedAssistantId?: string;
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
  preselectedAssistantId,
}) => {
  const [step, setStep] = useState<"lead" | "assistants" | "call">("lead");
  const [assistants, setAssistants] = useState<AssistantItem[]>(DEFAULT_ASSISTANTS);
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantItem | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    fullName: "",
    countryCode: "+91",
    phone: "",
    email: "",
    businessName: "",
    businessType: "Select type",
    country: "IN India",
    state: "Tamil Nadu",
    city: "Chennai",
    description: "",
  });
  const [formError, setFormError] = useState("");
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);

  // Call & WebRTC State
  const [callStatus, setCallStatus] = useState<"idle" | "connecting" | "connected" | "ended" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [activeRoomName, setActiveRoomName] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<Set<HTMLAudioElement>>(new Set());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Fetch available assistants dynamically from API
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/demo/public")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.assistants && Array.isArray(data.assistants) && data.assistants.length > 0) {
          setAssistants(data.assistants);
        }
      })
      .catch((e) => console.warn("Could not fetch remote assistants list, using defaults:", e));
  }, [isOpen]);

  // Reset or cleanup on open/close
  useEffect(() => {
    if (!isOpen) {
      cleanupCall();
      setCallStatus("idle");
      setCallDuration(0);
      setErrorMsg("");
      setStep("lead");
    } else if (preselectedAssistantId) {
      const match = assistants.find((a) => a.id === preselectedAssistantId);
      if (match) setSelectedAssistant(match);
    }
  }, [isOpen, preselectedAssistantId]);

  // Timer counter when connected
  useEffect(() => {
    if (callStatus === "connected") {
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callStatus]);

  const cleanupCall = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try {
        audioContextRef.current.close();
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
    setAudioLevel(0);
    setAgentSpeaking(false);
  };

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
    } catch (e) {
      console.warn("Audio visualizer init error:", e);
    }
  };

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName.trim()) {
      setFormError("Please enter your full name.");
      return;
    }
    if (!formData.phone.trim() || formData.phone.trim().length < 7) {
      setFormError("Please enter a valid phone number.");
      return;
    }
    if (!formData.email.trim() || !formData.email.includes("@")) {
      setFormError("Please enter a valid email address.");
      return;
    }

    setFormError("");
    setIsSubmittingLead(true);

    try {
      // Save lead to database
      await fetch("/api/demo/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: {
            fullName: formData.fullName,
            phone: `${formData.countryCode} ${formData.phone}`,
            email: formData.email,
            businessName: formData.businessName,
            businessType: formData.businessType !== "Select type" ? formData.businessType : undefined,
            country: formData.country,
            state: formData.state,
            city: formData.city,
            description: formData.description,
          },
        }),
      });
    } catch (err) {
      console.warn("Lead record notice:", err);
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

    try {
      const res = await fetch("/api/demo/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: assistant.id,
          lead: {
            fullName: formData.fullName,
            phone: `${formData.countryCode} ${formData.phone}`,
            email: formData.email,
            businessName: formData.businessName,
            businessType: formData.businessType,
            country: formData.country,
            state: formData.state,
            city: formData.city,
          },
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to initialize demo voice call.");
      }

      const tokenData = await res.json();
      const { token, url, room: roomName } = tokenData;
      setActiveRoomName(roomName || null);

      if (!token || !url) {
        throw new Error("Invalid voice token received from service.");
      }

      // Connect to LiveKit Room
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
          void el.play().catch((err) => console.warn("Audio playback notice:", err));
          startAudioVisualizer(track);
        }
      });

      lkRoom.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        cleanupCall();
        const normal =
          reason === undefined ||
          [
            DisconnectReason.CLIENT_INITIATED,
            DisconnectReason.ROOM_DELETED,
            DisconnectReason.PARTICIPANT_REMOVED,
          ].includes(reason);
        setCallStatus(normal ? "ended" : "error");
        if (!normal) {
          setErrorMsg("The voice call was ended unexpectedly. Please try again.");
        }
      });

      await lkRoom.connect(url, token);
      await lkRoom.localParticipant.setMicrophoneEnabled(true);

      setCallStatus("connected");
      setIsMuted(false);
    } catch (err) {
      console.error("Call error:", err);
      cleanupCall();
      setCallStatus("error");
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Could not connect to microphone or voice service."
      );
    }
  };

  const handleEndCall = async () => {
    const currentRoom = activeRoomName;
    cleanupCall();
    setCallStatus("ended");

    if (currentRoom) {
      try {
        await fetch("/api/demo/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: currentRoom }),
        });
      } catch (err) {
        console.warn("End call release error:", err);
      }
      setActiveRoomName(null);
    }
  };

  const toggleMute = async () => {
    if (!roomRef.current) return;
    const nextMuted = !isMuted;
    try {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!nextMuted);
      setIsMuted(nextMuted);
    } catch (e) {
      console.warn("Mute error:", e);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-xl animate-fade-in overflow-y-auto">
      {/* Background glow effects */}
      <div className="fixed -top-40 -right-40 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed -bottom-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Container */}
      <div className="relative w-full max-w-4xl my-auto overflow-hidden rounded-3xl border border-[#2d3460] bg-[#0c0e1e]/95 text-white shadow-[0_0_80px_rgba(112,68,255,0.22)] transition-all">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between border-b border-[#21274a] px-6 py-4">
          <div className="flex items-center gap-3">
            {step !== "lead" && (
              <button
                type="button"
                onClick={() => {
                  if (step === "call") {
                    handleEndCall();
                  }
                  setStep("assistants");
                }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Back to Assistants"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#9eff00] animate-pulse" />
              <span className="text-xs font-mono font-semibold tracking-wider text-[#9eff00] uppercase">
                {step === "lead"
                  ? "Book A Demo • Step 1 of 2"
                  : step === "assistants"
                  ? "Select AI Assistant • Step 2 of 2"
                  : `Live Call: ${selectedAssistant?.name || "Assistant"}`}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              cleanupCall();
              if (activeRoomName) {
                fetch("/api/demo/end", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ room: activeRoomName }),
                }).catch(() => {});
              }
              onClose();
            }}
            className="rounded-full p-2 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── STEP 1: LEAD FORM (Image 1 Style) ─────────────────────────────────── */}
        {step === "lead" && (
          <div className="p-6 sm:p-10 max-w-xl mx-auto">
            {/* Top Phone Icon Icon */}
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 shadow-[0_0_30px_rgba(124,58,237,0.5)]">
              <PhoneCall className="w-7 h-7 text-white" />
            </div>

            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                Start Your AI Agent Call
              </h2>
              <p className="text-sm text-gray-400 mt-2">
                Fill in your details and our Jill-Jill AI voice agent will connect with you instantly.
              </p>
            </div>

            {formError && (
              <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-center text-xs text-red-400">
                {formError}
              </div>
            )}

            <form onSubmit={handleLeadSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  FULL NAME *
                </label>
                <input
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="John Doe"
                  className="w-full rounded-xl border border-[#2d3563] bg-[#161a34] px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  PHONE NUMBER *
                </label>
                <div className="flex gap-2">
                  <select
                    value={formData.countryCode}
                    onChange={(e) => setFormData({ ...formData, countryCode: e.target.value })}
                    className="w-28 rounded-xl border border-[#2d3563] bg-[#161a34] px-3 py-3 text-sm text-white focus:border-purple-500 focus:outline-none transition-all"
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
                    className="flex-1 rounded-xl border border-[#2d3563] bg-[#161a34] px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  EMAIL ADDRESS *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@company.com"
                  className="w-full rounded-xl border border-[#2d3563] bg-[#161a34] px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  BUSINESS NAME *
                </label>
                <input
                  type="text"
                  required
                  value={formData.businessName}
                  onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                  placeholder="Acme Corp"
                  className="w-full rounded-xl border border-[#2d3563] bg-[#161a34] px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                    BUSINESS TYPE *
                  </label>
                  <select
                    value={formData.businessType}
                    onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                    className="w-full rounded-xl border border-[#2d3563] bg-[#161a34] px-4 py-3 text-sm text-white focus:border-purple-500 focus:outline-none transition-all"
                  >
                    <option value="Select type">Select type</option>
                    <option value="Healthcare & Clinics">Healthcare & Clinics</option>
                    <option value="Education & Academy">Education & Academy</option>
                    <option value="Real Estate">Real Estate</option>
                    <option value="E-Commerce">E-Commerce</option>
                    <option value="Financial Services">Financial Services</option>
                    <option value="Customer Support / IVR">Customer Support / IVR</option>
                    <option value="IT & SaaS">IT & SaaS</option>
                    <option value="Hospitality">Hospitality</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                    COUNTRY *
                  </label>
                  <select
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="w-full rounded-xl border border-[#2d3563] bg-[#161a34] px-4 py-3 text-sm text-white focus:border-purple-500 focus:outline-none transition-all"
                  >
                    <option value="IN India">IN India</option>
                    <option value="US United States">US United States</option>
                    <option value="AE United Arab Emirates">AE United Arab Emirates</option>
                    <option value="GB United Kingdom">GB United Kingdom</option>
                    <option value="SG Singapore">SG Singapore</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                    STATE *
                  </label>
                  <select
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    className="w-full rounded-xl border border-[#2d3563] bg-[#161a34] px-4 py-3 text-sm text-white focus:border-purple-500 focus:outline-none transition-all"
                  >
                    <option value="Tamil Nadu">Tamil Nadu</option>
                    <option value="Karnataka">Karnataka</option>
                    <option value="Maharashtra">Maharashtra</option>
                    <option value="Delhi">Delhi</option>
                    <option value="Kerala">Kerala</option>
                    <option value="Telangana">Telangana</option>
                    <option value="Andhra Pradesh">Andhra Pradesh</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                    CITY *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    placeholder="Chennai"
                    className="w-full rounded-xl border border-[#2d3563] bg-[#161a34] px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  DESCRIPTION (OPTIONAL)
                </label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Tell us what you want your AI voice agent to handle..."
                  className="w-full rounded-xl border border-[#2d3563] bg-[#161a34] px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                />
              </div>

              <div className="pt-3">
                <button
                  type="submit"
                  disabled={isSubmittingLead}
                  className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#6366f1] via-[#7c3aed] to-[#8b5cf6] py-3.5 px-6 font-semibold text-white shadow-[0_0_30px_rgba(124,58,237,0.4)] hover:shadow-[0_0_40px_rgba(124,58,237,0.6)] hover:scale-[1.01] transition-all disabled:opacity-60 cursor-pointer"
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

        {/* ── STEP 2: ASSISTANT SELECTION (Image 2 Style) ───────────────────────── */}
        {step === "assistants" && (
          <div className="p-6 sm:p-8 max-h-[80vh] overflow-y-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                Choose Your Voice Assistant
              </h2>
              <p className="text-sm text-gray-400 mt-2 max-w-lg mx-auto">
                Select an assistant station below to test live real-time voice calls powered by{" "}
                <span className="text-[#a78bfa] font-semibold">Gemini 3.1 Flash Live</span>.
              </p>
            </div>

            <div className={styles.stage}>
              {assistants.map((assistant) => {
                const Icon = roleIcons[assistant.role] || Users;
                return (
                  <article key={assistant.id} className={styles.station}>
                    <button
                      type="button"
                      onClick={() => handleStartCall(assistant)}
                      className={styles.orb}
                      aria-label={`Select ${assistant.name}`}
                    >
                      <Icon size={36} strokeWidth={1.6} aria-hidden="true" />
                      <h2>{assistant.name}</h2>
                      <span className={styles.status}>
                        <i data-active="true" />
                        Active
                      </span>
                    </button>
                    <span className={styles.plinth} aria-hidden="true" />
                    <span className={styles.voice}>{assistant.voice}</span>
                    <button
                      type="button"
                      onClick={() => handleStartCall(assistant)}
                      className={styles.listen}
                    >
                      Try Demo
                    </button>
                    {assistant.role === "ivr" && (
                      <button
                        type="button"
                        onClick={() => handleStartCall(assistant)}
                        className="mt-2 text-xs text-[#a78bfa] underline underline-offset-4 hover:text-white"
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

        {/* ── STEP 3: LIVE WEBRTC CALL ────────────────────────────────────────── */}
        {step === "call" && selectedAssistant && (
          <div className="p-6 sm:p-12 text-center">
            {/* Pulsating Voice Orb / Avatar */}
            <div className="relative mx-auto my-6 flex h-40 w-40 items-center justify-center">
              {/* Outer pulsing ripples */}
              <div
                className="absolute inset-0 rounded-full bg-gradient-to-tr from-purple-500/30 to-[#9eff00]/30 blur-xl transition-all duration-300"
                style={{
                  transform: `scale(${1 + (audioLevel / 100) * 0.8})`,
                  opacity: callStatus === "connected" ? 0.7 : 0.2,
                }}
              />
              {/* Orb sphere */}
              <div
                className={`relative flex h-32 w-32 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                  agentSpeaking
                    ? "border-[#9eff00] shadow-[0_0_50px_rgba(158,255,0,0.5)] bg-gradient-to-br from-[#4c2889] to-[#1e133d]"
                    : "border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.3)] bg-gradient-to-br from-[#2a1c4b] to-[#120d24]"
                }`}
                style={{
                  transform: agentSpeaking ? "scale(1.05)" : "scale(1)",
                }}
              >
                {(() => {
                  const RoleIcon = roleIcons[selectedAssistant.role] || Users;
                  return (
                    <RoleIcon
                      className={`w-14 h-14 transition-colors duration-300 ${
                        agentSpeaking ? "text-[#9eff00]" : "text-purple-300"
                      }`}
                    />
                  );
                })()}
              </div>
            </div>

            {/* Title & Status */}
            <h3 className="text-2xl font-bold text-white mb-1">
              {selectedAssistant.name}
            </h3>
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400 mb-4">
              <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Voice: {selectedAssistant.voice}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-[#9eff00]/10 text-[#9eff00] border border-[#9eff00]/30 font-medium">
                Gemini 3.1 Flash Live
              </span>
            </div>

            {/* Live Call Duration & Status */}
            {callStatus === "connecting" && (
              <div className="flex items-center justify-center gap-2 text-sm text-yellow-400 mb-6">
                <LoaderCircle className="w-4 h-4 animate-spin" />
                <span>Connecting live audio session...</span>
              </div>
            )}

            {callStatus === "connected" && (
              <div className="mb-6 space-y-1">
                <div className="text-3xl font-mono font-bold text-white tracking-widest">
                  {formatTimer(callDuration)}
                </div>
                <p className="text-xs text-gray-400">
                  {agentSpeaking ? (
                    <span className="text-[#9eff00] font-semibold animate-pulse">
                      ● Agent is speaking...
                    </span>
                  ) : (
                    <span className="text-gray-400">Listening to your microphone...</span>
                  )}
                </p>
              </div>
            )}

            {callStatus === "ended" && (
              <div className="mb-6">
                <p className="text-sm font-semibold text-gray-300">Call Completed</p>
                <p className="text-xs text-gray-500">Duration: {formatTimer(callDuration)}</p>
              </div>
            )}

            {callStatus === "error" && (
              <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/30 p-3 max-w-md mx-auto text-xs text-red-400">
                {errorMsg || "Connection failed. Please ensure microphone permissions are granted."}
              </div>
            )}

            {/* Audio Wave Visualizer Bars */}
            {callStatus === "connected" && (
              <div className="flex items-center justify-center gap-1.5 h-8 mb-8">
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

            {/* Action Buttons */}
            <div className="flex items-center justify-center gap-4">
              {callStatus === "connected" && (
                <button
                  type="button"
                  onClick={toggleMute}
                  className={`flex items-center gap-2 px-5 py-3 rounded-2xl border font-semibold text-sm transition-all ${
                    isMuted
                      ? "bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30"
                      : "bg-white/10 border-white/20 text-white hover:bg-white/20"
                  }`}
                >
                  {isMuted ? <MicOff className="w-5 h-5 text-red-400" /> : <Mic className="w-5 h-5" />}
                  <span>{isMuted ? "Unmute" : "Mute"}</span>
                </button>
              )}

              {callStatus === "connected" || callStatus === "connecting" ? (
                <button
                  type="button"
                  onClick={handleEndCall}
                  className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm shadow-[0_0_20px_rgba(220,38,38,0.4)] transition-all cursor-pointer"
                >
                  <PhoneOff className="w-5 h-5" />
                  <span>End Call</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep("assistants")}
                  className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold text-sm shadow-[0_0_20px_rgba(124,58,237,0.4)] hover:shadow-[0_0_30px_rgba(124,58,237,0.6)] transition-all cursor-pointer"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>Try Another Assistant</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
