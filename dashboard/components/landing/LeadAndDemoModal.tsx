"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
  DisconnectReason,
  AudioPresets,
  createLocalAudioTrack,
  type LocalAudioTrack,
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
  ShieldAlert,
  Clock,
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

interface TurnSegment {
  id: string;
  text: string;
  final: boolean;
}

interface TranscriptEntry {
  id: string;
  speaker: "user" | "agent";
  text: string;
  final: boolean;
  segments: TurnSegment[];
  updatedAt: number;
}

const WAVE_BARS = 24;
const MAX_DEMO_SESSIONS = 5;
const MAX_CALL_SECONDS = 240; // Strict 4-minute maximum per demo call

// Foreign scripts + accented European characters + Spanish/Portuguese/French STT hallucinations
const FOREIGN_HALLUCINATION_RE =
  /[¿¡áéíóúñüçãõêâôàèìòùÁÉÍÓÚÑÜÇÃÕÊÂÔÀÈÌÒÙ\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3040-\u30FF\u4E00-\u9FFF]/;

const SPANISH_ROMANCE_WORDS_RE =
  /\b(?:amiga|amigo|puse|donde|viv[eo]s|hola|gracias|por\s+favor|usted|ustedes|pero|para|tiene|tengo|como\s+estas|buenos\s+dias|buenas\s+noches|que\s+tal|hermano|señor|senor)\b/i;

