"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/require-role";
import { normalizePhone } from "@/lib/phone";

// Hard limits to bound the import workload — anyone authenticated could
// otherwise upload a 500MB blob and exhaust memory + Prisma connections.
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 10_000;

// Lightweight CSV parser tolerant of:
//   - quoted values containing commas
//   - escaped double-quotes (""), CRLF / LF line endings
//   - leading/trailing whitespace
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      cur.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

const REQUIRED_COL = "phone";

export type ImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
};

export async function importContactsCsv(formData: FormData): Promise<ImportResult> {
  await requireRole("ADMIN");
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: "No file provided." }],
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [
        {
          row: 0,
          message: `File exceeds ${MAX_BYTES / 1024 / 1024} MB limit.`,
        },
      ],
    };
  }
  const lowerName = file.name.toLowerCase();
  if (
    file.type &&
    !file.type.includes("csv") &&
    !file.type.includes("text/plain") &&
    !lowerName.endsWith(".csv")
  ) {
    return {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: "Only .csv files are supported." }],
    };
  }
  // Strip the optional UTF-8 BOM Excel prepends — without this every Excel-
  // saved CSV would fail header validation because the first column reads
  // as "﻿phone" instead of "phone".
  const text = (await file.text()).replace(/^﻿/, "");
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) {
    return {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: "CSV is empty." }],
    };
  }
  if (rows.length - 1 > MAX_ROWS) {
    return {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [
        {
          row: 0,
          message: `Too many rows (${rows.length - 1}); the per-import cap is ${MAX_ROWS}.`,
        },
      ],
    };
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const phoneIdx = header.indexOf(REQUIRED_COL);
  if (phoneIdx < 0) {
    return {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [
        {
          row: 1,
          message: `Header must include a "${REQUIRED_COL}" column.`,
        },
      ],
    };
  }
  const nameIdx = header.indexOf("name");
  const emailIdx = header.indexOf("email");
  const notesIdx = header.indexOf("notes");
  const tagsIdx = header.indexOf("tags");

  const result: ImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rawPhone = (r[phoneIdx] ?? "").trim();
    if (!rawPhone) {
      result.skipped++;
      result.errors.push({ row: i + 1, message: "missing phone" });
      continue;
    }
    const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
    if (!/^\+\d{8,15}$/.test(phone)) {
      result.skipped++;
      result.errors.push({
        row: i + 1,
        message: `invalid phone "${rawPhone}" (E.164 required)`,
      });
      continue;
    }
    const name = nameIdx >= 0 ? r[nameIdx]?.trim() || null : null;
    const email = emailIdx >= 0 ? r[emailIdx]?.trim() || null : null;
    const notes = notesIdx >= 0 ? r[notesIdx]?.trim() || null : null;

    // Tags are intentional: if the CSV has a "tags" column for this row we
    // overwrite (even with empty array) so the user can explicitly clear them.
    // If the column is absent from the file entirely, we leave existing tags
    // alone on update.
    let tagsJson: string | undefined;
    if (tagsIdx >= 0) {
      const raw = (r[tagsIdx] ?? "").trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          tagsJson = JSON.stringify(Array.isArray(parsed) ? parsed : []);
        } catch {
          tagsJson = JSON.stringify(
            raw
              .split(/[,;|]/)
              .map((t) => t.trim())
              .filter(Boolean),
          );
        }
      } else {
        tagsJson = "[]";
      }
    }

    try {
      const existed = await prisma.contact.findUnique({
        where: { phoneNumber: phone },
      });
      await prisma.contact.upsert({
        where: { phoneNumber: phone },
        update: {
          ...(name != null ? { name } : {}),
          ...(email != null ? { email } : {}),
          ...(notes != null ? { notes } : {}),
          ...(tagsJson != null ? { tags: tagsJson } : {}),
        },
        create: {
          phoneNumber: phone,
          name,
          email,
          notes,
          tags: tagsJson ?? "[]",
        },
      });
      if (existed) result.updated++;
      else result.imported++;
    } catch (err) {
      result.skipped++;
      result.errors.push({
        row: i + 1,
        message: err instanceof Error ? err.message : "db error",
      });
    }
  }

  revalidatePath("/contacts");
  return result;
}

// ── Create a single contact (person/customer address-book entry) ──────────────
// Separate from phone-number telephony config. Name + E.164 phone required.
export type CreateContactState = { error?: string } | null;

export async function createContact(
  _prev: CreateContactState,
  formData: FormData,
): Promise<CreateContactState> {
  await requireRole("ADMIN");
  const name = String(formData.get("name") || "").trim();
  const rawPhone = String(formData.get("phone") || "").trim();
  if (!name) return { error: "Name is required." };
  if (!rawPhone) return { error: "Phone number is required." };
  // India-default normalization (10-digit 6-9 → +91…); keeps existing +country.
  const norm = normalizePhone(rawPhone);
  if (!norm.e164) {
    return {
      error:
        norm.reason === "missing country code (+)"
          ? "Phone must include a country code (e.g. +14155550123), or be a 10-digit Indian mobile."
          : `Invalid phone — ${norm.reason ?? "please check the number"}.`,
    };
  }
  const phone = norm.e164;
  const email = String(formData.get("email") || "").trim() || null;
  const company = String(formData.get("company") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const rawTags = String(formData.get("tags") || "").trim();
  const tags = rawTags
    ? JSON.stringify(rawTags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))
    : "[]";

  try {
    // Upsert on the unique phone so re-saving an existing number updates it
    // rather than throwing a unique-constraint error.
    await prisma.contact.upsert({
      where: { phoneNumber: phone },
      update: { name, email, company, notes, tags },
      create: { phoneNumber: phone, name, email, company, notes, tags },
    });
  } catch (err) {
    // Save failed → stay on the form and surface the real error.
    return { error: err instanceof Error ? err.message : "Failed to save contact." };
  }

  // Only after a confirmed insert: refresh the list data and redirect to it.
  // (redirect() throws NEXT_REDIRECT — intentionally outside the try above.)
  revalidatePath("/contacts");
  redirect("/contacts?saved=1");
}

