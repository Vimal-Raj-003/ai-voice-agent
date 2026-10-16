// Campaign preflight, computed server-side.
//
// ONE source of truth, used by BOTH the compact readiness indicator on the
// campaign page AND the `runCampaignNow` server action. That pairing is the
// point: the readiness card used to be display-only, so collapsing it into a
// popover would otherwise have hidden the checks without anything enforcing
// them. The dispatcher itself is untouched — it still re-checks DNC, quiet
// hours and provider capacity per number at dial time.

import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { voiceService } from "@/lib/voice-service";
import { decideSipCheck } from "@/lib/sip-readiness";

export type ReadinessCheck = {
  label: string;
  /**
   * ok   — satisfied.
   * warn — advisory, does not block dispatch.
   * fail — blocks dispatch.
   * pending — COULD NOT BE DETERMINED yet. Also blocks dispatch: the contract
   *           is that we never report Ready before validation completes.
   */
  state: "ok" | "warn" | "fail" | "pending";
  detail: string;
};

export type ReadinessCounts = {
  total: number;
  eligible: number;
  blocked: number;
  invalid: number;
  attempted: number;
};

export type Readiness = {
  checks: ReadinessCheck[];
  counts: ReadinessCounts;
  /** False when any check is "fail" OR "pending". Dispatch must be refused. */
  canStart: boolean;
  /** True when something could not be verified — surfaced as "Checking". */
  pending: boolean;
  /** Human-readable reasons for every blocking check. */
  failures: string[];
};

/**
 * Telephony readiness, read from the SOURCE THE DIALER ACTUALLY USES.
 *
 * agent.py dials with `sip_trunk_id=config.OUTBOUND_TRUNK_ID` — an environment
 * value owned by the voice service. It never reads the `sip_trunks` or
 * `phone_numbers` tables. Those tables are empty on this install, so checking
 * them reported "SIP not configured" on a system that has placed real calls
 * and blocked Run now for a campaign that was in fact dialable.
 *
 * The dashboard cannot read the voice service's env directly, so it asks the
 * service, which already exposes these keys with a `configured` flag.
 * Values are never read or logged here — only the booleans.
 */
async function sipCheck(orgId: string): Promise<ReadinessCheck> {
  // Optional DB-backed config, for installs that do populate these tables.
  const [trunkRows, numberRows] = await Promise.all([
    prisma.sipTrunk.count({ where: { organizationId: orgId, isActive: true } }),
    prisma.phoneNumber.count({ where: { organizationId: orgId, isActive: true } }),
  ]);

  let trunkConfigured: boolean | null = null;
  let numberConfigured: boolean | null = null;
  let probeFailed = false;
  if (!(trunkRows > 0 && numberRows > 0)) {
    try {
      const settings = await voiceService.settings();
      // Only the booleans are read. The values are never touched or logged.
      trunkConfigured = settings?.OUTBOUND_TRUNK_ID?.configured ?? null;
      numberConfigured = settings?.VOBIZ_OUTBOUND_NUMBER?.configured ?? null;
    } catch {
      probeFailed = true;
    }
  }

  const d = decideSipCheck({
    trunkRows, numberRows, trunkConfigured, numberConfigured, probeFailed,
  });
  return { label: "SIP / provider configured", state: d.state, detail: d.detail };
}

/**
 * Evaluate every preflight condition for one campaign.
 *
 * Returns null when the campaign does not belong to `orgId`, so callers can
 * treat "not mine" and "not ready" distinctly.
 */
