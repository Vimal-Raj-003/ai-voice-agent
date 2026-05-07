"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

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
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: "No file provided." }],
    };
  }
  const text = await file.text();
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) {
    return {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: "CSV is empty." }],
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
    let tagsJson: string = "[]";
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
      }
    }

    try {
      const existed = await prisma.contact.findUnique({
        where: { phoneNumber: phone },
      });
      await prisma.contact.upsert({
        where: { phoneNumber: phone },
        update: {
          name: name ?? undefined,
          email: email ?? undefined,
          notes: notes ?? undefined,
          tags: tagsJson === "[]" ? undefined : tagsJson,
        },
        create: {
          phoneNumber: phone,
          name,
          email,
          notes,
          tags: tagsJson,
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
