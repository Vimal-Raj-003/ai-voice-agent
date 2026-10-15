"use server";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/require-role";
import { coerceModelForProvider } from "@/lib/llm-models";
import { coerceVoiceForProvider } from "@/lib/tts-voices";
import { TRANSFER_CATEGORIES, isE164 } from "@/lib/human-transfer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _bool(v: FormDataEntryValue | null): boolean {
  return v === "true" || v === "on";
}

function _int(v: FormDataEntryValue | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// Builds the shape that's common to both create and update so we don't
// drift the two payloads as fields are added.
function readAssistantPayload(formData: FormData) {
  // Provider is the source of truth and is persisted SEPARATELY from the two
  // model fields. Models are validated by live discovery in the UI, so here we
  // only snap an EMPTY primary to the provider default — rejecting a model the
  // vendor released today (and which no local list knows about) would be worse
  // than accepting it; the worker reports an unusable model at call time.
  const llmProvider = String(formData.get("llmProvider") || "OPENAI");
  const llmModel = coerceModelForProvider(
    llmProvider,
    String(formData.get("llmModel") || ""),
  );
  // Empty fallback = "use the provider's built-in default" (see llm_routing.py).
  const rawFallback = String(formData.get("llmFallbackModel") || "").trim();
  // A fallback identical to the primary is not a fallback — it would retry the
  // same rate-limited bucket, so drop it back to automatic.
  const llmFallbackModel = rawFallback && rawFallback !== llmModel ? rawFallback : null;
  // Same coupling for TTS: snap the voice to the selected provider so an
  // incompatible pair (e.g. Sarvam + an OpenAI voice) can never persist.
  const ttsProvider = String(formData.get("ttsProvider") || "DEEPGRAM");
  const voiceId =
    coerceVoiceForProvider(ttsProvider, String(formData.get("voiceId") || "")) || null;
  return {
    name: String(formData.get("name") || "Untitled"),
    systemPrompt: String(formData.get("systemPrompt") || ""),
    firstMessage: String(formData.get("firstMessage") || "") || null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    llmProvider: llmProvider as any,
    llmModel,
    llmFallbackModel,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ttsProvider: ttsProvider as any,
    voiceId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sttProvider: String(formData.get("sttProvider") || "DEEPGRAM") as any,
    // Call accuracy & speech tuning
    silenceTimeoutSeconds: _int(formData.get("silenceTimeoutSeconds"), 30),
    maxDurationSeconds: _int(formData.get("maxDurationSeconds"), 1800),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    endOfSpeechSensitivity: String(
      formData.get("endOfSpeechSensitivity") || "LOW",
    ) as any,
    interruptionThresholdMs: _int(
      formData.get("interruptionThresholdMs"),
      150,
    ),
    backgroundDenoising: _bool(formData.get("backgroundDenoising")),
    voicemailDetection: _bool(formData.get("voicemailDetection")),
    voicemailMessage:
      String(formData.get("voicemailMessage") || "").trim() || null,
    confidenceThresholdPct: Math.max(
      0,
      Math.min(100, _int(formData.get("confidenceThresholdPct"), 0)),
    ),
    hallucinationGuard: _bool(formData.get("hallucinationGuard")),
    minPauseMs: _int(formData.get("minPauseMs"), 200),
    recordingEnabled: _bool(formData.get("recordingEnabled")),
    recordingConsentMessage:
      String(formData.get("recordingConsentMessage") || "").trim() || null,
    redactionEnabled: formData.get("redactionEnabled") !== "false",
  };
}

// Returns the set of tool IDs the user checked on the form. Form sends each
// as `tool_<id>=on`, mirroring the webhook events checkbox pattern.
function readToolIds(formData: FormData): string[] {
  const ids: string[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("tool_") && value === "on") {
      ids.push(key.slice(5));
    }
  }
  return ids;
}

