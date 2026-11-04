"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { preparePasswordChange } from "@/lib/admin-password";

export async function changePassword(
  _previous: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email || email !== process.env.ADMIN_EMAIL?.trim().toLowerCase()) {
    return { error: "Please sign in as the administrator." };
  }
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.isActive) return { error: "Your administrator account is unavailable." };
    const result = await preparePasswordChange(
      String(formData.get("currentPassword") ?? ""),
      String(formData.get("newPassword") ?? ""),
      String(formData.get("confirmPassword") ?? ""),
      user.passwordHash,
      process.env.ADMIN_PASSWORD_HASH,
    );
    if (result.error) return { error: result.error };
    const saved = await prisma.user.updateMany({
      where: { id: user.id, isActive: true, passwordHash: user.passwordHash },
      data: { passwordHash: result.passwordHash },
    });
    if (!saved.count) return { error: "Password changed in another session. Please try again." };
    return { success: true };
  } catch {
    return { error: "Could not save your password. Please try again." };
  }
}
