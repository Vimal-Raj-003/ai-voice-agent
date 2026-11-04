"use server";

import { voiceService } from "@/lib/voice-service";
import { requireRole } from "@/lib/require-role";
import type { PromptDirection } from "@/lib/assistant-prompts";

// Server action invoked by the SystemPromptField "✨ Generate with AI"
// button. Forwards to voice-service /api/assistants/generate-prompt — that's
// where the configured provider clients live because the agent needs those
// API keys. Dashboard never sees them.
export async function generatePromptAction(
  description: string,
  direction: PromptDirection = "INBOUND",
): Promise<{ ok: true; prompt: string; model: string } | { ok: false; error: string }> {
  if (typeof description !== "string") return { ok: false, error: "Describe what the assistant should do." };
  const trimmed = description.trim();
  if (!trimmed) return { ok: false, error: "Describe what the assistant should do." };
  if (trimmed.length > 2000)
    return { ok: false, error: "Description too long (max 2000 chars)." };
  try {
    await requireRole("ADMIN");
    if (direction !== "INBOUND" && direction !== "OUTBOUND") return { ok: false, error: "Choose inbound or outbound." };
    const r = await voiceService.generatePrompt(trimmed, direction);
    return { ok: true, prompt: r.prompt, model: r.model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Generation failed" };
  }
}
