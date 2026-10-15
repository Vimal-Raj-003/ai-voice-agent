"use server";

import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { generateApiKey } from "@/lib/api-key";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/require-role";
import {
  encryptSecret, decryptSecret, secretHint, encryptionAvailable,
} from "@/lib/credential-crypto";
import { validateProviderCredential } from "@/lib/provider-validate";

export type CreateResult =
  | { ok: true; plaintext: string; prefix: string }
  | { ok: false; error: string };

export async function createApiKey(formData: FormData): Promise<CreateResult> {
  await requireRole("OWNER");
  const name = String(formData.get("name") || "").trim();
  if (!name) return { ok: false, error: "Name is required." };
  const { id: orgId } = await getDefaultOrg();
  const { key, prefix, hash } = generateApiKey();
  await prisma.apiKey.create({
    data: { organizationId: orgId, name, keyHash: hash, prefix },
  });
  revalidatePath("/api-keys");
  return { ok: true, plaintext: key, prefix };
}

export async function revokeApiKey(id: string) {
  await requireRole("OWNER");
  await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/api-keys");
}

export async function deleteApiKey(id: string) {
  await requireRole("OWNER");
  await prisma.apiKey.delete({ where: { id } });
  revalidatePath("/api-keys");
}

// ── BYOK provider credentials ────────────────────────────────────────────────
// Separate from the API keys above on purpose. Those are tokens callers present
// TO the voice-service and are stored as a one-way hash. These are credentials
// the worker presents to a third party (Deepgram, Sarvam, Murf, ...), so they
// are stored AES-256-GCM encrypted and are decryptable by the worker only.
//
// Nothing here returns a credential to the browser. The list action returns a
// last-4 hint and a status, which is all the UI needs.

export type ProviderCredentialRow = {
  provider: string;
  hint: string | null;
  lastStatus: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export async function listProviderCredentials(): Promise<ProviderCredentialRow[]> {
  await requireRole("OWNER");
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.providerCredential.findMany({
    where: { organizationId: orgId },
    orderBy: { provider: "asc" },
    // Explicit select: `ciphertext` must never leave the server.
    select: {
      provider: true, hint: true, lastStatus: true,
      lastCheckedAt: true, lastError: true,
    },
  });
  return rows.map((r) => ({
    provider: r.provider,
    hint: r.hint,
    lastStatus: r.lastStatus,
    lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
    lastError: r.lastError,
  }));
}

export type SaveCredentialResult =
  | { ok: true; status: string; message: string }
  | { ok: false; error: string };

export async function saveProviderCredential(
  formData: FormData,
): Promise<SaveCredentialResult> {
  await requireRole("OWNER");
  const provider = String(formData.get("provider") || "").trim().toLowerCase();
  const credential = String(formData.get("credential") || "").trim();
  if (!provider) return { ok: false, error: "Pick a provider." };
  if (!credential) return { ok: false, error: "Paste the credential." };
  if (!encryptionAvailable()) {
    return {
      ok: false,
      error:
        "CREDENTIAL_ENCRYPTION_KEY is not set on the server, so credentials cannot " +
        "be stored securely. Generate one with: openssl rand -base64 32",
    };
  }

  // Validate against the REAL vendor API before storing, so a typo is caught
  // here rather than during a customer's call. A key the vendor rejects is not
  // saved at all.
  const check = await validateProviderCredential(provider, credential);
  if (check.status === "invalid") {
    return { ok: false, error: check.message };
  }

  const { id: orgId } = await getDefaultOrg();
  const ciphertext = encryptSecret(credential);
  const hint = secretHint(credential);
  await prisma.providerCredential.upsert({
    where: { organizationId_provider: { organizationId: orgId, provider } },
    create: {
      organizationId: orgId, provider, ciphertext, hint,
      lastStatus: check.status, lastError: check.status === "valid" ? null : check.message,
      lastCheckedAt: new Date(),
    },
    update: {
      ciphertext, hint,
      lastStatus: check.status, lastError: check.status === "valid" ? null : check.message,
      lastCheckedAt: new Date(),
    },
  });
  revalidatePath("/api-keys");
  return { ok: true, status: check.status, message: check.message };
}

/** Re-run the vendor check for an already-stored credential. */
export async function recheckProviderCredential(provider: string): Promise<SaveCredentialResult> {
  await requireRole("OWNER");
  const pid = (provider || "").trim().toLowerCase();
  const { id: orgId } = await getDefaultOrg();
  const row = await prisma.providerCredential.findUnique({
    where: { organizationId_provider: { organizationId: orgId, provider: pid } },
    select: { ciphertext: true },
  });
  if (!row) return { ok: false, error: "No credential stored for this provider." };

  let plaintext: string;
  try {
    plaintext = decryptSecret(row.ciphertext);
  } catch {
    return {
      ok: false,
      error:
        "The stored credential could not be decrypted — CREDENTIAL_ENCRYPTION_KEY " +
        "has probably changed since it was saved. Re-enter the key.",
    };
  }
  const check = await validateProviderCredential(pid, plaintext);
  await prisma.providerCredential.update({
    where: { organizationId_provider: { organizationId: orgId, provider: pid } },
    data: {
      lastStatus: check.status,
      lastError: check.status === "valid" ? null : check.message,
      lastCheckedAt: new Date(),
    },
  });
  revalidatePath("/api-keys");
  return { ok: true, status: check.status, message: check.message };
}

export async function deleteProviderCredential(provider: string) {
  await requireRole("OWNER");
  const { id: orgId } = await getDefaultOrg();
  await prisma.providerCredential.deleteMany({
    where: { organizationId: orgId, provider: (provider || "").toLowerCase() },
  });
  revalidatePath("/api-keys");
}
