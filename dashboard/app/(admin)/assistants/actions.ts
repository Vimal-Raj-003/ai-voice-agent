"use server";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/require-role";

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
  return {
    name: String(formData.get("name") || "Untitled"),
    systemPrompt: String(formData.get("systemPrompt") || ""),
    firstMessage: String(formData.get("firstMessage") || "") || null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    llmProvider: String(formData.get("llmProvider") || "OPENAI") as any,
    llmModel: String(formData.get("llmModel") || "gpt-4o-mini"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ttsProvider: String(formData.get("ttsProvider") || "DEEPGRAM") as any,
    voiceId: String(formData.get("voiceId") || "") || null,
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

export async function createAssistant(formData: FormData) {
  await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();
  const a = await prisma.assistant.create({
    data: { organizationId: orgId, ...readAssistantPayload(formData) },
  });
  await syncAssistantTools(a.id, readToolIds(formData));
  revalidatePath("/assistants");
  redirect(`/assistants/${a.id}`);
}

export async function updateAssistant(id: string, formData: FormData) {
  await requireRole("ADMIN");
  await prisma.assistant.update({
    where: { id },
    data: readAssistantPayload(formData),
  });
  await syncAssistantTools(id, readToolIds(formData));
  revalidatePath("/assistants");
  revalidatePath(`/assistants/${id}`);
}

export async function deleteAssistant(id: string) {
  await requireRole("ADMIN");
  await prisma.assistant.delete({ where: { id } });
  revalidatePath("/assistants");
  redirect("/assistants");
}
