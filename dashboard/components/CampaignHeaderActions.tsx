"use client";

// Campaign header actions: readiness indicator + Run now, side by side.
//
// Replaces the full-width readiness card. The button is disabled when the
// server-computed readiness says the campaign cannot start, and the server
// action re-checks the same readiness before dispatching, so disabling here is
// a convenience rather than the control.

import { useActionState } from "react";
import { AlertTriangle } from "lucide-react";
import { runCampaignNow, type RunNowState } from "@/app/(admin)/campaigns/actions";
import CampaignRunButton from "./CampaignRunButton";
import CampaignReadinessIndicator from "./CampaignReadinessIndicator";
import type { ReadinessCheck, ReadinessCounts } from "@/lib/campaign-readiness";

export default function CampaignHeaderActions({
  campaignId,
  name,
  checks,
  counts,
  canStart,
  pending = false,
}: {
  campaignId: string;
  name: string;
  checks: ReadinessCheck[];
  counts: ReadinessCounts;
  canStart: boolean;
  /** A mandatory check could not be evaluated yet. */
  pending?: boolean;
}) {
  const [state, formAction, running] = useActionState<RunNowState, FormData>(
    runCampaignNow,
    undefined,
  );
  // A refusal from the server means this campaign is NOT startable, whatever
  // the last server render said — never show Ready beside "Cannot start".
  const startable = canStart && !state?.error;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CampaignReadinessIndicator
          checks={checks}
          counts={counts}
          canStart={canStart}
          checking={running}
          pending={pending}
          serverRefusal={state?.error ?? null}
        />
        <form action={formAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <CampaignRunButton
            campaignId={campaignId}
            name={name}
            disabled={!startable || running || pending}
            title={startable ? undefined : "Readiness checks are failing"}
          />
        </form>
      </div>
      {state?.error && (
        <p
          role="alert"
          className="flex max-w-md items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {state.error}
        </p>
      )}
    </div>
  );
}
