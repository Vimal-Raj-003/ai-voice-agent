"use server";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireRole, type Role } from "@/lib/auth";
import { getDefaultOrg } from "@/lib/org";
import { sendEmail } from "@/lib/email";
import { revalidatePath } from "next/cache";

export type InviteResult = { previewLink?: string; sent: boolean };

export async function inviteUser(formData: FormData): Promise<InviteResult> {
  const { user: actor } = await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "VIEWER") as Role;
  if (!email.includes("@")) throw new Error("Invalid email");
  if (!["VIEWER", "AGENT", "ADMIN", "OWNER"].includes(role)) {
    throw new Error("Invalid role");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await prisma.invite.create({
    data: {
      organizationId: orgId,
      email,
      role,
      tokenHash,
      invitedBy: actor.id,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    },
  });
  const url = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/accept-invite/${token}`;
  const result = await sendEmail(
    {
      to: email,
      subject: "You've been invited to Jilljill Voice",
      text: `Click to accept: ${url}\n\nThis link expires in 72 hours.`,
    },
    url,
  );
  revalidatePath("/team");
  return result.sent
    ? { sent: true }
    : { sent: false, previewLink: result.previewLink };
}

export async function changeRole(userId: string, role: Role): Promise<void> {
  await requireRole("OWNER");
  await prisma.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/team");
}

export async function deactivateUser(userId: string): Promise<void> {
  const { user: actor } = await requireRole("OWNER");
  if (actor.id === userId) throw new Error("Cannot deactivate yourself");
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
  });
  revalidatePath("/team");
}

export async function reactivateUser(userId: string): Promise<void> {
  await requireRole("OWNER");
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: true },
  });
  revalidatePath("/team");
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await requireRole("ADMIN");
  await prisma.invite.delete({ where: { id: inviteId } });
  revalidatePath("/team");
}
