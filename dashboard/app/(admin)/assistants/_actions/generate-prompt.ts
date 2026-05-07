"use server";

import { voiceService } from "@/lib/voice-service";

// Server action invoked by the SystemPromptField "✨ Generate with AI"
// button. Forwards to voice-service /api/assistants/generate-prompt — that's
// where the OpenAI/Groq client lives because the agent already needs those
// API keys. Dashboard never sees them.
export async function generatePromptAction(
  description: string,
): Promise<{ ok: true; prompt: string; model: string } | { ok: false; error: string }> {
  const trimmed = description.trim();
  if (!trimmed) return { ok: false, error: "Describe what the assistant should do." };
  if (trimmed.length > 2000)
    return { ok: false, error: "Description too long (max 2000 chars)." };
  try {
    const r = await voiceService.generatePrompt(trimmed);
    return { ok: true, prompt: r.prompt, model: r.model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Generation failed" };
  }
}