async function syncAssistantTools(assistantId: string, toolIds: string[]) {
  const existing = await prisma.assistantTool.findMany({
    where: { assistantId },
    select: { toolId: true },
  });
  const existingIds = new Set(existing.map((e) => e.toolId));
  const desired = new Set(toolIds);
  const toAdd = [...desired].filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !desired.has(id));
  if (toAdd.length) {
    await prisma.assistantTool.createMany({
      data: toAdd.map((toolId) => ({ assistantId, toolId })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length) {
    await prisma.assistantTool.deleteMany({
      where: { assistantId, toolId: { in: toRemove } },
    });
  }
}


// ── Human call forwarding ────────────────────────────────────────────────────
// The category list and E.164 rule live in lib/human-transfer.ts: this module is
// "use server", which may only export async functions, and the form component
// needs the same rules.

type TransferRow = {
  category: string; label: string; phoneE164: string | null;
  enabled: boolean; priority: number;
};

/** Reads `transfer_<category>_*` fields. Returns an error string if any number
 *  is present but malformed — a bad number must not be stored and then fail
 *  silently mid-call. */
function readTransferTargets(formData: FormData): { rows: TransferRow[]; error?: string } {
  const rows: TransferRow[] = [];
  for (const { category, label } of TRANSFER_CATEGORIES) {
    const phone = String(formData.get(`transfer_${category}_phone`) || "").trim();
    const enabled = _bool(formData.get(`transfer_${category}_enabled`));
    const priority = _int(formData.get(`transfer_${category}_priority`), 100);
    const customLabel = String(formData.get(`transfer_${category}_label`) || "").trim();
    if (phone && !isE164(phone)) {
      return { rows: [], error: `${label}: "${phone}" is not a valid E.164 number (e.g. +919876543210).` };
    }
    // A category enabled with no number cannot route anything; say so rather
    // than storing a destination that will fail at call time.
    if (enabled && !phone) {
      return { rows: [], error: `${label} is enabled but has no phone number.` };
    }
    rows.push({
      category, label: customLabel || label,
      phoneE164: phone || null, enabled, priority,
    });
  }
  return { rows };
}

async function syncTransferTargets(assistantId: string, rows: TransferRow[]) {
  for (const r of rows) {
    await prisma.humanTransferTarget.upsert({
      where: { assistantId_category: { assistantId, category: r.category } },
      create: { assistantId, ...r },
      update: { label: r.label, phoneE164: r.phoneE164, enabled: r.enabled, priority: r.priority },
    });
  }
}

// useActionState shape: the form shows `error` inline and stays put on failure.
export type AssistantActionState = { error?: string };

// Re-throw Next's control-flow signals (redirect / notFound) so a surrounding
// try/catch can't swallow them and turn a navigation into an "error".
function rethrowControlFlow(e: unknown): void {
  if (
    e &&
    typeof e === "object" &&
    "digest" in e &&
    typeof (e as { digest?: unknown }).digest === "string" &&
    ((e as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
      (e as { digest: string }).digest === "NEXT_NOT_FOUND")
  ) {
    throw e;
  }
}

// SAVE — one entry point for both create and edit. The client imports this
// DIRECTLY (not via a prop) and drives it with useActionState, mirroring the
// proven ContactForm wiring. The hidden `assistantId` field decides the mode:
//   - present  → UPDATE that row by id (never inserts → no duplicate)
//   - absent   → CREATE exactly one row
// On success: revalidate the list (+ detail) and redirect to /assistants?saved=1
// so the list shows the row immediately and pops the success toast. On failure:
// return { error } so the form stays put and shows the real message.
export async function saveAssistant(
  _prev: AssistantActionState,
  formData: FormData,
): Promise<AssistantActionState> {
  const id = String(formData.get("assistantId") || "").trim();
  // Temporary lifecycle diagnostics (server console) — remove once verified.
  console.log("[assistant.save] save_started", { mode: id ? "edit" : "create", id: id || null });
  try {
    await requireRole("ADMIN");
    const data = readAssistantPayload(formData);
    // Validate forwarding numbers BEFORE any write: a malformed destination
    // stored now would only surface as a failed transfer mid-call.
    const transfer = readTransferTargets(formData);
    if (transfer.error) return { error: transfer.error };
    if (id) {
      await prisma.assistant.update({ where: { id }, data });
      await syncAssistantTools(id, readToolIds(formData));
      await syncTransferTargets(id, transfer.rows);
    } else {
      const { id: orgId } = await getDefaultOrg();
      const created = await prisma.assistant.create({
        data: { organizationId: orgId, ...data },
      });
      await syncAssistantTools(created.id, readToolIds(formData));
      await syncTransferTargets(created.id, transfer.rows);
    }
  } catch (e) {
    rethrowControlFlow(e);
    console.error("[assistant.save] save_failed", e);
    return {
      error: e instanceof Error ? e.message : "Failed to save assistant.",
    };
  }
  console.log("[assistant.save] save_success", { mode: id ? "edit" : "create" });
  revalidatePath("/assistants");
  if (id) revalidatePath(`/assistants/${id}`);
  redirect("/assistants?saved=1");
}

export async function deleteAssistant(id: string) {
  await requireRole("ADMIN");
  await prisma.assistant.delete({ where: { id } });
  revalidatePath("/assistants");
  redirect("/assistants");
}
