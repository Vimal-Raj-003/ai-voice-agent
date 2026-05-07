"use server";

import { voiceService } from "@/lib/voice-service";

export type QuickDispatchResult =
  | { ok: true; dispatchId: string; room: string; phone: string }
  | { ok: false; error: string };

export async function quickDispatchAction(
  _prev: QuickDispatchResult | null,
  formData: FormData,
): Promise<QuickDispatchResult> {
  const rawPhone = String(formData.get("phone") || "").trim();
  const leadName = String(formData.get("lead_name") || "").trim() || undefined;
  if (!rawPhone) {
    return { ok: false, error: "Phone number is required." };
  }
  const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
  if (!/^\+\d{8,15}$/.test(phone)) {
    return {
      ok: false,
      error: "Phone must be E.164 (e.g. +919876543210).",
    };
  }
  try {
    const r = await voiceService.dispatchSingle({
      phone,
      lead_name: leadName,
    });
    return {
      ok: true,
      dispatchId: r.dispatch_id,
      room: r.room,
      phone: r.phone,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
