import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import bcrypt from "bcryptjs";
import * as passwords from "../lib/admin-password";

// Execute the actual server action and credentials provider with an in-memory
// database/session boundary so tests never rotate a real administrator password.
function loadModule(file: string, dependencies: Record<string, unknown>, env: Record<string, string>) {
  const source = readFileSync(path.resolve(file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const exports: Record<string, (previous: object, data: FormData) => Promise<{ success?: boolean; error?: string }>> = {};
  vm.runInNewContext(outputText, {
    exports,
    process: { env },
    require(name: string) {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

test("Save password persists a hash used by the actual login provider", async () => {
  const env = { ADMIN_EMAIL: "admin@example.test", ADMIN_PASSWORD_HASH: await bcrypt.hash("original-password", 4) };
  const user = { id: "test-admin", email: env.ADMIN_EMAIL, name: "Admin", isActive: true, passwordHash: null as string | null };
  const prisma = { user: {
    findUnique: async () => ({ ...user }),
    updateMany: async ({ data }: { data: { passwordHash: string } }) => {
      user.passwordHash = data.passwordHash;
      return { count: 1 };
    },
  } };
  const action = loadModule("app/(admin)/settings/password/actions.ts", {
    "@/lib/auth": { auth: async () => ({ user: { email: user.email } }) },
    "@/lib/prisma": { prisma },
    "@/lib/admin-password": passwords,
  }, env);
  const data = new FormData();
  data.set("currentPassword", "original-password");
  data.set("newPassword", "replacement-password");
  data.set("confirmPassword", "replacement-password");
  assert.equal((await action.changePassword({}, data)).success, true);
  assert.ok(user.passwordHash);
  assert.notEqual(user.passwordHash, "replacement-password");
  type Authorize = (credentials: { email: string; password: string }) => Promise<unknown>;
  let authorize: Authorize;
  loadModule("lib/auth.ts", {
    "next-auth": { __esModule: true, default: () => ({}) },
    "next-auth/providers/credentials": { __esModule: true, default: (config: { authorize: Authorize }) => { authorize = config.authorize; return config; } },
    "./auth-config": { authConfig: {} },
    "./prisma": { prisma },
    "./admin-password": passwords,
  }, env);
  assert.ok(await authorize!({ email: user.email, password: "replacement-password" }));
  assert.equal(await authorize!({ email: user.email, password: "original-password" }), null);
  user.isActive = false;
  assert.equal(await authorize!({ email: user.email, password: "replacement-password" }), null);
});

test("an unauthenticated password change never accesses the database", async () => {
  const action = loadModule("app/(admin)/settings/password/actions.ts", {
    "@/lib/auth": { auth: async () => null },
    "@/lib/prisma": { prisma: { user: { findUnique: () => { throw new Error("Must not access database"); } } } },
    "@/lib/admin-password": passwords,
  }, { ADMIN_EMAIL: "admin@example.test" });
  assert.equal((await action.changePassword({}, new FormData())).error, "Please sign in as the administrator.");
});
