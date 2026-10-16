"use server";

// Campaign target management: Add Number, CSV import, From Contacts.
//
// ONE classifier backs all three entry points so validation, duplicate
// handling and DNC treatment cannot drift between them. The older
// `uploadTargets` in ./actions.ts is deliberately left in place and still
// works; this module does not replace it until the new UI is verified.
//
// DNC: a number already on the org's dnd_numbers list is stored with status
// BLOCKED rather than silently dropped, so the operator can see why it will
// not dial. The dispatcher's claim query filters `status = 'PENDING'`, so a
// BLOCKED row is never claimed, and compliance.check_dispatch_allowed still
// re-checks DND at dial time. This is a visibility aid, never the enforcement
// point.
//
// Nothing here dials. Adding a target only writes a row.

import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/require-role";
import { normalizePhone } from "@/lib/phone";

export type TargetIssue = {
  /** 1-based row number as the user sees it; 0 for single-entry paths. */
  line: number;
  value: string;
  name?: string | null;
  reason: string;
  kind: "invalid" | "duplicate" | "dnc";
};

export type ImportSummary = {
  ok: boolean;
  error?: string;
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  dnc: number;
  /** Rows actually written. 0 on a dry run. */
  inserted: number;
  issues: TargetIssue[];
  dryRun: boolean;
};

export type RawTarget = { phone: string; leadName?: string | null; line?: number };

const emptySummary = (dryRun: boolean): ImportSummary => ({
  ok: true, total: 0, valid: 0, invalid: 0, duplicate: 0, dnc: 0,
  inserted: 0, issues: [], dryRun,
});

/**
 * Classify rows and, unless `dryRun`, write them.
 *
 * Tenant isolation: the campaign must belong to the caller's organization,
 * checked before anything is read or written.
 */
async function classifyTargets(
  campaignId: string,
  rows: RawTarget[],
  dryRun: boolean,
): Promise<ImportSummary> {
  await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: orgId },
    select: { id: true },
  });
  if (!campaign) {
    return { ...emptySummary(dryRun), ok: false, error: "Campaign not found for this organization." };
  }

  const out = emptySummary(dryRun);
  out.total = rows.length;
  if (rows.length === 0) return out;

  // 1. normalize + validate with the SAME rules the contact importer uses
  type Candidate = { e164: string; leadName: string | null; line: number };
  const candidates: Candidate[] = [];
  const seenInBatch = new Set<string>();
  rows.forEach((r, i) => {
    const line = r.line ?? i + 1;
    const n = normalizePhone(r.phone ?? "");
    if (!n.e164) {
      out.invalid++;
      out.issues.push({
        line, value: r.phone ?? "", name: r.leadName ?? null,
        reason: n.reason ?? "invalid phone number", kind: "invalid",
      });
      return;
    }
    if (seenInBatch.has(n.e164)) {
      out.duplicate++;
      out.issues.push({
        line, value: n.e164, name: r.leadName ?? null,
        reason: "repeated in this import", kind: "duplicate",
      });
      return;
    }
    seenInBatch.add(n.e164);
    candidates.push({ e164: n.e164, leadName: (r.leadName ?? "").trim() || null, line });
  });
  if (candidates.length === 0) return out;

  const phones = candidates.map((c) => c.e164);

  // 2. already a target on THIS campaign -> duplicate. Never a second row, so
  //    re-importing the same file cannot produce a second call.
  const existingRows = await prisma.campaignTarget.findMany({
    where: { campaignId, phoneNumber: { in: phones } },
    select: { phoneNumber: true },
  });
  const existing = new Set(existingRows.map((t) => t.phoneNumber));

  // 3. on the org's do-not-call list -> stored BLOCKED, reported separately
  const dncRows = await prisma.dndNumber.findMany({
    where: { organizationId: orgId, phoneE164: { in: phones } },
    select: { phoneE164: true },
  });
  const onDnc = new Set(dncRows.map((d) => d.phoneE164));

  const toInsert: {
    campaignId: string; phoneNumber: string; leadName: string | null;
    status: "PENDING" | "BLOCKED";
  }[] = [];

  for (const c of candidates) {
    if (existing.has(c.e164)) {
      out.duplicate++;
      out.issues.push({
        line: c.line, value: c.e164, name: c.leadName,
        reason: "already a target on this campaign", kind: "duplicate",
      });
      continue;
    }
    if (onDnc.has(c.e164)) {
      out.dnc++;
      out.issues.push({
        line: c.line, value: c.e164, name: c.leadName,
        reason: "on the do-not-call list - added as BLOCKED, will not dial", kind: "dnc",
      });
      toInsert.push({ campaignId, phoneNumber: c.e164, leadName: c.leadName, status: "BLOCKED" });
      continue;
    }
    out.valid++;
    toInsert.push({ campaignId, phoneNumber: c.e164, leadName: c.leadName, status: "PENDING" });
  }

  if (dryRun || toInsert.length === 0) return out;

  // 4. write, then set totalTargets from a real COUNT. uploadTargets increments
  //    by the submitted row count, which drifts whenever rows are skipped;
  //    readiness needs a number that matches the table.
  await prisma.$transaction(async (tx) => {
    const res = await tx.campaignTarget.createMany({ data: toInsert });
    out.inserted = res.count;
    const total = await tx.campaignTarget.count({ where: { campaignId } });
    await tx.campaign.update({ where: { id: campaignId }, data: { totalTargets: total } });
  });

  revalidatePath(`/campaigns/${campaignId}`);
  return out;
}

