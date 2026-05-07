"use server";

import { revalidatePath } from "next/cache";

// Manual rate-refresh trigger fired from RatesPanel's "Refresh now" button.
// Proxies straight to voice-service /api/rates/refresh — that's where the
// OpenRouter fetch + DB write actually lives.
export async function refreshRatesAction(): Promise<{
  input: number;
  output: number;
  errors: number;
}> {
  const url = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
  const token = process.env.VOICE_SERVICE_TOKEN || "";
  const r = await fetch(`${url}/api/rates/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`Voice-service rate refresh failed (${r.status})`);
  }
  const data = (await r.json()) as { input: number; output: number; errors: number };
  revalidatePath("/costs");
  return data;
}
