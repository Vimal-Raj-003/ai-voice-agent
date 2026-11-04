import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { preparePasswordChange, verifyAdminPassword } from "../lib/admin-password";

test("saved passwords replace the env password without a restart", async () => {
  const oldPassword = "original-test-password";
  const newPassword = "replacement-test-password";
  const envHash = await bcrypt.hash(oldPassword, 4);
  assert.equal(await verifyAdminPassword(oldPassword, null, envHash), true);
  const saved = await preparePasswordChange(oldPassword, newPassword, newPassword, null, envHash);
  assert.ok(saved.passwordHash);
  assert.equal(await verifyAdminPassword(newPassword, saved.passwordHash, envHash), true);
  assert.equal(await verifyAdminPassword(oldPassword, saved.passwordHash, envHash), false);
  const second = await preparePasswordChange(oldPassword, "another-password", "another-password", saved.passwordHash, envHash);
  assert.equal(second.error, "Current password is incorrect.");
});

test("password change rejects incorrect current passwords and invalid replacements", async () => {
  const hash = await bcrypt.hash("existing-password", 4);
  for (const [current, password, confirmation] of [
    ["wrong-password", "replacement-password", "replacement-password"],
    ["existing-password", "replacement-password", "different-confirmation"],
    ["existing-password", "short", "short"],
    ["existing-password", "existing-password", "existing-password"],
    ["existing-password", "க".repeat(25), "க".repeat(25)],
  ]) {
    const result = await preparePasswordChange(current, password, confirmation, hash, undefined);
    assert.ok(result.error);
    assert.equal(result.passwordHash, undefined);
  }
});

test("a saved password never falls back to env, including invalid hashes and whitespace", async () => {
  const envHash = await bcrypt.hash("legacy-password", 4);
  const storedHash = await bcrypt.hash(" saved-password ", 4);
  assert.equal(await verifyAdminPassword(" saved-password ", storedHash, envHash), true);
  assert.equal(await verifyAdminPassword("saved-password", storedHash, envHash), false);
  assert.equal(await verifyAdminPassword("legacy-password", "malformed", envHash), false);
  assert.equal(await verifyAdminPassword("legacy-password", null, "malformed"), false);
});
