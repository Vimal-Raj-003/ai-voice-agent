"use client";
import { emitLiveEvent } from "@/lib/liveBus";

// Client submit button for the campaign "Run now" server-action form. Emits a
// `campaign_started` event into the Live Logs stream on click, then lets the
// form submit proceed normally (no preventDefault). Purely additive — the
// server action is unchanged.
export default function CampaignRunButton({ campaignId, name }: { campaignId: string; name?: string }) {
  return (
    <button
      type="submit"
      onClick={() => emitLiveEvent({ category: "CAMPAIGN", event: "campaign_started", detail: { campaign_id: campaignId, name } })}
      className="rounded-lg bg-purple-600 text-white px-4 py-2 text-sm font-medium hover:bg-purple-500"
    >
      Run now
    </button>
  );
}
