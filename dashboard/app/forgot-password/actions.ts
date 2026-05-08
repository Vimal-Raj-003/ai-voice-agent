"use server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

export async function requestReset(formData: FormData): Promise<{ sent: boolean; previewLink?: string }> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Don't leak which emails exist — return success either way.
  if (!user) return { sent: true };
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
    },
  });
  const url = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/reset-password/${token}`;
  const r = await sendEmail(
    {
      to: email,
      subject: "Reset your Jilljill Voice password",
      text: `Click to reset: ${url}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    },
    url,
  );
  return r.sent ? { sent: true } : { sent: false, previewLink: r.previewLink };
}