/** Add one number by hand. Writes a PENDING row; never dials. */
export async function addCampaignTarget(
  campaignId: string,
  _prev: ImportSummary | null,
  formData: FormData,
): Promise<ImportSummary> {
  const phone = String(formData.get("phone") || "").trim();
  const leadName = String(formData.get("leadName") || "").trim() || null;
  if (!phone) {
    return { ...emptySummary(false), ok: false, error: "Enter a phone number." };
  }
  return classifyTargets(campaignId, [{ phone, leadName, line: 0 }], false);
}

/** Dry run behind the CSV / contacts preview - classifies without writing. */
export async function previewCampaignTargets(
  campaignId: string,
  rows: RawTarget[],
): Promise<ImportSummary> {
  return classifyTargets(campaignId, rows ?? [], true);
}

/** Commit a previewed batch (parsed CSV rows, or picked contacts). */
export async function importCampaignTargets(
  campaignId: string,
  rows: RawTarget[],
): Promise<ImportSummary> {
  return classifyTargets(campaignId, rows ?? [], false);
}

/**
 * Remove one target. Only a row that has not entered the dial pipeline may go:
 * PENDING or BLOCKED, with no call attached and no attempt recorded.
 * Dispatched / completed / failed rows stay, so call history is never deleted.
 */
export async function removeCampaignTarget(
  campaignId: string,
  targetId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();
  const t = await prisma.campaignTarget.findFirst({
    where: { id: targetId, campaignId, campaign: { organizationId: orgId } },
    select: { id: true, status: true, callId: true, attempts: true },
  });
  if (!t) return { ok: false, error: "Target not found." };
  if (t.status !== "PENDING" && t.status !== "BLOCKED") {
    return { ok: false, error: `Cannot remove a ${t.status} target.` };
  }
  if (t.callId || t.attempts > 0) {
    return { ok: false, error: "This target has already been attempted." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.campaignTarget.delete({ where: { id: t.id } });
    const total = await tx.campaignTarget.count({ where: { campaignId } });
    await tx.campaign.update({ where: { id: campaignId }, data: { totalTargets: total } });
  });
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

/**
 * Contact lookup for the "From Contacts" picker.
 *
 * Wraps the same query the contacts page uses. NOTE: the Contact model has no
 * organizationId column in this schema - contacts are global, not per-org.
 * This wrapper therefore cannot add tenant scoping that the data model does
 * not support; it enforces the AGENT role, as the contacts page does.
 */
export type ContactPick = { phoneNumber: string; name: string | null };

export async function searchContactsForCampaign(q: string): Promise<ContactPick[]> {
  await requireRole("AGENT");
  const query = (q ?? "").trim();
  const digits = query.replace(/\D/g, "");
  const alt = digits.replace(/^0+/, "").replace(/^91/, "");
  const OR: Record<string, unknown>[] = [];
  if (query) {
    OR.push({ name: { contains: query, mode: "insensitive" } });
    if (digits) {
      OR.push({ phoneNumber: { contains: digits } });
      if (alt && alt !== digits) OR.push({ phoneNumber: { contains: alt } });
    }
  }
  const rows = await prisma.contact.findMany({
    where: OR.length ? { OR } : {},
    orderBy: [{ lastCallAt: "desc" }, { name: "asc" }],
    take: 50,
    select: { phoneNumber: true, name: true },
  });
  return rows;
}