// ── Contact autocomplete search (name / phone / email) ───────────────────────
export type ContactHit = { phoneNumber: string; name: string | null; email: string | null };

export async function searchContacts(q: string): Promise<ContactHit[]> {
  await requireRole("AGENT");
  const query = (q ?? "").trim();
  if (!query) return [];
  // Phone: match on digit substrings, tolerant of +, spaces, hyphens, a leading
  // 0, and a leading 91 (so "7397", "07397", "+917397" all find +917397…).
  const digits = query.replace(/\D/g, "");
  const alt = digits.replace(/^0+/, "").replace(/^91/, "");
  const OR: Record<string, unknown>[] = [
    { name: { contains: query, mode: "insensitive" } },
    { email: { contains: query, mode: "insensitive" } },
  ];
  if (digits) {
    OR.push({ phoneNumber: { contains: digits } });
    if (alt && alt !== digits) OR.push({ phoneNumber: { contains: alt } });
  }
  const rows = await prisma.contact.findMany({
    where: { OR },
    orderBy: [{ name: "asc" }, { lastCallAt: "desc" }],
    take: 10,
    select: { phoneNumber: true, name: true, email: true },
  });
  return rows;
}

// ── Delete a contact ──────────────────────────────────────────────────────────
export async function deleteContact(phone: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole("ADMIN");
    await prisma.contact.delete({ where: { phoneNumber: phone } });
    revalidatePath("/contacts");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove contact." };
  }
}

// ── Smart CSV import ──────────────────────────────────────────────────────────
// The client parses the CSV, auto-maps headers (synonyms) and sends already-
// mapped rows here. We validate (Name + E.164 phone required, email optional),
// skip duplicates (by phone, and by email when present) against the batch AND
// existing rows, and never silently overwrite. Returns a summary + invalid rows.
export type MappedRow = {
  name?: string; phone?: string; email?: string;
  company?: string; notes?: string; tags?: string;
};
export type SmartImportResult = {
  imported: number;
  duplicates: number;
  assumedIndia: number;
  invalid: { row: number; name: string; phone: string; reason: string }[];
};

export async function importContactsMapped(rows: MappedRow[]): Promise<SmartImportResult> {
  await requireRole("ADMIN");
  const res: SmartImportResult = { imported: 0, duplicates: 0, assumedIndia: 0, invalid: [] };
  if (!Array.isArray(rows) || rows.length === 0) return res;
  const data = rows.slice(0, MAX_ROWS);
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const existing = await prisma.contact.findMany({ select: { phoneNumber: true, email: true } });
  const existPhones = new Set(existing.map((e) => e.phoneNumber));
  const existEmails = new Set(existing.filter((e) => e.email).map((e) => e.email!.toLowerCase()));
  const seenPhones = new Set<string>();

  const toCreate: {
    phoneNumber: string; name: string; email: string | null;
    company: string | null; notes: string | null; tags: string;
  }[] = [];

  data.forEach((r, i) => {
    const rowNum = i + 2; // +1 for 0-index, +1 for the header row
    const name = (r.name ?? "").trim();
    const rawPhone = (r.phone ?? "").trim();
    const emailRaw = (r.email ?? "").trim();
    const email = emailRaw ? emailRaw.toLowerCase() : "";

    if (!name) return void res.invalid.push({ row: rowNum, name, phone: rawPhone, reason: "missing name" });
    // India-default normalization (10-digit 6-9 → +91…); keeps existing +country.
    const norm = normalizePhone(rawPhone);
    if (!norm.e164)
      return void res.invalid.push({ row: rowNum, name, phone: rawPhone, reason: norm.reason ?? "invalid phone" });
    const phone = norm.e164;
    if (norm.assumedIndia) res.assumedIndia++;
    if (email && !EMAIL.test(email))
      return void res.invalid.push({ row: rowNum, name, phone, reason: "invalid email" });

    if (seenPhones.has(phone) || existPhones.has(phone) || (email && existEmails.has(email))) {
      res.duplicates++;
      return;
    }
    seenPhones.add(phone);
    if (email) existEmails.add(email);

    const tagsRaw = (r.tags ?? "").trim();
    const tags = tagsRaw
      ? JSON.stringify(tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))
      : "[]";
    toCreate.push({
      phoneNumber: phone, name, email: email || null,
      company: (r.company ?? "").trim() || null,
      notes: (r.notes ?? "").trim() || null,
      tags,
    });
  });

  if (toCreate.length) {
    const created = await prisma.contact.createMany({ data: toCreate, skipDuplicates: true });
    res.imported = created.count;
  }
  revalidatePath("/contacts");
  return res;
}
