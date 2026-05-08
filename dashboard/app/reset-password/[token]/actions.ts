"use server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function applyReset(token: string, formData: FormData): Promise<void> {
  const password = String(formData.get("password") || "");
  if (password.length < 8) throw new Error("Password must be ≥ 8 chars");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) {
    throw new Error("Reset link expired or already used");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
}
