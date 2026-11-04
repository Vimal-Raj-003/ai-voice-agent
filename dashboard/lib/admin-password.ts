import bcrypt from "bcryptjs";

export async function verifyAdminPassword(
  password: string,
  databaseHash: string | null | undefined,
  environmentHash: string | undefined,
): Promise<boolean> {
  const hash = databaseHash ?? environmentHash;
  if (!hash || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) return false;
  if (await bcrypt.compare(password, hash)) return true;
  // Preserve existing env-login behavior until a password is saved.
  return !databaseHash && password.trim() !== password
    ? bcrypt.compare(password.trim(), hash)
    : false;
}

export async function preparePasswordChange(
  currentPassword: string,
  newPassword: string,
  confirmation: string,
  databaseHash: string | null | undefined,
  environmentHash: string | undefined,
): Promise<{ error: string; passwordHash?: never } | { passwordHash: string; error?: never }> {
  if (newPassword !== confirmation) return { error: "New passwords do not match." };
  if (newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return { error: "Use at least 8 characters and no more than 72 UTF-8 bytes." };
  }
  if (!(await verifyAdminPassword(currentPassword, databaseHash, environmentHash))) {
    return { error: "Current password is incorrect." };
  }
  if (await verifyAdminPassword(newPassword, databaseHash, environmentHash)) {
    return { error: "Choose a different new password." };
  }
  return { passwordHash: await bcrypt.hash(newPassword, 12) };
}
