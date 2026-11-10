import type { Prisma } from "@prisma/client";

export const GEMINI_LIVE_MODELS = ["gemini-3.8-live", "gemini-3.1-flash-live-preview"] as const;
export const GEMINI_LIVE_VOICES = [
  "Zephyr", "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe",
  "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome", "Fenrir", "Gacrux",
  "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Puck", "Pulcherrima",
  "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Sulafat", "Umbriel",
  "Vindemiatrix", "Zubenelgenubi",
] as const;
export type VoiceEngine = "inherit" | "pipeline" | "gpt-live" | "gemini-live";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function voiceSettings(metadata: unknown) {
  const saved = object(object(metadata).voiceRuntime);
  return {
    engine: String(saved.engine ?? "inherit") as VoiceEngine,
    model: String(saved.model ?? "gemini-3.8-live"),
    voice: String(saved.voice ?? "Zephyr"),
  };
}

export function withVoiceSettings(metadata: unknown, input: {engine: string; model: string; voice: string}): Prisma.InputJsonObject {
  if (!["inherit", "pipeline", "gpt-live", "gemini-live"].includes(input.engine)) {
    throw new Error("Select a supported voice engine.");
  }
  if (input.engine === "gemini-live") {
    if (!(GEMINI_LIVE_MODELS as readonly string[]).includes(input.model)) throw new Error("Select a supported Gemini Live model.");
    if (!(GEMINI_LIVE_VOICES as readonly string[]).includes(input.voice)) throw new Error("Select a supported Gemini Live voice.");
  }
  const current = object(metadata);
  return { ...current, voiceRuntime: { ...object(current.voiceRuntime), ...input } } as Prisma.InputJsonObject;
}
