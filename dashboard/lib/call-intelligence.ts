import type { Prisma } from "@prisma/client";

export const INTELLIGENCE_FEATURES = [
  {key: "emotion", label: "Context-aware emotion", hint: "Use tentative conversation cues for calm or warmer replies; never diagnose emotions."},
  {key: "memory", label: "Conversation memory", hint: "Retain bounded caller context and constraints during the call. Existing tools govern memory between calls."},
  {key: "recovery", label: "Call recovery", hint: "Native engines can attempt up to two SDK recoveries in the existing call. No automatic redial or action replay."},
  {key: "quality", label: "Call quality tracking", hint: "Record observed issues and room response timing. This is not a human voice-quality or accuracy score."},
  {key: "self_correction", label: "Self-correction guidance", hint: "Address challenged answers and repeated questions using confirmed state and focused clarification."},
  {key: "outcomes", label: "Business outcome tracking", hint: "Track booking, email and transfer results from business-tool receipts, separately from spoken claims."},
] as const;
export type IntelligenceFeature = typeof INTELLIGENCE_FEATURES[number]["key"];

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function intelligenceSettings(metadata: unknown): Record<IntelligenceFeature, boolean> {
  const saved = record(record(metadata).intelligence);
  return Object.fromEntries(INTELLIGENCE_FEATURES.map(({key}) => [key, typeof saved[key] === "boolean" ? saved[key] : true])) as Record<IntelligenceFeature, boolean>;
}

export function withIntelligenceSettings(metadata: unknown, form: FormData): Prisma.InputJsonObject {
  const current = record(metadata);
  const settings = Object.fromEntries(INTELLIGENCE_FEATURES.map(({key}) => [key, ["true", "on"].includes(String(form.get(`intelligence_${key}`)))]));
  return {...current, intelligence: {...record(current.intelligence), ...settings}} as Prisma.InputJsonObject;
}

export function callIntelligenceReport(metadata: unknown): Record<string, unknown> | null {
  const report = record(record(metadata).callIntelligence);
  return report.version === 1 ? report : null;
}
