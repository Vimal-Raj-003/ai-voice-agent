"use client";
import { emitLiveEvent } from "@/lib/liveBus";

// Client submit button for the campaign "Run now" server-action form. Emits a
// `campaign_started` event into the Live Logs stream on click, then lets the
// form submit proceed normally (no preventDefault). Purely additive — the
// server action is unchanged.
export default function CampaignRunButton({
  campaignId,
  name,
  disabled = false,
  title,
}: {
  campaignId: string;
  name?: string;
  /** Mirrors the server-side readiness gate; the action re-checks regardless. */
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      title={title}
      onClick={() => {
        if (disabled) return;
        emitLiveEvent({ category: "CAMPAIGN", event: "campaign_started", detail: { campaign_id: campaignId, name } });
      }}
      className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-purple-600"
    >
      Run now
    </button>
  );
}