export async function computeReadiness(
  campaignId: string,
  orgId: string,
): Promise<Readiness | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: orgId },
    select: {
      id: true, status: true, assistantId: true,
      maxConcurrent: true, maxStartsPerMinute: true,
    },
  });
  if (!campaign) return null;

  const [counts, pendingRows, org, sip, assistant] =
    await Promise.all([
      prisma.campaignTarget.groupBy({
        by: ["status"],
        where: { campaignId },
        _count: { _all: true },
      }),
      // Only PENDING numbers can be dialed, so only those are checked for
      // validity. Capped: a campaign can hold many targets and this runs on
      // every page render and every Run now.
      prisma.campaignTarget.findMany({
        where: { campaignId, status: "PENDING" },
        select: { phoneNumber: true },
        take: 5000,
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { quietHoursStart: true, quietHoursEnd: true, quietHoursTimezone: true },
      }),
      sipCheck(orgId),
      campaign.assistantId
        ? prisma.assistant.findFirst({
            where: { id: campaign.assistantId, organizationId: orgId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const total = counts.reduce((n, c) => n + c._count._all, 0);
  const pending = byStatus.PENDING ?? 0;
  const blocked = byStatus.BLOCKED ?? 0;
  const attempted =
    (byStatus.DISPATCHED ?? 0) + (byStatus.COMPLETED ?? 0) +
    (byStatus.FAILED ?? 0) + (byStatus.SKIPPED ?? 0);

  const invalid = pendingRows.filter((t) => !normalizePhone(t.phoneNumber).e164).length;
  const eligible = Math.max(0, pending - invalid);

  // Duplicate phone numbers among pending targets would dial the same person
  // twice; the import paths dedupe, but a row could predate that.
  const seen = new Set<string>();
  let duplicates = 0;
  for (const t of pendingRows) {
    if (seen.has(t.phoneNumber)) duplicates++;
    else seen.add(t.phoneNumber);
  }

  // CampaignStatus is DRAFT | RUNNING | PAUSED | COMPLETED | FAILED.
  const startableStatus = campaign.status === "DRAFT" || campaign.status === "PAUSED";
  const quietConfigured = !!(org?.quietHoursStart && org?.quietHoursEnd);

  const checks: ReadinessCheck[] = [
    {
      label: "Assistant selected",
      state: campaign.assistantId && assistant ? "ok" : "fail",
      detail: assistant
        ? assistant.name
        : campaign.assistantId
          ? "assigned assistant is not available to this organization"
          : "pick the assistant that will make these calls",
    },
    {
      label: "Eligible targets",
      state: eligible > 0 ? "ok" : "fail",
      detail: eligible > 0
        ? `${eligible} number${eligible === 1 ? "" : "s"} ready to dial`
        : "add at least one valid, non-blocked number",
    },
    {
      label: "No invalid numbers pending",
      state: invalid === 0 ? "ok" : "fail",
      detail: invalid === 0
        ? "every pending number is valid E.164"
        : `${invalid} pending number${invalid === 1 ? "" : "s"} cannot be dialed — remove or fix`,
    },
    {
      label: "No duplicate pending targets",
      state: duplicates === 0 ? "ok" : "warn",
      detail: duplicates === 0
        ? "no number appears twice"
        : `${duplicates} number${duplicates === 1 ? " appears" : "s appear"} more than once`,
    },
    {
      label: "Campaign status permits starting",
      state: startableStatus ? "ok" : "warn",
      detail: `currently ${campaign.status}`,
    },
    sip,
    {
      label: "Do-not-call enforced",
      state: "ok",
      detail: blocked > 0
        ? `${blocked} target${blocked === 1 ? "" : "s"} blocked; every number is re-checked at dial time`
        : "every number is re-checked against the DNC list at dial time",
    },
    {
      label: "Quiet hours",
      state: quietConfigured ? "ok" : "warn",
      detail: quietConfigured
        ? `calls only ${org!.quietHoursStart}–${org!.quietHoursEnd} ${org!.quietHoursTimezone}`
        : "no quiet-hours window set for this organization",
    },
    {
      label: "Concurrency request",
      state: "ok",
      detail: `up to ${campaign.maxConcurrent} at once, ${campaign.maxStartsPerMinute}/min — clamped to the provider limit at run time`,
    },
  ];

  // "pending" blocks exactly like "fail": never report Ready before every
  // mandatory check has actually been evaluated.
  const blocking = checks.filter((c) => c.state === "fail" || c.state === "pending");
  return {
    checks,
    counts: { total, eligible, blocked, invalid, attempted },
    canStart: blocking.length === 0,
    pending: checks.some((c) => c.state === "pending"),
    failures: blocking.map((f) => `${f.label}: ${f.detail}`),
  };
}