export function sanitizeLiveTranscript(raw: string, speaker: "user" | "agent"): string {
  if (!raw) return "";

  let text = raw
    .split(/\[APPLICATION CALL MEMORY/i)[0]
    .split(/\[VERIFIED BUSINESS KNOWLEDGE/i)[0]
    .split(/\[BUSINESS DATA/i)[0]
    .split(/\[PHONE LISTENING/i)[0]
    .split(/\[NATIVE VOICE\]/i)[0]
    .split(/\[NATIVE AUDIO TRANSPORT\]/i)[0]
    .split(/BOOKING_NOT_CONFIRMED:/i)[0]
    .split(/TRANSFER_FAILED:/i)[0];

  text = text.replace(
    /\{\s*"(?:caller_evidence|direction|language|pending_question|phase|role|tone|entities|tool_state|spoken_details|active_work|booking_action_status)"[\s\S]*$/gi,
    ""
  );
  text = text.replace(
    /\{[^{}]*"(?:caller_evidence|pending_question|booking_action_status|tool_state)"[^{}]*\}/gi,
    ""
  );
  text = text.replace(/\[[A-Z_;\s=0-9,-]+\]/g, "");
  text = text.replace(/<\|[^|>]+\|>/g, "");

  if (FOREIGN_HALLUCINATION_RE.test(text) || SPANISH_ROMANCE_WORDS_RE.test(text)) {
    return "";
  }

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

/** Encode mono Float32 PCM samples into a 16kHz 16-bit WAV base64 string (works in all browsers incl. iOS Safari). */
function encodeWav16kBase64(chunks: Float32Array[], inputSampleRate: number): string {
  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  if (totalLen === 0) return "";

  const merged = new Float32Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  const targetRate = 16000;
  const ratio = inputSampleRate / targetRate;
  const outLength = Math.max(1, Math.floor(merged.length / ratio));
  const pcm16 = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcIdx = Math.min(merged.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, merged[srcIdx]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const byteLen = pcm16.length * 2;
  const buffer = new ArrayBuffer(44 + byteLen);
  const view = new DataView(buffer);

  const writeAscii = (pos: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + byteLen, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, byteLen, true);

  const outBytes = new Uint8Array(buffer);
  outBytes.set(new Uint8Array(pcm16.buffer), 44);

  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < outBytes.length; i += step) {
    binary += String.fromCharCode(...outBytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function normalizeForDedup(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s.,!?…\-–—:;'"()]+/g, " ")
    .trim();
}

function isNearDuplicate(normA: string, normB: string): boolean {
  if (!normA || !normB) return false;
  if (normA === normB || normA.includes(normB) || normB.includes(normA)) return true;
  const wordsA = normA.split(" ");
  const wordsB = normB.split(" ");
  if (wordsA.length >= 3 && wordsB.length >= 3) {
    const setA = new Set(wordsA);
    let shared = 0;
    for (const w of wordsB) {
      if (setA.has(w)) shared++;
    }
    const overlap = shared / Math.min(wordsA.length, wordsB.length);
    if (overlap >= 0.8) return true;
  }
  return false;
}

function joinWithoutWordOverlap(a: string, b: string): string {
  const cleanA = a.trim();
  const cleanB = b.trim();
  if (!cleanA) return cleanB;
  if (!cleanB) return cleanA;

  const normA = normalizeForDedup(cleanA);
  const normB = normalizeForDedup(cleanB);
  if (!normA) return cleanB;
  if (!normB) return cleanA;

  if (normA === normB || normA.includes(normB)) return cleanA;
  if (normB.includes(normA)) return cleanB;

  const wordsA = cleanA.split(/\s+/);
  const wordsB = cleanB.split(/\s+/);
  const maxOverlap = Math.min(wordsA.length, wordsB.length, 6);
  for (let k = maxOverlap; k >= 2; k--) {
    const tailA = normalizeForDedup(wordsA.slice(-k).join(" "));
    const headB = normalizeForDedup(wordsB.slice(0, k).join(" "));
    if (tailA && tailA === headB) {
      return `${cleanA} ${wordsB.slice(k).join(" ")}`.replace(/\s+/g, " ").trim();
    }
  }
  return `${cleanA} ${cleanB}`.replace(/\s+/g, " ").trim();
}

function composeTurnText(segments: TurnSegment[]): string {
  let acc = "";
  for (const seg of segments) {
    acc = joinWithoutWordOverlap(acc, seg.text);
  }
  return acc;
}

const DEFAULT_ASSISTANTS: AssistantItem[] = [
  {
    id: "caaad76e39781563d9ee13de0",
    name: "Academy Assistant",
    description: "Handles admissions enquiries, course details, fee structures, and demo class bookings.",
    role: "academy",
    active: true,
  },
  {
    id: "cmuv65lxx0013v7f4thzf2qtv",
    name: "Appointment Booker",
    description: "Checks real-time slot availability, qualifies caller needs, and schedules confirmed appointments.",
    role: "appointment",
    active: true,
  },
  {
    id: "ccc6c12cc5f975d64b659ec72",
    name: "Clinic Assistant",
    description: "Assists patients with doctor consultations, clinic timings, and medical appointment bookings.",
    role: "clinic",
    active: true,
  },
  {
    id: "cmuv6w9d70017v7f4j8kth708",
    name: "Customer Support",
    description: "Resolves service queries, order status checks, and escalations 24/7 with warm empathy.",
    role: "support",
    active: true,
  },
  {
    id: "c40c4a0181bf251ca929f0706",
    name: "IVR Assistant",
    description: "Conversational smart routing across departments without frustrating keypad menus.",
    role: "ivr",
    active: true,
  },
  {
    id: "cmuv75n1j0019v7f434t6xj6q",
    name: "Marketing Outreach",
    description: "Engages campaign leads, shares tailored offers, and captures interested callbacks.",
    role: "marketing",
    active: true,
  },
  {
    id: "cmuv6fea90015v7f4fexyfx8g",
    name: "Outbound Sales",
    description: "Qualifies prospects, answers product questions, and books high-intent discovery meetings.",
    role: "sales",
    active: true,
  },
  {
    id: "cmuv4xd8i0011v7f4fgsgfr5x",
    name: "Receptionist",
    description: "Greets every caller professionally, captures messages, and routes urgent calls instantly.",
    role: "receptionist",
    active: true,
  },
  {
    id: "cmvxs7rk10001v7e8kcdra9ez",
    name: "Hospital Assistant",
    description: "Guides patients across specialty departments, eye & health checkups, and OPD scheduling.",
    role: "vasan",
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
    description: "",
  });
  const [formError, setFormError] = useState("");
  const [isLimitBlocked, setIsLimitBlocked] = useState(false);
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);

  const [usedSessions, setUsedSessions] = useState(0);
  const [maxSessions, setMaxSessions] = useState(MAX_DEMO_SESSIONS);
  const [maxCallSeconds, setMaxCallSeconds] = useState(MAX_CALL_SECONDS);

  const [callStatus, setCallStatus] = useState<"idle" | "connecting" | "connected" | "ended" | "error">("idle");
  const [endedNotice, setEndedNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);

  const activeRoomRef = useRef<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<Set<HTMLAudioElement>>(new Set());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const maxCutoffRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const captionProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const captionCloneTrackRef = useRef<MediaStreamTrack | null>(null);
  const agentSpeakingRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const agentSpeechEndTsRef = useRef(0);
  const orbHaloRef = useRef<HTMLDivElement | null>(null);
  const orbCoreRef = useRef<HTMLDivElement | null>(null);
  const waveBarRefs = useRef<(HTMLDivElement | null)[]>([]);
  const userCapSeqRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [transcripts]);

  // Guaranteed Single-Bubble-Per-Turn Transcript Engine
  const upsertTranscript = useCallback(
    (segId: string, speaker: "user" | "agent", rawText: string, isFinal: boolean) => {
      const cleaned = sanitizeLiveTranscript(rawText, speaker);
      if (!cleaned) return;
      const normNew = normalizeForDedup(cleaned);
      if (!normNew) return;
      const now = Date.now();

      setTranscripts((prev) => {
        const existingTurnIdx = prev.findIndex((turn) =>
          turn.segments.some((s) => s.id === segId)
        );
        if (existingTurnIdx !== -1) {
          const updated = [...prev];
          const turn = updated[existingTurnIdx];
          const nextSegs = turn.segments.map((s) =>
            s.id === segId ? { id: segId, text: cleaned, final: isFinal || s.final } : s
          );
          updated[existingTurnIdx] = {
            ...turn,
            segments: nextSegs,
            text: composeTurnText(nextSegs),
            final: nextSegs.every((s) => s.final),
            updatedAt: now,
          };
          return updated;
        }

        const lastIdx = prev.length - 1;
        const last = lastIdx >= 0 ? prev[lastIdx] : null;
        if (last && last.speaker === speaker) {
          const nextSegs = [...last.segments];
          let mergedIntoExisting = false;

          for (let i = nextSegs.length - 1; i >= 0; i--) {
            const existing = nextSegs[i];
            const normOld = normalizeForDedup(existing.text);

            if (!existing.final || isNearDuplicate(normOld, normNew)) {
              const fullerText =
                !existing.final || cleaned.length >= existing.text.length
                  ? cleaned
                  : existing.text;
              nextSegs[i] = {
                id: segId,
                text: fullerText,
                final: isFinal || existing.final,
              };
              mergedIntoExisting = true;
              break;
            }
          }

          if (!mergedIntoExisting) {
            nextSegs.push({ id: segId, text: cleaned, final: isFinal });
          }

          const updated = [...prev];
          updated[lastIdx] = {
            ...last,
            segments: nextSegs,
            text: composeTurnText(nextSegs),
            final: nextSegs.every((s) => s.final),
            updatedAt: now,
          };
          return updated;
        }

        for (let i = prev.length - 1; i >= Math.max(0, prev.length - 4); i--) {
          const candidate = prev[i];
          if (candidate.speaker === speaker && now - candidate.updatedAt < 12000) {
            const normCandidate = normalizeForDedup(candidate.text);
            if (isNearDuplicate(normCandidate, normNew)) {
              const updated = [...prev];
              updated[i] = {
                ...candidate,
                text: cleaned.length > candidate.text.length ? cleaned : candidate.text,
                final: isFinal || candidate.final,
                updatedAt: now,
              };
              return updated;
            }
          }
        }

        const initialSegs: TurnSegment[] = [{ id: segId, text: cleaned, final: isFinal }];
        return [
          ...prev,
          {
            id: segId,
            speaker,
            text: cleaned,
            final: isFinal,
            segments: initialSegs,
            updatedAt: now,
          },
        ];
      });
    },
    []
  );

  const cleanupCall = useCallback((closeAudioCtx = true) => {
    if (maxCutoffRef.current) {
      clearTimeout(maxCutoffRef.current);
      maxCutoffRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (captionProcessorRef.current) {
      try {
        captionProcessorRef.current.disconnect();
      } catch {
        // ignore
      }
      captionProcessorRef.current = null;
    }
    if (captionCloneTrackRef.current) {
      try {
        captionCloneTrackRef.current.stop();
      } catch {
        // ignore
      }
      captionCloneTrackRef.current = null;
    }
    if (closeAudioCtx && audioContextRef.current && audioContextRef.current.state !== "closed") {
      try {
        void audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }
    if (roomRef.current) {
      try {
        roomRef.current.removeAllListeners();
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
    agentSpeakingRef.current = false;
    userSpeakingRef.current = false;
    setAgentSpeaking(false);
    setUserSpeaking(false);
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
        if (typeof data?.maxSessions === "number") setMaxSessions(data.maxSessions);
        if (typeof data?.maxCallSeconds === "number") setMaxCallSeconds(data.maxCallSeconds);
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      cleanupCall(true);
      void releaseActiveRoom();
      setCallStatus("idle");
      setCallDuration(0);
      setErrorMsg("");
      setEndedNotice("");
      setFormError("");
      setIsLimitBlocked(false);
      return;
    }
    setStep("lead");
    setFormError("");
    setIsLimitBlocked(false);
  }, [isOpen, cleanupCall, releaseActiveRoom]);

  // Strict 4-Minute (240s) Call Timer & Automatic Hard Cutoff
  useEffect(() => {
    if (callStatus !== "connected") return;

    setCallDuration(0);
    setEndedNotice("");

    const hardLimitMs = maxCallSeconds * 1000;

    maxCutoffRef.current = setTimeout(() => {
      cleanupCall(true);
      void releaseActiveRoom();
      setCallDuration(maxCallSeconds);
      setEndedNotice("4-minute demo call limit reached — call ended automatically.");
      setCallStatus("ended");
    }, hardLimitMs);

    timerRef.current = setInterval(() => {
      setCallDuration((prev) => {
        const next = prev + 1;
        if (next >= maxCallSeconds) {
          cleanupCall(true);
          void releaseActiveRoom();
          setEndedNotice("4-minute demo call limit reached — call ended automatically.");
          setCallStatus("ended");
          return maxCallSeconds;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (maxCutoffRef.current) clearTimeout(maxCutoffRef.current);
    };
  }, [callStatus, maxCallSeconds, cleanupCall, releaseActiveRoom]);

  // Attach parallel Sarvam Indic+English caller captioner on a cloned track, gated against speaker echo
  const attachCallerIndicCaptioner = useCallback(
    (ctx: AudioContext, micMst: MediaStreamTrack, lkRoom: Room) => {
      try {
        if (captionProcessorRef.current) {
          captionProcessorRef.current.disconnect();
          captionProcessorRef.current = null;
        }
        if (captionCloneTrackRef.current) {
          captionCloneTrackRef.current.stop();
          captionCloneTrackRef.current = null;
        }
        const clonedMst = micMst.clone();
        captionCloneTrackRef.current = clonedMst;
        const source = ctx.createMediaStreamSource(new MediaStream([clonedMst]));
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;

        let speaking = false;
        let speechChunks: Float32Array[] = [];
        let preRoll: Float32Array[] = [];
        let silenceMs = 0;
        let utteranceMs = 0;

        const flushUtterance = (chunksToSend: Float32Array[]) => {
          // Defer HTTP upload 320ms so WebRTC turn-end RTP packets get 100% priority on mobile 4G/5G
          setTimeout(() => {
            if (!roomRef.current) return;
            const wavB64 = encodeWav16kBase64(chunksToSend, ctx.sampleRate || 48000);
            if (!wavB64) return;
            const capId = `sarvam-user-${++userCapSeqRef.current}`;
            fetch("/api/demo/caption", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audioWavB64: wavB64 }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((j) => {
                if (j?.text && typeof j.text === "string" && j.text.trim()) {
                  upsertTranscript(capId, "user", j.text.trim(), true);
                }
              })
              .catch(() => {});
          }, 320);
        };

        processor.onaudioprocess = (ev) => {
          if (!roomRef.current) return;
          const micPub = lkRoom.localParticipant?.getTrackPublication(Track.Source.Microphone);
          // Block mobile speakerphone echo when AI agent is speaking (plus 280ms acoustic tail cooldown)
          if (
            micPub?.isMuted ||
            agentSpeakingRef.current ||
            Date.now() - agentSpeechEndTsRef.current < 280
          ) {
            if (speaking && utteranceMs >= 420) {
              const batch = speechChunks;
              speechChunks = [];
              speaking = false;
              silenceMs = 0;
              utteranceMs = 0;
              flushUtterance(batch);
            } else {
              speaking = false;
              speechChunks = [];
              silenceMs = 0;
              utteranceMs = 0;
            }
            return;
          }

          const input = ev.inputBuffer.getChannelData(0);
          let sumSq = 0;
          for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i];
          const rms = Math.sqrt(sumSq / input.length);
          const frameMs = (input.length / (ctx.sampleRate || 48000)) * 1000;
          const copy = new Float32Array(input);

          if (rms > 0.018) {
            if (!speaking) {
              speaking = true;
              speechChunks = [...preRoll];
              utteranceMs = 0;
            }
            silenceMs = 0;
            speechChunks.push(copy);
            utteranceMs += frameMs;
            if (utteranceMs >= 7500) {
              const batch = speechChunks;
              speechChunks = [];
              utteranceMs = 0;
              speaking = false;
              flushUtterance(batch);
            }
          } else if (speaking) {
            speechChunks.push(copy);
            silenceMs += frameMs;
            utteranceMs += frameMs;
            if (silenceMs >= 440) {
              const batch = speechChunks;
              speechChunks = [];
              speaking = false;
              silenceMs = 0;
              if (utteranceMs >= 320) {
                flushUtterance(batch);
              }
              utteranceMs = 0;
            }
          } else {
            preRoll.push(copy);
            if (preRoll.length > 4) preRoll.shift();
          }
        };

        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(ctx.destination);
        captionProcessorRef.current = processor;
      } catch {
        // ignore if unsupported
      }
    },
    [upsertTranscript]
  );

  const startDualAudioWobble = useCallback(
    (lkRoom: Room) => {
      try {
        let ctx = audioContextRef.current;
        if (!ctx || ctx.state === "closed") {
          const AudioContextClass =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          ctx = new AudioContextClass({ latencyHint: "interactive" });
          audioContextRef.current = ctx;
        }
        if (ctx.state === "suspended") {
          void ctx.resume().catch(() => {});
        }

        let micAnalyser: AnalyserNode | null = null;
        let agentAnalyser: AnalyserNode | null = null;
        let micTrackId = "";
        let agentTrackId = "";
        const agentFreq = new Uint8Array(128);
        const micFreq = new Uint8Array(128);
        let lastTs = 0;

        const tick = (ts: number) => {
          if (!roomRef.current || !ctx || ctx.state === "closed") return;
          animFrameRef.current = requestAnimationFrame(tick);
          if (ts - lastTs < 45) return;
          lastTs = ts;

          const micPub = lkRoom.localParticipant?.getTrackPublication(Track.Source.Microphone);
          const micMst = micPub?.track?.mediaStreamTrack ?? null;
          if (micMst && micMst.id !== micTrackId) {
            micTrackId = micMst.id;
            try {
              micAnalyser = makeAnalyser(ctx, micMst.clone());
              attachCallerIndicCaptioner(ctx, micMst, lkRoom);
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

          const isAgentActive = aAvg > 9;
          const isUserActive = !isAgentActive && uAvg > 14;

          if (agentSpeakingRef.current && !isAgentActive) {
            agentSpeechEndTsRef.current = Date.now();
          }
          if (agentSpeakingRef.current !== isAgentActive) {
            agentSpeakingRef.current = isAgentActive;
            setAgentSpeaking(isAgentActive);
          }
          if (userSpeakingRef.current !== isUserActive) {
            userSpeakingRef.current = isUserActive;
            setUserSpeaking(isUserActive);
          }

          // Zero-React-Re-render Direct DOM Equalizer & Sphere Wobble (ultra-light on Mobile CPU!)
          const combinedEnergy = Math.max(aAvg, uAvg);
          if (orbHaloRef.current) {
            orbHaloRef.current.style.transform = `scale(${(1 + (combinedEnergy / 100) * 0.75).toFixed(3)})`;
          }
          if (orbCoreRef.current) {
            orbCoreRef.current.style.transform = `scale(${(1 + (combinedEnergy / 220) * 0.2).toFixed(3)})`;
          }

          const activeFreq = aAvg >= uAvg ? agentFreq : micFreq;
          const hasSignal = isAgentActive || isUserActive;
          const half = WAVE_BARS / 2;
          const barColor = isAgentActive
            ? "#2dd4bf"
            : isUserActive
            ? "#fbbf24"
            : "rgba(45, 212, 191, 0.35)";
          for (let i = 0; i < WAVE_BARS; i++) {
            const barEl = waveBarRefs.current[i];
            if (!barEl) continue;
            const distFromCenter = Math.abs(i - (half - 0.5)) / half;
            const envelope = Math.cos(distFromCenter * (Math.PI / 2));
            const binIdx = Math.min(activeFreq.length - 1, Math.floor(distFromCenter * 48));
            const raw = activeFreq[binIdx] / 255;
            const idleRipple = 0.08 + 0.04 * Math.sin(ts / 240 + i * 0.55);
            const val = hasSignal
              ? Math.max(0.1, Math.min(1, raw * envelope * 1.45 + 0.08))
              : idleRipple;
            barEl.style.height = `${Math.max(5, Math.round(val * 36))}px`;
            barEl.style.backgroundColor = barColor;
          }
        };

        animFrameRef.current = requestAnimationFrame(tick);
      } catch {
        // ignore
      }
    },
    [attachCallerIndicCaptioner]
  );

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
    const cleanEmail = formData.email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (!formData.businessName.trim()) {
      setFormError("Please enter your business or organization name.");
      return;
    }
    if (!formData.businessType) {
      setFormError("Please select your business industry.");
      return;
    }

    setFormError("");
    setIsLimitBlocked(false);
    setIsSubmittingLead(true);

    try {
      const res = await fetch("/api/demo/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: {
            fullName: formData.fullName.trim(),
            phone: `+91 ${digitsOnly}`,
            email: cleanEmail,
            businessName: formData.businessName.trim(),
            businessType: formData.businessType,
            country: "India",
            description: formData.description.trim() || undefined,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 403 || data?.limitReached) {
          setIsLimitBlocked(true);
          setUsedSessions(data?.maxSessions || MAX_DEMO_SESSIONS);
        }
        setFormError(
          data?.error || "Maximum 5 demo sessions reached for this email or phone number."
        );
        return;
      }

      if (typeof data?.usedSessions === "number") setUsedSessions(data.usedSessions);
      if (typeof data?.maxSessions === "number") setMaxSessions(data.maxSessions);
      if (typeof data?.maxCallSeconds === "number") setMaxCallSeconds(data.maxCallSeconds);

      setStep("assistants");
    } catch {
      setFormError("Unable to verify demo access right now. Please try again.");
    } finally {
      setIsSubmittingLead(false);
    }
  };

  // Clicking an assistant opens its Full-Page Studio first; inside, the user taps "Start Live Voice Call"
  const handleSelectAssistantStudio = (assistant: AssistantItem) => {
    cleanupCall(true);
    setSelectedAssistant(assistant);
    setTranscripts([]);
    setCallStatus("idle");
    setCallDuration(0);
    setErrorMsg("");
    setEndedNotice("");
    setStep("call");
  };

  const handleStartCall = async (assistant: AssistantItem) => {
    cleanupCall(false);
    // Request hardware-AEC microphone immediately inside user tap gesture (critical for iPhone Safari & Android!)
    const preMicPromise: Promise<LocalAudioTrack | null> = createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      voiceIsolation: true,
      channelCount: 1,
      sampleRate: 24000,
    }).catch(() => null);

    setSelectedAssistant(assistant);
    setStep("call");
    setTranscripts([]);
    setCallStatus("connecting");
    setErrorMsg("");
    setEndedNotice("");

    await releaseActiveRoom();

    try {
      const digitsOnly = formData.phone.replace(/\D/g, "");
      const payload = {
        assistantId: assistant.id,
        lead: {
          fullName: formData.fullName.trim(),
          phone: `+91 ${digitsOnly}`,
          email: formData.email.trim().toLowerCase(),
          businessName: formData.businessName.trim(),
          businessType: formData.businessType,
          country: "India",
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

      const tokenData = await res.json().catch(() => ({}));

      if (!res.ok) {
        const preTrack = await preMicPromise;
        preTrack?.stop();
        if (res.status === 403 || tokenData?.limitReached) {
          setUsedSessions(tokenData?.maxSessions || MAX_DEMO_SESSIONS);
        }
        throw new Error(tokenData.error || "Unable to connect voice session right now.");
      }

      if (typeof tokenData.usedSessions === "number") {
        setUsedSessions(tokenData.usedSessions);
      }
      if (typeof tokenData.maxCallSeconds === "number") {
        setMaxCallSeconds(tokenData.maxCallSeconds);
      }

      const { token, url, room: roomName } = tokenData;
      activeRoomRef.current = roomName || null;

      if (!token || !url) {
        const preTrack = await preMicPromise;
        preTrack?.stop();
        throw new Error("Voice session credentials could not be created.");
      }

      const lkRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: true,
          channelCount: 1,
          sampleRate: 24000,
        },
        publishDefaults: {
          audioPreset: AudioPresets.speech,
          dtx: true,
          red: true,
        },
      });
      roomRef.current = lkRoom;

      // Agent captions come from LiveKit TranscriptionReceived; Caller captions come from Sarvam Indic+English captioner!
      lkRoom.on(
        RoomEvent.TranscriptionReceived,
        (segments: TranscriptionSegment[], participant?: Participant) => {
          const isUser = participant?.identity === "demo-user";
          if (isUser) {
            return;
          }
          for (const seg of segments) {
            if (seg.text) {
              upsertTranscript(seg.id, "agent", seg.text, !!seg.final);
            }
          }
        }
      );

      lkRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.style.display = "none";
          el.autoplay = true;
          el.setAttribute("playsinline", "true");
          el.setAttribute("webkit-playsinline", "true");
          document.body.appendChild(el);
          audioElementsRef.current.add(el);
          void el.play().catch(() => {});
        }
      });

      lkRoom.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        cleanupCall(true);
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
          setErrorMsg("Call ended unexpectedly. Tap Start Call Again to reconnect.");
        }
      });

      const preMicTrack = await preMicPromise;
      await lkRoom.connect(url, token);
      await lkRoom.startAudio().catch(() => {});
      if (preMicTrack) {
        await lkRoom.localParticipant.publishTrack(preMicTrack, {
          source: Track.Source.Microphone,
          audioPreset: AudioPresets.speech,
          dtx: true,
          red: true,
        });
      } else {
        await lkRoom.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: true,
          channelCount: 1,
          sampleRate: 24000,
        });
      }

      setCallStatus("connected");
      setIsMuted(false);
      startDualAudioWobble(lkRoom);
    } catch (err) {
      const preTrack = await preMicPromise;
      preTrack?.stop();
      cleanupCall(true);
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
    cleanupCall(true);
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

  const isFullPageStudio = step === "call";
  const modalWidthClass =
    step === "assistants" ? "sm:max-w-[1160px]" : "sm:max-w-[580px]";

  const remainingSeconds = Math.max(0, maxCallSeconds - callDuration);
  const isNearCutoff = callStatus === "connected" && remainingSeconds <= 30;
  const remainingSessions = Math.max(0, maxSessions - usedSessions);

  return (
    <div
      className={`fixed inset-0 z-[80] flex ${
        isFullPageStudio
          ? "items-stretch justify-stretch p-0"
          : "items-end sm:items-center justify-center p-0 sm:p-4"
      } bg-slate-950/85 backdrop-blur-md`}
      style={{ WebkitBackdropFilter: "blur(12px)" }}
      role="dialog"
      aria-modal="true"
      onClick={async (e) => {
        if (e.target === e.currentTarget && step !== "call") {
          cleanupCall(true);
          await releaseActiveRoom();
          onClose();
        }
      }}
    >
      <div
        className={`relative w-full overflow-hidden transition-all duration-200 ${
          isFullPageStudio
            ? landingStyles.fullPageStudioSurface
            : `${modalWidthClass} rounded-t-3xl sm:rounded-2xl ${landingStyles.cyberModalSurface}`
        }`}
      >
        {!isFullPageStudio && (
          <div className="sm:hidden flex justify-center pt-2 pb-0.5 bg-[#0d1628]/95">
            <span className="h-1 w-10 rounded-full bg-slate-600/60" />
          </div>
        )}

        {/* Top Studio / Modal Bar */}
        <div className="flex items-center justify-between px-4 sm:px-7 py-3 sm:py-3.5 border-b border-teal-400/20 bg-[#0d1628]/95 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {step !== "lead" && (
              <button
                type="button"
                onClick={async () => {
                  if (step === "call") {
                    if (callStatus === "connected" || callStatus === "connecting") {
                      await handleEndCall();
                    }
                    setStep("assistants");
                  } else {
                    setStep("lead");
                  }
                }}
                className="min-h-[38px] px-2.5 flex items-center gap-1.5 rounded-xl text-slate-200 hover:text-teal-300 hover:bg-teal-400/10 active:scale-95 transition-all cursor-pointer touch-manipulation"
                title={step === "call" ? "Back to All Voice Agents" : "Edit Details"}
              >
                <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                {step === "call" && (
                  <span className="text-xs font-semibold hidden sm:inline">All Agents</span>
                )}
              </button>
            )}

            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2.5 w-2.5 rounded-full bg-teal-400 animate-pulse flex-shrink-0" />
              <span className="text-xs sm:text-sm font-bold tracking-wider uppercase text-teal-300 truncate">
                {step === "lead"
                  ? "Book Live Voice Demo"
                  : step === "assistants"
                  ? "Choose Industry Voice Agent"
                  : `${selectedAssistant?.name || "AI Voice Agent"} • Live Studio`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {step !== "lead" && usedSessions > 0 && (
              <span
                className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-teal-400/10 border border-teal-400/25 text-teal-200 ${landingStyles.tabularNums}`}
              >
                <span>
                  Session {Math.min(usedSessions, maxSessions)}/{maxSessions}
                </span>
                <span className="text-slate-400">•</span>
                <span>4 Min Max</span>
              </span>
            )}

            <button
              type="button"
              onClick={async () => {
                cleanupCall(true);
                await releaseActiveRoom();
                onClose();
              }}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full text-slate-300 hover:bg-teal-400/15 hover:text-teal-300 active:scale-95 transition-all cursor-pointer touch-manipulation"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={landingStyles.modalScrollArea}>
          {/* ── STEP 1: LEAD CAPTURE WITH 5-SESSION QUOTA CHECK ────────────────── */}
          {step === "lead" && (
            <div className="px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex items-start justify-between gap-3 mb-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400 text-teal-950 shadow-[0_6px_18px_rgba(20,184,166,0.28)] flex-shrink-0">
                    <PhoneCall className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white leading-tight">
                      Experience Live AI Voice Demo
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Up to {maxSessions} live demo sessions per email/phone •{" "}
                      {Math.floor(maxCallSeconds / 60)} min per call
                    </p>
                  </div>
                </div>
              </div>

              {formError && (
                <div
                  className={`mb-3.5 rounded-xl border px-3.5 py-2.5 text-xs sm:text-[13px] flex items-start gap-2.5 ${
                    isLimitBlocked
                      ? "bg-amber-500/15 border-amber-400/40 text-amber-200"
                      : "bg-rose-500/15 border-rose-400/40 text-rose-200"
                  }`}
                >
                  <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleLeadSubmit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="name"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      placeholder="Your full name"
                      className="w-full rounded-xl border border-slate-700/80 px-3 py-2.5 text-base sm:text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                      Mobile Number *
                    </label>
                    <div className="flex items-center rounded-xl border border-slate-700/80 bg-[#17253e] focus-within:border-teal-400 focus-within:ring-1 focus-within:ring-teal-400 overflow-hidden">
                      <span className="px-2.5 py-2.5 text-xs font-bold text-teal-300 border-r border-slate-700/80 select-none flex-shrink-0">
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
                        className="w-full px-3 py-2.5 text-base sm:text-sm focus:outline-none border-0"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="you@company.com"
                      className="w-full rounded-xl border border-slate-700/80 px-3 py-2.5 text-base sm:text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                      Business Name *
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="organization"
                      value={formData.businessName}
                      onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                      placeholder="Company / Clinic / Academy"
                      className="w-full rounded-xl border border-slate-700/80 px-3 py-2.5 text-base sm:text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                      Business Type *
                    </label>
                    <select
                      required
                      value={formData.businessType}
                      onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                      className="w-full rounded-xl border border-slate-700/80 px-3 py-2.5 text-base sm:text-sm focus:border-teal-400 focus:outline-none cursor-pointer"
                    >
                      <option value="">Select industry</option>
                      <option value="Healthcare & Clinic">Healthcare / Clinic</option>
                      <option value="Education & Academy">Education / Academy</option>
                      <option value="Real Estate">Real Estate</option>
                      <option value="E-Commerce & Retail">E-Commerce / Retail</option>
                      <option value="Banking & Finance">Banking / Finance</option>
                      <option value="Customer Support / IVR">Customer Support / IVR</option>
                      <option value="IT & SaaS">IT &amp; SaaS</option>
                      <option value="Hospitality & Travel">Hospitality &amp; Travel</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                      Description <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Optional use case..."
                      className="w-full rounded-xl border border-slate-700/80 px-3 py-2.5 text-base sm:text-sm focus:border-teal-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="pt-1.5">
                  <button
                    type="submit"
                    disabled={isSubmittingLead}
                    className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-teal-400 hover:bg-teal-300 active:scale-[0.99] py-3 px-5 font-extrabold text-sm uppercase tracking-wider text-teal-950 shadow-[0_8px_22px_rgba(20,184,166,0.28)] transition-all disabled:opacity-60 cursor-pointer touch-manipulation"
                  >
                    {isSubmittingLead ? (
                      <LoaderCircle className="w-5 h-5 animate-spin text-teal-950" />
                    ) : (
                      <>
                        <PhoneCall className="w-4 h-4 text-teal-950" />
                        <span>Continue to Live Voice Agents</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── STEP 2: 9 INDUSTRY VOICE AGENTS (Clean Orbs — No Unwanted Try Demo Button!) ─ */}
          {step === "assistants" && (
            <div className="px-4 sm:px-8 py-4 sm:py-7">
              <div className="text-center mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-3xl font-extrabold tracking-tight text-white">
                  Choose an AI Voice Agent
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                  Click any specialist below to open its full-screen live voice studio ({remainingSessions} of{" "}
                  {maxSessions} sessions remaining).
                </p>
              </div>

              {/* A) Apple iPhone & Android Phone Tactile Grid (<640px) */}
              <div className={landingStyles.mobileAgentGrid}>
                {assistants.map((assistant, idx) => {
                  const Icon = roleIcons[assistant.role] || Users;
                  const isHighlighted = preselectedRole === assistant.role;
                  const isLastOdd = assistants.length % 2 === 1 && idx === assistants.length - 1;
                  return (
                    <button
                      key={assistant.id}
                      type="button"
                      onClick={() => handleSelectAssistantStudio(assistant)}
                      className={`${landingStyles.mobileAgentCard} ${
                        isHighlighted ? landingStyles.mobileAgentCardHighlighted : ""
                      } ${isLastOdd ? "col-span-2" : ""}`}
                      aria-label={`Open ${assistant.name}`}
                    >
                      <span className={landingStyles.mobileAgentOrb}>
                        <Icon className="w-5 h-5 text-teal-300" strokeWidth={1.9} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-bold leading-tight text-white line-clamp-2">
                          {assistant.name}
                        </div>
                        <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal-300 whitespace-nowrap">
                          <span className="h-1.5 w-1.5 rounded-full bg-teal-400 flex-shrink-0" />
                          <span>Active</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* B) iPad / Tablet (3x3) & Laptop / Desktop (5x2) 3D Orbs — Click Orb to Open Studio */}
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
                        onClick={() => handleSelectAssistantStudio(assistant)}
                        className={landingStyles.orbButton}
                        aria-label={`Open ${assistant.name}`}
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
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── STEP 3: FULL-PAGE IMMERSIVE VOICE STUDIO (Desktop, Tablet, iPad & iPhone) ─ */}
          {step === "call" && selectedAssistant && (
            <div className="min-h-[calc(100dvh-60px)] w-full max-w-[1440px] mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
              {/* Left Column: Spacious Voice Stage + Waveform + Call Controls */}
              <div className="lg:col-span-5 flex flex-col items-center justify-between rounded-3xl border border-teal-400/20 bg-[#132038]/95 p-5 sm:p-8 text-center shadow-xl">
                <div className="w-full space-y-1.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-teal-400/12 border border-teal-400/25 text-teal-300">
                    <span
                      className={`h-2 w-2 rounded-full bg-teal-400 ${
                        callStatus === "connected" ? "animate-ping" : ""
                      }`}
                    />
                    {callStatus === "connected" ? "Live Voice Active" : "Interactive Voice Studio"}
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white pt-1">
                    {selectedAssistant.name}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
                    {selectedAssistant.description ||
                      "Speak naturally in English, Tamil, Tanglish, or Hindi — real-time voice response and live captions."}
                  </p>
                  {formData.fullName && (
                    <p className="text-xs text-slate-400 pt-1 truncate">
                      Caller: <strong className="text-slate-100">{formData.fullName}</strong>
                      {formData.businessName ? ` • ${formData.businessName}` : ""}
                    </p>
                  )}
                </div>

                {/* Large Wobbling Voice Sphere */}
                <div className="relative my-5 sm:my-8 flex h-32 w-32 sm:h-48 sm:w-48 items-center justify-center">
                  <div
                    ref={orbHaloRef}
                    className="absolute inset-0 rounded-full bg-teal-400/20 blur-2xl transition-transform duration-100 pointer-events-none"
                    style={{
                      transform: "scale(1)",
                      opacity: callStatus === "connected" ? 0.85 : 0.3,
                      willChange: "transform",
                    }}
                  />
                  <div
                    ref={orbCoreRef}
                    className={`relative flex h-28 w-28 sm:h-40 sm:w-40 items-center justify-center border-2 transition-colors duration-150 ${
                      agentSpeaking || userSpeaking ? landingStyles.wobbleActive : "rounded-full"
                    } ${
                      agentSpeaking
                        ? "border-teal-300 shadow-[0_0_38px_rgba(45,212,191,0.42)] bg-gradient-to-br from-[#1d3f52] to-[#112038]"
                        : userSpeaking
                        ? "border-amber-400 shadow-[0_0_34px_rgba(245,158,11,0.38)] bg-gradient-to-br from-[#3b3420] to-[#142238]"
                        : "border-teal-400/40 shadow-[0_0_24px_rgba(20,184,166,0.18)] bg-gradient-to-br from-[#1a2f4e] to-[#101d33]"
                    }`}
                    style={{
                      transform: "scale(1)",
                      willChange: "transform",
                    }}
                  >
                    {(() => {
                      const RoleIcon = roleIcons[selectedAssistant.role] || Users;
                      return (
                        <RoleIcon
                          className={`w-12 h-12 sm:w-16 sm:h-16 transition-colors duration-150 ${
                            agentSpeaking
                              ? "text-teal-300"
                              : userSpeaking
                              ? "text-amber-400"
                              : "text-teal-200"
                          }`}
                        />
                      );
                    })()}
                  </div>
                </div>

                {/* Controls & Live Equalizer */}
                <div className="w-full space-y-3.5">
                  {callStatus === "idle" && (
                    <p className="text-xs sm:text-sm text-slate-300">
                      Ready when you are — tap below to start your live conversation (up to 4 minutes).
                    </p>
                  )}

                  {callStatus === "connecting" && (
                    <div className="flex items-center justify-center gap-2 text-sm font-semibold text-amber-300 py-1">
                      <LoaderCircle className="w-4 h-4 animate-spin" />
                      <span>Connecting live voice channel...</span>
                    </div>
                  )}

                  {callStatus === "connected" && (
                    <>
                      <div className="flex items-center justify-center gap-1 h-9 sm:h-11 px-2">
                        {Array.from({ length: WAVE_BARS }).map((_, idx) => (
                          <div
                            key={idx}
                            ref={(el) => {
                              waveBarRefs.current[idx] = el;
                            }}
                            className="w-1.5 rounded-full transition-[height] duration-75"
                            style={{
                              height: "5px",
                              backgroundColor: "rgba(45, 212, 191, 0.35)",
                              willChange: "height",
                            }}
                          />
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-center gap-2.5">
                        <span
                          className={`inline-flex items-center gap-1.5 text-lg sm:text-2xl font-mono font-extrabold tracking-wider ${
                            isNearCutoff ? "text-amber-300" : "text-white"
                          } ${landingStyles.tabularNums}`}
                        >
                          <Clock className="w-4 h-4 sm:w-5 sm:h-5 opacity-80" />
                          <span>
                            {formatTimer(callDuration)} / {formatTimer(maxCallSeconds)}
                          </span>
                        </span>
                        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-white/5 border border-white/10">
                          {agentSpeaking ? (
                            <span className="text-teal-300">Agent Speaking</span>
                          ) : userSpeaking ? (
                            <span className="text-amber-300">You Are Speaking</span>
                          ) : isMuted ? (
                            <span className="text-rose-300">Mic Muted</span>
                          ) : (
                            <span className="text-slate-300">Listening...</span>
                          )}
                        </span>
                      </div>
                    </>
                  )}

                  {callStatus === "ended" && (
                    <div className="py-1 space-y-1">
                      <p className="text-sm font-bold text-white">
                        {endedNotice || "Session Completed"}
                      </p>
                      <p className={`text-xs text-slate-400 ${landingStyles.tabularNums}`}>
                        Duration: {formatTimer(callDuration)} (Max {formatTimer(maxCallSeconds)})
                      </p>
                    </div>
                  )}

                  {callStatus === "error" && (
                    <div className="rounded-xl bg-rose-500/15 border border-rose-400/40 p-3 text-xs sm:text-sm text-rose-200">
                      {errorMsg}
                    </div>
                  )}

                  {/* Primary Action Buttons */}
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                    {callStatus === "idle" && (
                      <button
                        type="button"
                        onClick={() => handleStartCall(selectedAssistant)}
                        className="w-full sm:w-auto min-h-[50px] flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-2xl bg-teal-400 hover:bg-teal-300 text-teal-950 font-extrabold text-sm uppercase tracking-wider shadow-[0_10px_28px_rgba(20,184,166,0.32)] transition-all active:scale-95 cursor-pointer touch-manipulation"
                      >
                        <PhoneCall className="w-4 h-4 text-teal-950" />
                        <span>Start Live Voice Call</span>
                      </button>
                    )}

                    {callStatus === "connected" && (
                      <button
                        type="button"
                        onClick={toggleMute}
                        className={`min-h-[48px] flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-3 rounded-2xl border font-bold text-xs sm:text-sm uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-manipulation ${
                          isMuted
                            ? "bg-rose-500/20 border-rose-400/50 text-rose-200"
                            : "bg-[#1b2d4b] border-teal-400/30 text-white hover:border-teal-300"
                        }`}
                      >
                        {isMuted ? (
                          <MicOff className="w-4 h-4 text-rose-300" />
                        ) : (
                          <Mic className="w-4 h-4 text-teal-300" />
                        )}
                        <span>{isMuted ? "Unmute" : "Mute"}</span>
                      </button>
                    )}

                    {(callStatus === "connected" || callStatus === "connecting") && (
                      <button
                        type="button"
                        onClick={handleEndCall}
                        className="min-h-[48px] flex-1 sm:flex-initial flex items-center justify-center gap-2 px-7 py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs sm:text-sm uppercase tracking-wider shadow-[0_6px_18px_rgba(225,29,72,0.35)] transition-all active:scale-95 cursor-pointer touch-manipulation"
                      >
                        <PhoneOff className="w-4 h-4" />
                        <span>End Call</span>
                      </button>
                    )}

                    {(callStatus === "ended" || callStatus === "error") && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleStartCall(selectedAssistant)}
                          disabled={remainingSessions <= 0}
                          className="min-h-[48px] flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-[#1b2d4b] hover:bg-[#23395d] border border-teal-400/35 text-white font-bold text-xs sm:text-sm uppercase tracking-wider transition-all active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer touch-manipulation"
                        >
                          <RotateCcw className="w-4 h-4 text-teal-300" />
                          <span>Call Again</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setStep("assistants")}
                          className="min-h-[48px] flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-teal-400 hover:bg-teal-300 text-teal-950 font-extrabold text-xs sm:text-sm uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-manipulation"
                        >
                          <Sparkles className="w-4 h-4 text-teal-950" />
                          <span>Switch Agent</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Full-Height Live Conversation Captions */}
              <div className="lg:col-span-7 flex flex-col rounded-3xl border border-teal-400/20 bg-[#101b30]/95 overflow-hidden min-h-[320px] lg:min-h-0 shadow-xl">
                <div className="flex items-center justify-between px-5 py-3.5 sm:px-6 sm:py-4 border-b border-teal-400/15 bg-[#152440] flex-shrink-0">
                  <div className="flex items-center gap-2.5">
                    <MessageSquareText className="w-4 h-4 sm:w-5 sm:h-5 text-teal-300" />
                    <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white">
                      Live Conversation Captions
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    Tamil • English • Tanglish • Hindi
                  </span>
                </div>

                <div
                  ref={transcriptBoxRef}
                  className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-4 scroll-smooth"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  {transcripts.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
                      <p className="text-sm sm:text-base text-slate-400 max-w-md leading-relaxed">
                        {callStatus === "idle"
                          ? `Tap "Start Live Voice Call" on the left to begin speaking with ${selectedAssistant.name}.`
                          : callStatus === "connecting"
                          ? "Connecting voice channel and preparing live captions..."
                          : "Speak naturally in Tamil, English, Tanglish, or Hindi — your conversation appears accurately right here."}
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
                        <span className="text-[11px] font-bold uppercase tracking-wider mb-1 px-1 text-slate-400">
                          {entry.speaker === "user"
                            ? formData.fullName || "You"
                            : selectedAssistant.name}
                        </span>
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 sm:px-5 sm:py-3 text-sm sm:text-[15px] leading-relaxed break-words [overflow-wrap:anywhere] ${
                            entry.speaker === "user"
                              ? "bg-teal-500/20 border border-teal-400/45 text-slate-50 font-medium rounded-br-sm shadow-sm"
                              : "bg-[#192a47] border border-slate-700/70 text-slate-100 rounded-bl-sm shadow-sm"
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
