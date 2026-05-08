"use server";

import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/require-role";

const NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function validateSchema(json: string): { ok: true; value: object } | { ok: false; error: string } {
  if (!json.trim()) return { ok: true, value: { type: "object", properties: {} } };
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, error: "Schema must be a JSON object." };
    }
    return { ok: true, value: parsed };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}

function readPayload(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!NAME_RE.test(name)) {
    throw new Error(
      "Name must start with a lowercase letter, contain only [a-z0-9_], and be ≤ 32 chars.",
    );
  }
  const description = String(formData.get("description") || "").trim();
  const httpMethod = String(formData.get("httpMethod") || "POST").toUpperCase();
  const httpUrl = String(formData.get("httpUrl") || "").trim();
  // Strict scheme check + parse so we catch e.g. `httpfoo://` or empty hosts.
  let parsed: URL;
  try {
    parsed = new URL(httpUrl);
  } catch {
    throw new Error("HTTP URL is required and must be a valid http(s):// URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("HTTP URL must use http:// or https://.");
  }
  if (!parsed.hostname) {
    throw new Error("HTTP URL must include a hostname.");
  }
  // Reject placeholders (`{foo}`) anywhere in scheme/host/port. Allowing them
  // there would let the LLM pivot the request to a different host at runtime.
  // Path/query placeholders are fine — that's the whole point of templating.
  const authority = `${parsed.protocol}//${parsed.host}`;
  if (/\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(authority)) {
    throw new Error(
      "Placeholders ({arg}) are only allowed in the path or query — not in the host or port.",
    );
  }
  // Best-effort SSRF nudge — full enforcement lives in the voice-service at
  // request time (DNS resolves there). Here we just block the obvious literals
  // so an operator gets immediate feedback in the dashboard.
  const host = parsed.hostname.toLowerCase();
  const blockedLiterals = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "169.254.169.254", // AWS/GCP/Azure metadata
  ];
  if (blockedLiterals.includes(host)) {
    throw new Error(
      `HTTP URL host '${host}' is on the blocklist (loopback / metadata).`,
    );
  }
  const headers = parseHeaders(String(formData.get("httpHeaders") || ""));
  const schema = validateSchema(String(formData.get("parametersJson") || ""));
  if (!schema.ok) throw new Error(schema.error);
  const timeoutSeconds = Math.max(
    1,
    Math.min(30, Number(formData.get("timeoutSeconds") || 15)),
  );
  const isActive = formData.get("isActive") !== "false";
  return {
    name,
    description: description || null,
    parameters: schema.value,
    kind: "HTTP",
    httpMethod,
    httpUrl,
    httpHeaders: headers,
    timeoutSeconds,
    isActive,
  };
}

export async function createTool(formData: FormData) {
  await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();
  const t = await prisma.tool.create({
    data: { organizationId: orgId, ...readPayload(formData) },
  });
  revalidatePath("/tools");
  redirect(`/tools/${t.id}`);
}

export async function updateTool(id: string, formData: FormData) {
  await requireRole("ADMIN");
  await prisma.tool.update({
    where: { id },
    data: readPayload(formData),
  });
  revalidatePath("/tools");
  revalidatePath(`/tools/${id}`);
}

export async function deleteTool(id: string) {
  await requireRole("ADMIN");
  await prisma.tool.delete({ where: { id } });
  revalidatePath("/tools");
  redirect("/tools");
}
