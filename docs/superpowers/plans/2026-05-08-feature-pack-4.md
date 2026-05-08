# Feature Pack 4 — Tier 0 Industrial-grade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six Tier 0 gaps to take Jilljill Voice from internal tool to ready-to-sell platform without changing any existing behavior.

**Architecture:** All changes are additive. New tables (`Invite`, `PasswordResetToken`, `DndNumber`, `IdempotencyKey`), new columns (defaulted), new endpoints (optional headers), new UI gated by role. Single-org-multi-user model — full multi-tenant deferred to Tier 1.

**Tech Stack:** Next.js 16 App Router · NextAuth v5 · Prisma 6 · Postgres (Neon) · pg_trgm · FastAPI · APScheduler · nodemailer (optional SMTP) · Python `re` + `zoneinfo` · LiveKit Agents 1.5.

**Spec:** `docs/superpowers/specs/2026-05-08-feature-pack-4-design.md`

---

## Working agreements

- All migrations forward-only; rollback is "drop the new column / table / enum value".
- Any failed `npx tsc --noEmit` or `python -m py_compile` blocks the commit.
- Each task ends with a commit. Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`).
- The dashboard dev server stays up across tasks (`cd dashboard && npm run dev` in a background terminal).
- The voice-service can be re-bytecode-compiled per task; full Docker rebuild deferred to a single end-of-pack step.
- After every task: a 15-second smoke check (curl the affected page or endpoint) before moving on.

---

## Task 1: Prisma schema migrations (the foundation)

All 11 schema changes go in one Prisma migration so the entire pack can apply atomically. The migration is forward-only and additive.

**Files:**
- Modify: `dashboard/prisma/schema.prisma`
- Create: `dashboard/prisma/migrations/<ts>_feature_pack_4_schema/migration.sql` (auto-generated)

- [ ] **Step 1: Add new enums + extend existing**

Append to `dashboard/prisma/schema.prisma`:

```prisma
enum UserRole {
  OWNER
  ADMIN
  AGENT
  VIEWER
}

enum DndSource {
  MANUAL
  CALLER_REQUEST
  CSV_IMPORT
  WEBHOOK
}

enum WebhookDeliveryStatus {
  PENDING
  SUCCESS
  RETRY_SCHEDULED
  DEAD_LETTER
}
```

Extend `enum CampaignTargetStatus` with `BLOCKED` and `DEFERRED` (add to the existing enum block).
Extend `enum CallOutcome` with `OPT_OUT` (add to the existing enum block).

- [ ] **Step 2: Modify the User model**

```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String?
  passwordHash   String?
  organizationId String
  role           UserRole @default(VIEWER)         // was: String @default("member")
  isActive       Boolean  @default(true)            // NEW
  invitedBy      String?                            // NEW
  lastLoginAt    DateTime?                          // NEW
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@map("users")
}
```

- [ ] **Step 3: Add new tables — Invite + PasswordResetToken**

```prisma
model Invite {
  id             String    @id @default(cuid())
  organizationId String
  email          String
  role           UserRole
  tokenHash      String    @unique
  invitedBy      String
  expiresAt      DateTime
  acceptedAt     DateTime?
  createdAt      DateTime  @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([email])
  @@map("invites")
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("password_reset_tokens")
}
```

Add `invites Invite[]` to the `Organization` model relations.
Add `passwordResetTokens PasswordResetToken[]` to the `User` model relations.

- [ ] **Step 4: Add new tables — DndNumber + IdempotencyKey**

```prisma
model DndNumber {
  id             String    @id @default(cuid())
  organizationId String
  phoneE164      String
  reason         String?
  source         DndSource
  addedBy        String?
  createdAt      DateTime  @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, phoneE164])
  @@index([organizationId])
  @@map("dnd_numbers")
}

model IdempotencyKey {
  id             String   @id @default(cuid())
  organizationId String
  scope          String
  key            String
  requestHash    String
  responseStatus Int
  responseBody   Json
  createdAt      DateTime @default(now())

  @@unique([organizationId, scope, key])
  @@index([createdAt])
  @@map("idempotency_keys")
}
```

Add `dndNumbers DndNumber[]` and `idempotencyKeys IdempotencyKey[]` to `Organization` relations.

- [ ] **Step 5: Extend Organization, Contact, Assistant**

```prisma
// Organization (add to existing model):
quietHoursStart    String?  @default("09:00")
quietHoursEnd      String?  @default("21:00")
quietHoursTimezone String   @default("Asia/Kolkata")
recordingDefaultConsentMessage String? @default("This call may be recorded for quality and training purposes.")

// Contact (add):
timezone String?

// Assistant (add):
recordingConsentMessage String?
redactionEnabled        Boolean @default(true)
```

- [ ] **Step 6: Extend WebhookDelivery, CampaignTarget, TranscriptMessage, Call**

```prisma
// WebhookDelivery — RENAME `attempts` → `attemptsMade`, ADD status / nextAttemptAt / lastError
// In the model block, replace:
//   attempts Int @default(1)
// with:
attemptsMade  Int                   @default(1)        @map("attempts")
status        WebhookDeliveryStatus @default(PENDING)
nextAttemptAt DateTime?
lastError     String?               @db.Text

// CampaignTarget (add):
dispatchAfter DateTime?

// TranscriptMessage (add):
contentRedacted String? @db.Text
hasPii          Boolean @default(false)

// Call (add):
transcriptHasPii Boolean @default(false)
```

Note on the WebhookDelivery rename: using `@map("attempts")` keeps the underlying column name and lets us avoid a destructive ALTER in this migration. The Prisma model exposes `attemptsMade`, the DB column stays `attempts`. This satisfies both the "no behavior change" constraint and the "use a clean name in code" goal.

- [ ] **Step 7: Generate the migration**

```bash
cd dashboard
npx prisma migrate dev --name feature_pack_4_schema --create-only
```

Inspect the generated SQL in `dashboard/prisma/migrations/<ts>_feature_pack_4_schema/migration.sql`. Expected operations:
- `CREATE TYPE "UserRole"`, `"DndSource"`, `"WebhookDeliveryStatus"`
- `ALTER TYPE "CampaignTargetStatus" ADD VALUE 'BLOCKED'` and `'DEFERRED'`
- `ALTER TYPE "CallOutcome" ADD VALUE 'OPT_OUT'`
- `ALTER TABLE users ALTER COLUMN role …` plus `ADD COLUMN isActive`, etc.
- `CREATE TABLE invites`, `password_reset_tokens`, `dnd_numbers`, `idempotency_keys`
- `ALTER TABLE organizations ADD COLUMN quietHoursStart`, etc.
- `ALTER TABLE webhook_deliveries ADD COLUMN status`, `nextAttemptAt`, `lastError`
- `ALTER TABLE campaign_targets ADD COLUMN dispatchAfter`
- `ALTER TABLE transcript_messages ADD COLUMN contentRedacted`, `hasPii`
- `ALTER TABLE calls ADD COLUMN transcriptHasPii`

Reject the file if it contains any `DROP COLUMN`, `DROP TABLE`, or column-rename statement (other than the one we want via `@map`).

- [ ] **Step 8: Add a data migration for existing users**

Append to the generated `migration.sql` (top of file is fine, after the type changes):

```sql
-- Promote the existing single admin to OWNER. Anyone seeded as 'admin' or
-- 'member' (or NULL) gets OWNER; later additions default to VIEWER.
UPDATE users
SET role = 'OWNER'
WHERE role = 'admin' OR role = 'member' OR role IS NULL;
```

Note: this runs after `ALTER COLUMN role` so the new column type is in place. If the cast fails, fall back to dropping default → updating → re-adding default; but the simple form should work since Postgres casts text to enum when values match enum labels exactly.

- [ ] **Step 9: Apply the migration**

```bash
cd dashboard
# Stop the dev server first (Windows DLL lock on the Prisma client).
npx prisma migrate dev
```

Expected output: `Database schema is up to date! ✔`. Restart the dev server.

- [ ] **Step 10: Verify schema and Prisma Client**

```bash
cd dashboard
npx prisma validate
npx tsc --noEmit
```

Both should pass. The Prisma Client picks up new types automatically.

- [ ] **Step 11: Commit**

```bash
git add dashboard/prisma/schema.prisma dashboard/prisma/migrations/
git commit -m "feat(schema): feature pack 4 — additive migrations for auth, TCPA, retry, idempotency, PII"
```

---

## Task 2: requireRole helper + lib/auth.ts

**Files:**
- Modify: `dashboard/lib/auth.ts`

- [ ] **Step 1: Add Role type and rank map**

Append to `dashboard/lib/auth.ts`:

```ts
export type Role = "OWNER" | "ADMIN" | "AGENT" | "VIEWER";

const RANK: Record<Role, number> = {
  VIEWER: 0,
  AGENT: 1,
  ADMIN: 2,
  OWNER: 3,
};

export class AuthorizationError extends Error {
  code: "UNAUTHENTICATED" | "INACTIVE" | "FORBIDDEN";
  constructor(code: "UNAUTHENTICATED" | "INACTIVE" | "FORBIDDEN") {
    super(code);
    this.code = code;
  }
}

/**
 * Gate a server action behind a minimum role. Throws on auth failure so the
 * action's caller (Next.js form action runtime) renders the error boundary.
 * Reads ARE intentionally not gated here — page-level prisma queries already
 * scope by org, and gating reads breaks the existing read-everything UX.
 */
export async function requireRole(min: Role) {
  const session = await auth();
  if (!session?.user?.email) throw new AuthorizationError("UNAUTHENTICATED");
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) throw new AuthorizationError("UNAUTHENTICATED");
  if (!user.isActive) throw new AuthorizationError("INACTIVE");
  if (RANK[user.role as Role] < RANK[min]) {
    throw new AuthorizationError("FORBIDDEN");
  }
  return { user };
}
```

(The `auth` import and `prisma` import already exist in `lib/auth.ts`. If `prisma` isn't imported there, add `import { prisma } from "./prisma";`.)

- [ ] **Step 2: TS-check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/auth.ts
git commit -m "feat(auth): add requireRole helper + Role type"
```

---

## Task 3: Email transport (lib/email.ts)

**Files:**
- Create: `dashboard/lib/email.ts`
- Modify: `dashboard/package.json` (add `nodemailer`)

- [ ] **Step 1: Install nodemailer**

```bash
cd dashboard && npm install nodemailer && npm install -D @types/nodemailer
```

- [ ] **Step 2: Create lib/email.ts**

```ts
// dashboard/lib/email.ts
import nodemailer from "nodemailer";

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: "smtp_not_configured"; previewLink: string };

/**
 * Send an email via SMTP. When SMTP env vars aren't set, returns
 * sent=false with a previewLink so the caller can surface the link in the
 * UI for manual sharing — preserves the single-admin happy path.
 *
 * Required env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
export async function sendEmail(
  payload: EmailPayload,
  previewLink: string,
): Promise<EmailResult> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    return { sent: false, reason: "smtp_not_configured", previewLink };
  }
  const t = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  const info = await t.sendMail({
    from: process.env.SMTP_FROM || "no-reply@jilljill.in",
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { sent: true, messageId: info.messageId };
}
```

- [ ] **Step 3: Verify import**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add dashboard/lib/email.ts dashboard/package.json dashboard/package-lock.json
git commit -m "feat(email): SMTP transport with preview-link fallback"
```

---

## Task 4: Invite flow (server actions + UI)

**Files:**
- Create: `dashboard/app/(admin)/team/page.tsx`, `actions.ts`, `new/page.tsx`
- Create: `dashboard/app/accept-invite/[token]/page.tsx`, `accept-action.ts`
- Create: `dashboard/components/InviteForm.tsx`
- Modify: `dashboard/components/SidebarNav.tsx`

- [ ] **Step 1: Server actions for invites**

```ts
// dashboard/app/(admin)/team/actions.ts
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
  // Generate a 32-byte url-safe token; store hash, ship plaintext via email.
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await prisma.invite.create({
    data: {
      organizationId: orgId,
      email,
      role,
      tokenHash,
      invitedBy: actor.id,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72h
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
```

- [ ] **Step 2: Team page (list users + pending invites)**

```tsx
// dashboard/app/(admin)/team/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { Badge } from "@/components/Badge";
import {
  changeRole,
  deactivateUser,
  reactivateUser,
  revokeInvite,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireRole("ADMIN"); // throws if VIEWER/AGENT
  const [users, invites] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Team</h1>
        <Link
          href="/team/new"
          className="rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-medium hover:bg-violet-400"
        >
          Invite member
        </Link>
      </div>

      <section className="glass rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          Members
        </h2>
        <ul className="divide-y divide-white/5">
          {users.map((u) => (
            <li
              key={u.id}
              className="py-3 flex items-center justify-between gap-3"
            >
              <div>
                <div className="text-sm font-medium">
                  {u.name || u.email}
                  {!u.isActive && (
                    <span className="ml-2 text-[10px] text-gray-500 uppercase">
                      inactive
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">{u.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="violet">{u.role}</Badge>
                <form
                  action={u.isActive ? deactivateUser.bind(null, u.id) : reactivateUser.bind(null, u.id)}
                >
                  <button className="text-xs text-gray-400 hover:text-white">
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Pending invites
          </h2>
          <ul className="divide-y divide-white/5">
            {invites.map((i) => (
              <li
                key={i.id}
                className="py-3 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm">{i.email}</div>
                  <div className="text-xs text-gray-500">
                    expires {i.expiresAt.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="violet">{i.role}</Badge>
                  <form action={revokeInvite.bind(null, i.id)}>
                    <button className="text-xs text-red-400 hover:text-red-300">
                      Revoke
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Invite form page**

```tsx
// dashboard/app/(admin)/team/new/page.tsx
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import InviteForm from "@/components/InviteForm";
import { inviteUser } from "../actions";

export default async function NewInvitePage() {
  await requireRole("ADMIN");
  async function action(formData: FormData) {
    "use server";
    const result = await inviteUser(formData);
    if (result.sent) redirect("/team");
    // SMTP not configured: store the link in a query param so the user can copy it
    redirect(`/team?invite_link=${encodeURIComponent(result.previewLink || "")}`);
  }
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Invite member</h1>
      <InviteForm action={action} />
    </div>
  );
}
```

- [ ] **Step 4: InviteForm component**

```tsx
// dashboard/components/InviteForm.tsx
"use client";
import Select from "./Select";

export default function InviteForm({
  action,
}: {
  action: (fd: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="glass rounded-2xl p-5 space-y-4">
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Role
        </span>
        <Select
          name="role"
          defaultValue="AGENT"
          options={[
            { value: "OWNER", label: "Owner" },
            { value: "ADMIN", label: "Admin" },
            { value: "AGENT", label: "Agent" },
            { value: "VIEWER", label: "Viewer" },
          ]}
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium hover:bg-violet-400"
      >
        Send invite
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Accept-invite page**

```tsx
// dashboard/app/accept-invite/[token]/page.tsx
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });
  const valid =
    invite && !invite.acceptedAt && invite.expiresAt > new Date();

  async function accept(formData: FormData) {
    "use server";
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const invite = await prisma.invite.findUnique({ where: { tokenHash } });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
      throw new Error("Invite expired or already used");
    }
    const password = String(formData.get("password") || "");
    const name = String(formData.get("name") || "").trim() || null;
    if (password.length < 8) throw new Error("Password must be ≥ 8 chars");
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.create({
        data: {
          email: invite.email,
          name,
          passwordHash,
          organizationId: invite.organizationId,
          role: invite.role,
          invitedBy: invite.invitedBy,
        },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
    redirect("/login?invited=1");
  }

  if (!valid) {
    return (
      <main className="grid min-h-screen place-items-center text-gray-300">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Invite invalid</h1>
          <p className="text-sm text-gray-500">
            This invite has expired or already been used.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center">
      <form
        action={accept}
        className="w-full max-w-sm glass rounded-2xl p-6 space-y-4"
      >
        <div>
          <h1 className="text-xl font-bold">Accept invite</h1>
          <p className="text-xs text-gray-500 mt-1">
            {invite!.email} — role {invite!.role}
          </p>
        </div>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Name (optional)
          </span>
          <input
            name="name"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Set password
          </span>
          <input
            name="password"
            type="password"
            minLength={8}
            required
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium hover:bg-violet-400"
        >
          Create account
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Sidebar entry (gated to ADMIN+)**

In `dashboard/components/SidebarNav.tsx`, find the existing nav array and add (only the new item):

```tsx
{ href: "/team", label: "Team", icon: Users, minRole: "ADMIN" }
```

If the sidebar doesn't have role-based filtering yet, add it: filter the nav items by `currentUserRole >= item.minRole` using the rank map. Pass the current role from the layout (which already calls `auth()`).

- [ ] **Step 7: Smoke check**

Restart dev server. Hit `/team` while logged in as the existing admin (now OWNER). Expect: 200 with the user list. Hit `/team/new` and create an invite. Expect: redirect to `/team?invite_link=...` if SMTP is unset; the link is printable. Open the link in a private tab — expect the accept-invite form.

- [ ] **Step 8: Commit**

```bash
git add dashboard/app/\(admin\)/team/ dashboard/app/accept-invite/ dashboard/components/InviteForm.tsx dashboard/components/SidebarNav.tsx
git commit -m "feat(team): invite flow + member management UI"
```

---

## Task 5: Password reset flow

**Files:**
- Create: `dashboard/app/forgot-password/page.tsx`, `actions.ts`
- Create: `dashboard/app/reset-password/[token]/page.tsx`, `actions.ts`
- Modify: `dashboard/app/login/page.tsx` (add link)

- [ ] **Step 1: Forgot-password action**

```ts
// dashboard/app/forgot-password/actions.ts
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
```

- [ ] **Step 2: Forgot-password page**

```tsx
// dashboard/app/forgot-password/page.tsx
import { requestReset } from "./actions";
import { redirect } from "next/navigation";

export default function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; sent?: string }>;
}) {
  async function submit(formData: FormData) {
    "use server";
    const r = await requestReset(formData);
    if (r.sent) redirect("/forgot-password?sent=1");
    redirect(`/forgot-password?link=${encodeURIComponent(r.previewLink || "")}`);
  }
  return (
    <main className="grid min-h-screen place-items-center">
      <form action={submit} className="w-full max-w-sm glass rounded-2xl p-6 space-y-4">
        <h1 className="text-xl font-bold">Reset password</h1>
        <p className="text-xs text-gray-500">
          Enter your email and we'll send you a reset link.
        </p>
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        />
        <button type="submit" className="w-full rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium">
          Send reset link
        </button>
      </form>
    </main>
  );
}
```

(Render the `?sent` and `?link` flash messages above the form by reading `searchParams` in a Suspense-friendly way — keep it simple: if `searchParams.sent` ⇒ green banner; if `searchParams.link` ⇒ amber banner with the copyable URL.)

- [ ] **Step 3: Reset-password page + action**

```ts
// dashboard/app/reset-password/[token]/actions.ts
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
```

```tsx
// dashboard/app/reset-password/[token]/page.tsx
import { redirect } from "next/navigation";
import { applyReset } from "./actions";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  async function submit(formData: FormData) {
    "use server";
    await applyReset(token, formData);
    redirect("/login?reset=1");
  }
  return (
    <main className="grid min-h-screen place-items-center">
      <form action={submit} className="w-full max-w-sm glass rounded-2xl p-6 space-y-4">
        <h1 className="text-xl font-bold">Set a new password</h1>
        <input
          name="password"
          type="password"
          minLength={8}
          required
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        />
        <button type="submit" className="w-full rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium">
          Update password
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Login link**

Edit `dashboard/app/login/page.tsx` and add inside the form, below the password field:

```tsx
<Link href="/forgot-password" className="text-xs text-violet-300 hover:text-violet-200">
  Forgot password?
</Link>
```

(Add `import Link from "next/link"` at top if not already present.)

- [ ] **Step 5: TS-check + smoke**

```bash
cd dashboard && npx tsc --noEmit
```

Hit `/forgot-password`, enter the existing admin email. Expect: redirect to `/forgot-password?link=…`. Open the link → set new password → log in.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/forgot-password/ dashboard/app/reset-password/ dashboard/app/login/page.tsx
git commit -m "feat(auth): forgot/reset password flow"
```

---

## Task 6: DND list (dashboard side)

**Files:**
- Create: `dashboard/app/(admin)/dnd/page.tsx`, `actions.ts`, `new/page.tsx`
- Create: `dashboard/components/DndForm.tsx`
- Modify: `dashboard/components/SidebarNav.tsx`
- Create: `dashboard/lib/phone.ts`

- [ ] **Step 1: Phone normalizer**

```ts
// dashboard/lib/phone.ts
/**
 * Normalize a phone string to E.164. Accepts inputs like "9876543210",
 * "+91 98765 43210", "98765-43210". Defaults to +91 country code when
 * none present. Returns null on failure.
 */
export function normalizeE164(raw: string, defaultCountry = "+91"): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return /^\+\d{8,15}$/.test(digits) ? digits : null;
  }
  // Treat as default-country number
  const numberWithoutCountry = digits.replace(/^0+/, "");
  const candidate = `${defaultCountry}${numberWithoutCountry}`;
  return /^\+\d{8,15}$/.test(candidate) ? candidate : null;
}
```

- [ ] **Step 2: Server actions**

```ts
// dashboard/app/(admin)/dnd/actions.ts
"use server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { getDefaultOrg } from "@/lib/org";
import { normalizeE164 } from "@/lib/phone";
import { revalidatePath } from "next/cache";

export async function addDndNumber(formData: FormData): Promise<void> {
  const { user } = await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();
  const phone = normalizeE164(String(formData.get("phone") || ""));
  if (!phone) throw new Error("Invalid phone number");
  const reason = String(formData.get("reason") || "").trim() || null;
  await prisma.dndNumber.upsert({
    where: { organizationId_phoneE164: { organizationId: orgId, phoneE164: phone } },
    update: { reason, source: "MANUAL", addedBy: user.id },
    create: {
      organizationId: orgId,
      phoneE164: phone,
      reason,
      source: "MANUAL",
      addedBy: user.id,
    },
  });
  revalidatePath("/dnd");
}

export async function removeDndNumber(id: string): Promise<void> {
  await requireRole("ADMIN");
  await prisma.dndNumber.delete({ where: { id } });
  revalidatePath("/dnd");
}

export async function importDndCsv(formData: FormData): Promise<{ added: number; skipped: number }> {
  const { user } = await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();
  const file = formData.get("file") as File;
  if (!file) throw new Error("No file");
  const text = await file.text();
  let added = 0;
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const phone = normalizeE164(line.trim().split(",")[0]);
    if (!phone) {
      skipped++;
      continue;
    }
    try {
      await prisma.dndNumber.create({
        data: {
          organizationId: orgId,
          phoneE164: phone,
          source: "CSV_IMPORT",
          addedBy: user.id,
        },
      });
      added++;
    } catch {
      skipped++; // unique constraint
    }
  }
  revalidatePath("/dnd");
  return { added, skipped };
}
```

- [ ] **Step 3: DND list page + form**

```tsx
// dashboard/app/(admin)/dnd/page.tsx
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { removeDndNumber } from "./actions";

export const dynamic = "force-dynamic";

export default async function DndPage() {
  await requireRole("ADMIN");
  const rows = await prisma.dndNumber.findMany({
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Do-Not-Call list</h1>
          <p className="text-sm text-gray-500 mt-1">
            Numbers on this list are blocked from outbound dispatch and
            return BLOCKED status on campaign targets.
          </p>
        </div>
        <Link
          href="/dnd/new"
          className="rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-medium"
        >
          Add number
        </Link>
      </div>
      <a
        href="/api/dnd/export"
        className="text-xs text-gray-400 hover:text-white"
      >
        Export CSV
      </a>
      <ul className="rounded-2xl border border-white/10 divide-y divide-white/5">
        {rows.length === 0 && (
          <li className="p-4 text-sm text-gray-500">No numbers on the list.</li>
        )}
        {rows.map((r) => (
          <li
            key={r.id}
            className="p-3 flex items-center justify-between gap-3"
          >
            <div>
              <div className="font-mono text-sm">{r.phoneE164}</div>
              <div className="text-xs text-gray-500">
                {r.reason || "—"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone="violet">{r.source}</Badge>
              <span className="text-[10px] text-gray-500">
                {r.createdAt.toLocaleDateString()}
              </span>
              <form action={removeDndNumber.bind(null, r.id)}>
                <button className="text-xs text-red-400 hover:text-red-300">
                  Remove
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// dashboard/app/(admin)/dnd/new/page.tsx
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { addDndNumber } from "../actions";

export default async function NewDndPage() {
  await requireRole("ADMIN");
  async function action(formData: FormData) {
    "use server";
    await addDndNumber(formData);
    redirect("/dnd");
  }
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Add to DND</h1>
      <form action={action} className="glass rounded-2xl p-5 space-y-3">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Phone (E.164 or 10-digit IN)
          </span>
          <input
            name="phone"
            required
            placeholder="+919876543210 or 9876543210"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Reason (optional)
          </span>
          <input
            name="reason"
            placeholder="Customer requested"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium">
          Add
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: DND CSV export route**

```ts
// dashboard/app/api/dnd/export/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("unauthorized", { status: 401 });
  const rows = await prisma.dndNumber.findMany({
    orderBy: { phoneE164: "asc" },
  });
  const lines = ["phone,reason,source,created_at"];
  for (const r of rows) {
    const reason = (r.reason || "").replace(/"/g, '""');
    lines.push(`"${r.phoneE164}","${reason}","${r.source}","${r.createdAt.toISOString()}"`);
  }
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="dnd-list.csv"`,
    },
  });
}
```

- [ ] **Step 5: Sidebar entry (ADMIN+)**

Add `{ href: "/dnd", label: "DND list", icon: Ban, minRole: "ADMIN" }` to `SidebarNav.tsx`.

- [ ] **Step 6: TS-check + smoke**

```bash
cd dashboard && npx tsc --noEmit
```

Hit `/dnd`, add a number, see it appear in the list. Hit `/api/dnd/export` while logged in, expect a CSV download.

- [ ] **Step 7: Commit**

```bash
git add dashboard/app/\(admin\)/dnd/ dashboard/app/api/dnd/ dashboard/components/SidebarNav.tsx dashboard/lib/phone.ts
git commit -m "feat(dnd): do-not-call list CRUD + CSV export"
```

---

## Task 7: voice-service compliance module + db helpers

**Files:**
- Create: `voice-service/compliance.py`
- Modify: `voice-service/db.py`
- Test: inline `python -c` checks

- [ ] **Step 1: db.py helpers**

Append to `voice-service/db.py`:

```python
async def is_on_dnd(org_id: str, phone_e164: str) -> bool:
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT 1 FROM dnd_numbers
           WHERE "organizationId" = $1 AND "phoneE164" = $2''',
        org_id,
        phone_e164,
    )
    return row is not None


async def get_org_quiet_hours(org_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT "quietHoursStart" AS start, "quietHoursEnd" AS end_,
                  "quietHoursTimezone" AS tz
             FROM organizations WHERE id = $1''',
        org_id,
    )
    if not row:
        return None
    return {"start": row["start"], "end": row["end_"], "tz": row["tz"]}


async def add_dnd_caller_request(org_id: str, phone_e164: str) -> None:
    """Used by the agent when a caller says 'stop calling'."""
    pool = await get_pool()
    await pool.execute(
        '''INSERT INTO dnd_numbers
             (id, "organizationId", "phoneE164", source, "createdAt")
           VALUES ($1, $2, $3, 'CALLER_REQUEST', now())
           ON CONFLICT ("organizationId", "phoneE164") DO NOTHING''',
        _cuid(),
        org_id,
        phone_e164,
    )
```

(`_cuid()` is the existing helper used for inserts. If it doesn't exist, use `str(uuid.uuid4())` and accept that the IDs won't match cuid format — the column type is just String.)

- [ ] **Step 2: compliance.py**

```python
# voice-service/compliance.py
"""Compliance checks: DND list and quiet-hours enforcement.

Both checks run at dispatch time. The agent re-checks DND just before
SIP dial to close the race window between dispatch and call placement.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import db


@dataclass
class ComplianceResult:
    allowed: bool
    reason: str = ""
    code: int = 200
    next_allowed_at: datetime | None = None


def _parse_hhmm(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def _in_quiet_window(now_local: datetime, start: str, end: str) -> bool:
    """Return True if `now_local`'s time falls within [start, end].

    Handles wrap-around (e.g., 21:00 → 09:00 means "from 21:00 today
    through 09:00 tomorrow").
    """
    s = _parse_hhmm(start)
    e = _parse_hhmm(end)
    t = now_local.time()
    if s <= e:
        return s <= t <= e
    # Wrap-around: window is [s, midnight) ∪ [midnight, e].
    return t >= s or t <= e


def _next_allowed(now_local: datetime, start: str, end: str) -> datetime:
    """Return the next datetime when the dialer becomes allowed."""
    s = _parse_hhmm(start)
    today_start = now_local.replace(
        hour=s.hour, minute=s.minute, second=0, microsecond=0
    )
    if now_local <= today_start:
        return today_start
    # We're past today's start; if window doesn't wrap we wait for tomorrow's start.
    e = _parse_hhmm(end)
    if s <= e:
        return today_start + timedelta(days=1)
    # Wrap-around window: if before midnight (after start) we're already in window.
    # Otherwise (before today's end), next allowed is today's start (tomorrow's window).
    return today_start


async def check_dispatch_allowed(
    org_id: str, phone_e164: str, contact_tz: str | None
) -> ComplianceResult:
    if await db.is_on_dnd(org_id, phone_e164):
        return ComplianceResult(allowed=False, reason="DND", code=403)
    qh = await db.get_org_quiet_hours(org_id)
    if not qh:
        return ComplianceResult(allowed=True)
    tz_name = contact_tz or qh["tz"]
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("Asia/Kolkata")
    now_local = datetime.now(tz)
    in_quiet = _in_quiet_window(now_local, qh["start"], qh["end"])
    if not in_quiet:
        return ComplianceResult(allowed=True)
    return ComplianceResult(
        allowed=False,
        reason="OUTSIDE_QUIET_HOURS",
        code=429,
        next_allowed_at=_next_allowed(now_local, qh["start"], qh["end"]),
    )
```

- [ ] **Step 3: Inline tests**

```bash
cd voice-service && python -c "
from datetime import datetime
from zoneinfo import ZoneInfo
from compliance import _in_quiet_window, _next_allowed

tz = ZoneInfo('Asia/Kolkata')

# Standard window: 09:00 - 21:00 means quiet OUTSIDE that → check inverted in caller
# But the helper itself just checks 'is t between start and end'.
assert _in_quiet_window(datetime(2026, 5, 8, 10, 0, tzinfo=tz), '09:00', '21:00') is True
assert _in_quiet_window(datetime(2026, 5, 8, 22, 0, tzinfo=tz), '09:00', '21:00') is False

# Wrap-around (typical TCPA quiet hours: 21:00 - 09:00)
assert _in_quiet_window(datetime(2026, 5, 8, 23, 0, tzinfo=tz), '21:00', '09:00') is True
assert _in_quiet_window(datetime(2026, 5, 8, 4, 0, tzinfo=tz), '21:00', '09:00') is True
assert _in_quiet_window(datetime(2026, 5, 8, 12, 0, tzinfo=tz), '21:00', '09:00') is False

# Next-allowed with non-wrap window (window IS the allowed period 9-21).
# At 22:00, next allowed = 09:00 tomorrow.
nxt = _next_allowed(datetime(2026, 5, 8, 22, 0, tzinfo=tz), '09:00', '21:00')
assert nxt.day == 9 and nxt.hour == 9
print('compliance OK')
"
```

- [ ] **Step 4: Commit**

```bash
git add voice-service/compliance.py voice-service/db.py
git commit -m "feat(voice-service): compliance module — DND + quiet-hours guard"
```

---

## Task 8: Wire compliance into dispatch endpoints

**Files:**
- Modify: `voice-service/server.py`

- [ ] **Step 1: Patch dispatch_single**

Find `async def dispatch_single` in `voice-service/server.py`. After resolving `org_id` and the target phone (look at the existing code; `body.get("phone")` or similar), insert before any LiveKit call:

```python
from compliance import check_dispatch_allowed
# ... existing dispatch_single body before LiveKit dispatch ...
result = await check_dispatch_allowed(org_id, target_phone, contact_tz=None)
if not result.allowed:
    return JSONResponse(
        status_code=result.code,
        content={
            "error": result.reason,
            **(
                {"next_allowed_at": result.next_allowed_at.isoformat()}
                if result.next_allowed_at
                else {}
            ),
        },
    )
```

- [ ] **Step 2: Patch dispatch_bulk**

Find `async def dispatch_bulk`. For each target in the loop, run `check_dispatch_allowed` before queuing. On `BLOCKED`, write `CampaignTarget.status='BLOCKED'` and `lastError='On DND list'`. On `OUTSIDE_QUIET_HOURS`, write `status='DEFERRED'` and `dispatchAfter=result.next_allowed_at`.

```python
async with pool.acquire() as conn:
    for t in targets:
        decision = await check_dispatch_allowed(org_id, t.phone, t.contact_tz)
        if decision.reason == "DND":
            await conn.execute(
                '''UPDATE campaign_targets
                   SET status = 'BLOCKED', "lastError" = 'On DND list'
                   WHERE id = $1''', t.id)
            blocked += 1
            continue
        if decision.reason == "OUTSIDE_QUIET_HOURS":
            await conn.execute(
                '''UPDATE campaign_targets
                   SET status = 'DEFERRED', "dispatchAfter" = $1
                   WHERE id = $2''', decision.next_allowed_at, t.id)
            deferred += 1
            continue
        # ... existing dispatch logic for the target ...
```

(Adapt to the actual variable names in the current `dispatch_bulk` — the structure may differ; keep the surrounding code as-is.)

- [ ] **Step 3: Add agent-side DND re-check (race close)**

In `voice-service/agent.py`, after the inbound-routing block but before SIP dial-out (search for `create_sip_participant`), add for outbound calls:

```python
if direction == "OUTBOUND":
    if await db.is_on_dnd(org_id, phone):
        logger.warning("dnd_race_caught", phone=phone)
        await db.log_error("agent", f"DND race caught for {phone}")
        agent_tools._closed_outcome = "OPT_OUT"
        await db.remove_active_call(ctx.room.name)
        return
```

- [ ] **Step 4: Smoke**

Add a test number to DND, then call `POST /api/dispatch/single` with that number — expect 403 with `{"error": "DND"}`. Set quiet hours wide (`23:00 - 08:00`) and dispatch at midday — expect 200. Set narrow (`23:00 - 23:30`) and dispatch in window — expect 429.

- [ ] **Step 5: Commit**

```bash
git add voice-service/server.py voice-service/agent.py
git commit -m "feat(dispatch): TCPA — DND + quiet-hours guard at dispatch and pre-SIP"
```

---

## Task 9: Recording-consent prompt

**Files:**
- Modify: `voice-service/agent.py`, `voice-service/db.py`
- Modify: `dashboard/components/AssistantForm.tsx`, `dashboard/app/(admin)/assistants/actions.ts`

- [ ] **Step 1: Profile mapping**

In `voice-service/db.py` `get_assistant_as_profile`, add to the returned dict:

```python
"recording_consent_message": r["recordingConsentMessage"],
"redaction_enabled": bool(r["redactionEnabled"]),
```

- [ ] **Step 2: Agent plays the consent prompt**

In `voice-service/agent.py`, find the line `await session.generate_reply(instructions="Begin the call now per your system prompt.")`. Insert immediately before it:

```python
# Recording-consent prompt — only when the assistant has explicit copy and
# recording is enabled. Plays after firstMessage and before the agent's
# generated greeting. allow_interruptions=False so it always completes.
consent = profile.get("recording_consent_message")
if profile.get("recording_enabled") and consent:
    try:
        await session.say(consent, allow_interruptions=False)
    except Exception as exc:
        logger.warning("consent_prompt_failed", error=str(exc))
```

- [ ] **Step 3: Form field**

In `dashboard/components/AssistantForm.tsx`, in the Identity column (left), add a textarea below the existing fields:

```tsx
<FormField
  label="Recording consent message"
  tooltip="Played after the greeting when recording is enabled. Required for two-party-consent jurisdictions (most US states, India). Leave empty to skip."
>
  <textarea
    name="recordingConsentMessage"
    rows={2}
    defaultValue={initial?.recordingConsentMessage ?? ""}
    placeholder="This call may be recorded for quality and training purposes."
    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
  />
</FormField>

<FormField
  label="Redact PII in transcripts"
  tooltip="Auto-mask credit cards (Luhn-checked), Aadhaar, SSN, email, and phone numbers in the stored transcript."
>
  <BooleanSelect name="redactionEnabled" defaultValue={initial?.redactionEnabled ?? true} />
</FormField>
```

- [ ] **Step 4: Server action reads it**

In `dashboard/app/(admin)/assistants/actions.ts` find the readPayload function. Add to the returned data object:

```ts
recordingConsentMessage:
  String(formData.get("recordingConsentMessage") || "").trim() || null,
redactionEnabled: formData.get("redactionEnabled") !== "false",
```

- [ ] **Step 5: Smoke**

Edit an assistant, set a consent message, save. Re-load — expect the value to round-trip. Place a test call (browser demo) with recording on — the consent line should play after the firstMessage.

- [ ] **Step 6: Commit**

```bash
git add dashboard/components/AssistantForm.tsx dashboard/app/\(admin\)/assistants/actions.ts voice-service/agent.py voice-service/db.py
git commit -m "feat(compliance): recording-consent prompt + redaction toggle on assistant"
```

---

## Task 10: pg_trgm extension + transcript search index

**Files:**
- Create: `dashboard/prisma/migrations/<ts>_pg_trgm_transcript/migration.sql`

- [ ] **Step 1: Generate empty migration**

```bash
cd dashboard && npx prisma migrate dev --name pg_trgm_transcript --create-only
```

- [ ] **Step 2: Replace generated SQL**

Replace contents of the migration with:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CONCURRENTLY so we don't block writes while building the index. Cannot
-- run inside a transaction; Prisma migrations run statements one at a time
-- so this is safe.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transcript_content_trgm
  ON transcript_messages USING gin (content gin_trgm_ops);
```

- [ ] **Step 3: Apply**

```bash
cd dashboard && npx prisma migrate dev
```

Expected: migration applies. Verify in Postgres:

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'transcript_messages';
-- expect idx_transcript_content_trgm
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/prisma/migrations/
git commit -m "feat(search): pg_trgm GIN index on transcript_messages.content"
```

---

## Task 11: Calls table — filters + pagination + transcript search

**Files:**
- Modify: `dashboard/app/(admin)/calls/page.tsx`
- Create: `dashboard/components/CallsFilters.tsx`

- [ ] **Step 1: CallsFilters client component**

```tsx
// dashboard/components/CallsFilters.tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

type Option = { value: string; label: string };

const DIRECTIONS: Option[] = [
  { value: "", label: "All directions" },
  { value: "INBOUND", label: "Inbound" },
  { value: "OUTBOUND", label: "Outbound" },
];

const STATUSES: Option[] = [
  { value: "", label: "All statuses" },
  { value: "QUEUED", label: "Queued" },
  { value: "RINGING", label: "Ringing" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
];

const OUTCOMES: Option[] = [
  { value: "", label: "All outcomes" },
  { value: "BOOKED", label: "Booked" },
  { value: "INTERESTED", label: "Interested" },
  { value: "NOT_INTERESTED", label: "Not interested" },
  { value: "VOICEMAIL", label: "Voicemail" },
  { value: "OPT_OUT", label: "Opt-out" },
];

export default function CallsFilters({
  assistants,
}: {
  assistants: { id: string; name: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQ(sp.get("q") ?? "");
  }, [sp]);

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page"); // reset to page 1 on filter change
    router.replace(`/calls?${params.toString()}`, { scroll: false });
  };

  const onQ = (v: string) => {
    setQ(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setParam("q", v), 250);
  };

  const clearAll = () => router.replace("/calls", { scroll: false });
  const hasAny =
    sp.get("q") ||
    sp.get("direction") ||
    sp.get("status") ||
    sp.get("outcome") ||
    sp.get("assistantId") ||
    sp.get("from") ||
    sp.get("to");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Search transcripts and notes…"
            className="w-full rounded-lg border border-white/10 bg-black/30 pl-7 pr-2 py-1.5 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </div>
        <select
          value={sp.get("direction") ?? ""}
          onChange={(e) => setParam("direction", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          {DIRECTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={sp.get("status") ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          {STATUSES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={sp.get("outcome") ?? ""}
          onChange={(e) => setParam("outcome", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={sp.get("assistantId") ?? ""}
          onChange={(e) => setParam("assistantId", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          <option value="">All assistants</option>
          {assistants.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={sp.get("from") ?? ""}
          onChange={(e) => setParam("from", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={sp.get("to") ?? ""}
          onChange={(e) => setParam("to", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        />
        {hasAny && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1"
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Calls page reads searchParams**

Replace the body of `dashboard/app/(admin)/calls/page.tsx` with:

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge, directionTone, outcomeTone, sentimentTone, statusTone } from "@/components/Badge";
import CallsFilters from "@/components/CallsFilters";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const direction = sp.direction || undefined;
  const status = sp.status || undefined;
  const outcome = sp.outcome || undefined;
  const assistantId = sp.assistantId || undefined;
  const from = sp.from ? new Date(sp.from) : undefined;
  const to = sp.to ? new Date(sp.to + "T23:59:59") : undefined;
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PAGE_SIZE;

  // Trigram-search call IDs first when q is present.
  let idFilter: string[] | null = null;
  let snippetMap: Map<string, string> = new Map();
  if (q) {
    const rows: { call_id: string; snippet: string }[] = await prisma.$queryRaw`
      SELECT DISTINCT ON ("callId")
        "callId" AS call_id,
        substring(content from greatest(1, position(${q} in lower(content)) - 30) for 120) AS snippet
      FROM transcript_messages
      WHERE content ILIKE '%' || ${q} || '%' OR content % ${q}
      ORDER BY "callId", similarity(content, ${q}) DESC
      LIMIT 200
    `;
    idFilter = rows.map((r) => r.call_id);
    snippetMap = new Map(rows.map((r) => [r.call_id, r.snippet]));
    if (idFilter.length === 0) idFilter = ["__none__"]; // ensure no rows
  }

  const where: Record<string, unknown> = {};
  if (direction) where.direction = direction;
  if (status) where.status = status;
  if (outcome) where.outcome = outcome;
  if (assistantId) where.assistantId = assistantId;
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as Record<string, Date>).gte = from;
    if (to) (where.createdAt as Record<string, Date>).lte = to;
  }
  if (idFilter) where.id = { in: idFilter };

  const [calls, total, assistants] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: PAGE_SIZE,
    }),
    prisma.call.count({ where }),
    prisma.assistant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Calls</h1>
      <CallsFilters assistants={assistants} />
      <div className="text-xs text-gray-500">
        {total} call{total === 1 ? "" : "s"}
        {q && ` matching "${q}"`}
      </div>
      <ul className="rounded-2xl border border-white/10 divide-y divide-white/5">
        {calls.length === 0 && (
          <li className="p-6 text-sm text-gray-500 text-center">
            No calls found. {q && "Try clearing filters."}
          </li>
        )}
        {calls.map((c) => (
          <li key={c.id} className="p-3 hover:bg-white/[0.02]">
            <Link href={`/calls/${c.id}`} className="block">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm">{c.toNumber}</div>
                  <div className="text-[11px] text-gray-500">
                    {c.createdAt.toLocaleString()}
                    {c.durationSeconds != null && ` · ${c.durationSeconds}s`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={directionTone(c.direction)}>{c.direction.toLowerCase()}</Badge>
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  {c.outcome && <Badge tone={outcomeTone(c.outcome)}>{c.outcome}</Badge>}
                  {c.sentiment && <Badge tone={sentimentTone(c.sentiment)}>{c.sentiment}</Badge>}
                </div>
              </div>
              {q && snippetMap.has(c.id) && (
                <div
                  className="mt-2 text-[11px] text-gray-400 italic line-clamp-2"
                  dangerouslySetInnerHTML={{
                    __html: snippetMap
                      .get(c.id)!
                      .replace(
                        new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"),
                        '<mark class="bg-violet-500/30 text-white">$1</mark>',
                      ),
                  }}
                />
              )}
            </Link>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <Pagination current={page} total={totalPages} sp={sp} />
      )}
    </div>
  );
}

function Pagination({
  current,
  total,
  sp,
}: {
  current: number;
  total: number;
  sp: Record<string, string | undefined>;
}) {
  const pageUrl = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v && k !== "page") params.set(k, String(v));
    }
    if (p > 1) params.set("page", String(p));
    return `/calls?${params.toString()}`;
  };
  return (
    <div className="flex items-center justify-center gap-1 text-xs">
      {current > 1 && (
        <Link href={pageUrl(current - 1)} className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/5">
          ← prev
        </Link>
      )}
      <span className="px-2 py-1 text-gray-500">
        Page {current} of {total}
      </span>
      {current < total && (
        <Link href={pageUrl(current + 1)} className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/5">
          next →
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 3: TS-check + smoke**

```bash
cd dashboard && npx tsc --noEmit
```

Hit `/calls` (no params) — same as before. Hit `/calls?direction=OUTBOUND` — only outbound. Hit `/calls?q=hello` — calls whose transcript contains "hello", with highlighted snippets. Hit `/calls?page=2` — paginates.

- [ ] **Step 4: Commit**

```bash
git add dashboard/components/CallsFilters.tsx dashboard/app/\(admin\)/calls/page.tsx
git commit -m "feat(calls): filters, pagination, transcript search with snippets"
```

---

## Task 12: Webhook retry — schema and helpers

**Files:**
- Modify: `voice-service/notify.py`, `voice-service/db.py`

- [ ] **Step 1: Helpers in db.py**

Append:

```python
RETRY_SCHEDULE_SECONDS = [60, 300, 1800, 7200, 43200]  # 1m, 5m, 30m, 2h, 12h

async def schedule_webhook_retry(delivery_id: str, error: str) -> None:
    """Bump attemptsMade, schedule next attempt or dead-letter."""
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT "attemptsMade" FROM webhook_deliveries WHERE id = $1''',
        delivery_id,
    )
    if not row:
        return
    next_attempt_idx = row["attemptsMade"]  # 0-indexed
    if next_attempt_idx >= len(RETRY_SCHEDULE_SECONDS):
        # Out of attempts → dead-letter
        await pool.execute(
            '''UPDATE webhook_deliveries
               SET status = 'DEAD_LETTER',
                   "attemptsMade" = "attemptsMade" + 1,
                   "lastError" = $2,
                   "nextAttemptAt" = NULL
               WHERE id = $1''',
            delivery_id, error[:1000],
        )
        return
    delay = RETRY_SCHEDULE_SECONDS[next_attempt_idx]
    await pool.execute(
        '''UPDATE webhook_deliveries
           SET status = 'RETRY_SCHEDULED',
               "attemptsMade" = "attemptsMade" + 1,
               "lastError" = $2,
               "nextAttemptAt" = now() + ($3 || ' seconds')::interval
           WHERE id = $1''',
        delivery_id, error[:1000], str(delay),
    )


async def mark_webhook_succeeded(delivery_id: str, status_code: int, body: str) -> None:
    pool = await get_pool()
    await pool.execute(
        '''UPDATE webhook_deliveries
           SET status = 'SUCCESS',
               "attemptsMade" = "attemptsMade" + 1,
               "responseCode" = $2,
               "responseBody" = $3,
               "succeededAt" = now(),
               "nextAttemptAt" = NULL
           WHERE id = $1''',
        delivery_id, status_code, (body or "")[:5000],
    )


async def fetch_pending_retries(limit: int = 50) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        '''SELECT d.id, d."webhookId", d.event, d.payload,
                  w.url, w.secret
           FROM webhook_deliveries d
           JOIN webhooks w ON w.id = d."webhookId"
           WHERE d.status = 'RETRY_SCHEDULED' AND d."nextAttemptAt" <= now()
             AND w."isActive" = true
           ORDER BY d."nextAttemptAt" ASC
           LIMIT $1
           FOR UPDATE OF d SKIP LOCKED''',
        limit,
    )
    return [dict(r) for r in rows]


async def queue_immediate_retry(delivery_id: str) -> None:
    pool = await get_pool()
    await pool.execute(
        '''UPDATE webhook_deliveries
           SET status = 'RETRY_SCHEDULED', "nextAttemptAt" = now()
           WHERE id = $1''',
        delivery_id,
    )
```

- [ ] **Step 2: Update notify.py to use the new state**

In `voice-service/notify.py`, find the existing `send_signed_webhook` (or the function that records delivery rows). On 2xx response, call `db.mark_webhook_succeeded(delivery_id, resp.status_code, resp.text)`. On 4xx/5xx or exception, call `db.schedule_webhook_retry(delivery_id, error_text)`.

Critical: when a webhook is FIRST sent (from agent.py shutdown), insert the delivery row with `status='PENDING'` and `attemptsMade=0`, then attempt the request. The result (success or schedule retry) updates the row. This replaces any current "fire and forget" path.

- [ ] **Step 3: Commit**

```bash
git add voice-service/notify.py voice-service/db.py
git commit -m "feat(webhooks): retry/dead-letter helpers + state machine"
```

---

## Task 13: Webhook retry poller (APScheduler job)

**Files:**
- Modify: `voice-service/server.py`

- [ ] **Step 1: Add the job**

Find the existing APScheduler initialization in `server.py` (it's used by the campaign scheduler and rate-refresh job). Add a new job near the others:

```python
@scheduler.scheduled_job("interval", seconds=60, id="webhook_retry_poll", coalesce=True, max_instances=1)
async def poll_webhook_retries() -> None:
    try:
        rows = await db.fetch_pending_retries(limit=50)
    except Exception as exc:
        logger.warning("webhook_retry_fetch_failed", error=str(exc))
        return
    for r in rows:
        try:
            await notify.send_existing_delivery(r["id"], r["url"], r["secret"], r["event"], r["payload"])
        except Exception as exc:
            logger.warning("webhook_retry_failed", id=r["id"], error=str(exc))
            await db.schedule_webhook_retry(r["id"], str(exc))
```

- [ ] **Step 2: Add `notify.send_existing_delivery`**

In `notify.py`:

```python
async def send_existing_delivery(
    delivery_id: str, url: str, secret: str, event: str, payload: dict
) -> None:
    """Replay a webhook delivery row. Updates the row on outcome."""
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    ts = str(int(time.time()))
    sig = hmac.new(
        secret.encode(),
        f"{ts}.{body}".encode(),
        hashlib.sha256,
    ).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-JJV-Event": event,
        "X-JJV-Timestamp": ts,
        "X-JJV-Signature": sig,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(url, content=body, headers=headers)
    if 200 <= resp.status_code < 300:
        await db.mark_webhook_succeeded(delivery_id, resp.status_code, resp.text)
    else:
        await db.schedule_webhook_retry(delivery_id, f"HTTP {resp.status_code}: {resp.text[:200]}")
```

- [ ] **Step 3: Inline test**

```bash
cd voice-service && python -c "
import asyncio
import db

async def main():
    # Just exercise the import + sql parse without hitting prod data
    print('schedule_webhook_retry signature:', db.schedule_webhook_retry.__doc__ or 'ok')
    print('fetch_pending_retries signature:', db.fetch_pending_retries.__doc__ or 'ok')

asyncio.run(main())
"
```

- [ ] **Step 4: Commit**

```bash
git add voice-service/server.py voice-service/notify.py
git commit -m "feat(webhooks): APScheduler retry poller (60s interval, 50/batch)"
```

---

## Task 14: Webhook retry UI

**Files:**
- Modify: `dashboard/app/(admin)/webhooks/[id]/page.tsx`
- Modify: `dashboard/app/(admin)/webhooks/actions.ts`

- [ ] **Step 1: Action to retry a delivery**

Append to `dashboard/app/(admin)/webhooks/actions.ts`:

```ts
export async function retryDelivery(deliveryId: string): Promise<void> {
  await requireRole("ADMIN");
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: "RETRY_SCHEDULED", nextAttemptAt: new Date() },
  });
  revalidatePath("/webhooks");
}

export async function replayAllDeadLetters(webhookId: string): Promise<number> {
  await requireRole("ADMIN");
  const r = await prisma.webhookDelivery.updateMany({
    where: { webhookId, status: "DEAD_LETTER" },
    data: { status: "RETRY_SCHEDULED", nextAttemptAt: new Date(), attemptsMade: 0 },
  });
  revalidatePath("/webhooks");
  return r.count;
}
```

(Add `import { requireRole } from "@/lib/auth";` if not present.)

- [ ] **Step 2: Webhook detail page UI**

In `webhooks/[id]/page.tsx`, find the deliveries list. For each row, render a status badge and a "Retry now" button when `status` is `DEAD_LETTER` or `RETRY_SCHEDULED`. Above the list, render a "Replay all dead-lettered (N)" button when N > 0.

```tsx
// At the top of the deliveries section:
{deadLetterCount > 0 && (
  <form action={replayAllDeadLetters.bind(null, webhook.id)}>
    <button className="rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 px-3 py-1.5 text-xs">
      Replay all dead-lettered ({deadLetterCount})
    </button>
  </form>
)}

// Per row:
<form action={retryDelivery.bind(null, d.id)}>
  <button className="text-xs text-violet-300 hover:text-violet-200">
    Retry now
  </button>
</form>
<Badge tone={
  d.status === "SUCCESS" ? "success"
  : d.status === "DEAD_LETTER" ? "danger"
  : d.status === "RETRY_SCHEDULED" ? "warning"
  : "muted"
}>{d.status}</Badge>
```

(Add `deadLetterCount` from a `prisma.webhookDelivery.count({ where: { webhookId, status: "DEAD_LETTER" }})` call.)

- [ ] **Step 3: TS-check + commit**

```bash
cd dashboard && npx tsc --noEmit
git add dashboard/app/\(admin\)/webhooks/
git commit -m "feat(webhooks): retry-now + replay-all-dead-letters UI"
```

---

## Task 15: Idempotency middleware

**Files:**
- Create: `voice-service/idempotency.py`
- Modify: `voice-service/db.py`, `voice-service/server.py`

- [ ] **Step 1: db.py helpers**

Append:

```python
async def get_idempotency(org_id: str, scope: str, key: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT "requestHash", "responseStatus", "responseBody"
             FROM idempotency_keys
             WHERE "organizationId" = $1 AND scope = $2 AND key = $3''',
        org_id, scope, key,
    )
    return dict(row) if row else None


async def record_idempotency(
    org_id: str, scope: str, key: str, request_hash: str,
    response_status: int, response_body: dict,
) -> None:
    pool = await get_pool()
    await pool.execute(
        '''INSERT INTO idempotency_keys
             (id, "organizationId", scope, key, "requestHash",
              "responseStatus", "responseBody", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
           ON CONFLICT ("organizationId", scope, key) DO NOTHING''',
        _cuid(), org_id, scope, key, request_hash,
        response_status, json.dumps(response_body),
    )


async def prune_idempotency_keys() -> int:
    pool = await get_pool()
    r = await pool.execute(
        '''DELETE FROM idempotency_keys
             WHERE "createdAt" < now() - interval '24 hours' '''
    )
    # asyncpg execute returns "DELETE N" string
    return int(r.split()[-1]) if r else 0
```

- [ ] **Step 2: idempotency.py**

```python
# voice-service/idempotency.py
"""Stripe-style Idempotency-Key handling for dispatch endpoints."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import HTTPException, Request

import db


async def check(request: Request, scope: str, org_id: str) -> tuple[str | None, dict | None]:
    """Returns (key, cached_response) tuple.

    - (None, None): no header present, caller proceeds without caching.
    - (key, cached): cached response present, caller returns it as-is.
    - (key, None):    miss; caller proceeds and must call `record(...)` after.
    Raises 422 on key reuse with a different request body.
    """
    key = request.headers.get("Idempotency-Key")
    if not key:
        return None, None
    if len(key) > 128:
        raise HTTPException(400, "Idempotency-Key too long (max 128)")
    body = await request.body()
    body_hash = hashlib.sha256(body).hexdigest()
    existing = await db.get_idempotency(org_id, scope, key)
    if existing:
        if existing["requestHash"] != body_hash:
            raise HTTPException(422, {"error": "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"})
        return key, {
            "status": existing["responseStatus"],
            "body": existing["responseBody"],
        }
    # Stash the body hash on the request for the recorder to use.
    request.state.idempotency_request_hash = body_hash
    return key, None


async def record(
    request: Request, scope: str, org_id: str, key: str,
    response_status: int, response_body: Any,
) -> None:
    body_hash = getattr(request.state, "idempotency_request_hash", "")
    if not body_hash:
        # No-op if we never staged a hash (caller bug); silently skip.
        return
    if isinstance(response_body, str):
        response_body = json.loads(response_body)
    await db.record_idempotency(org_id, scope, key, body_hash, response_status, response_body)
```

- [ ] **Step 3: Wire into dispatch endpoints**

In `server.py`, modify `dispatch_single`:

```python
@app.post("/api/dispatch/single", dependencies=[Depends(require_token)])
async def dispatch_single(request: Request) -> JSONResponse:
    org_id = await _resolve_org_id(request)  # existing; or pull from request.state
    key, cached = await idempotency.check(request, "dispatch.single", org_id)
    if cached:
        resp = JSONResponse(status_code=cached["status"], content=cached["body"])
        resp.headers["Idempotency-Replayed"] = "true"
        return resp
    # ... existing dispatch_single logic, ending with computed `result_body` ...
    if key:
        await idempotency.record(request, "dispatch.single", org_id, key, 200, result_body)
    return JSONResponse(status_code=200, content=result_body)
```

Repeat for `dispatch_bulk` with scope `"dispatch.bulk"`.

(`_resolve_org_id` is shorthand for whatever path currently puts the org id in scope. If `require_token` already sets `request.state.organization_id` for the API-key path, use that; otherwise fall back to a single-org `getDefaultOrg()` equivalent.)

- [ ] **Step 4: Daily prune job**

In the APScheduler init block in `server.py`:

```python
@scheduler.scheduled_job("cron", hour=3, minute=0, id="idempotency_prune", coalesce=True, max_instances=1)
async def prune_idempotency() -> None:
    n = await db.prune_idempotency_keys()
    logger.info("idempotency_pruned", deleted=n)
```

- [ ] **Step 5: Commit**

```bash
git add voice-service/idempotency.py voice-service/db.py voice-service/server.py
git commit -m "feat(api): Idempotency-Key middleware + 24h prune"
```

---

## Task 16: PII redactor

**Files:**
- Create: `voice-service/redactor.py`
- Modify: `voice-service/agent.py`

- [ ] **Step 1: redactor.py**

```python
# voice-service/redactor.py
"""PII redaction for transcript turns.

Returns the redacted text and a flag indicating whether anything matched.
Designed to run on every transcript-message insert with negligible
overhead — all checks are regex-based, no model calls.
"""

from __future__ import annotations

import re

# Credit cards: 13–19 digits with optional spaces/dashes. Luhn-checked
# before redacting to avoid mangling any 16-digit reference number.
_CC = re.compile(r"\b(?:\d[ -]?){12,18}\d\b")
# Aadhaar (India): 12 digits in 4-4-4 form.
_AADHAAR = re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b")
# US SSN: 3-2-4.
_SSN = re.compile(r"\b\d{3}-?\d{2}-?\d{4}\b")
# Email.
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
# Phone: any 10+ digit run with optional separators (we'll skip if it
# matches the call's known from/to numbers — caller responsibility to
# pass those in via `protected_numbers`).
_PHONE = re.compile(r"\+?\d[\d\s\-().]{8,}\d")


def _luhn_ok(digits: str) -> bool:
    s = 0
    parity = len(digits) % 2
    for i, d in enumerate(digits):
        n = int(d)
        if i % 2 == parity:
            n *= 2
            if n > 9:
                n -= 9
        s += n
    return s % 10 == 0


def _mask_cc(match: re.Match) -> str:
    raw = match.group(0)
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 13 or len(digits) > 19 or not _luhn_ok(digits):
        return raw
    return "**** **** **** " + digits[-4:]


def _mask_aadhaar(match: re.Match) -> str:
    return "**** **** ****"


def _mask_ssn(match: re.Match) -> str:
    return "***-**-****"


def _mask_email(match: re.Match) -> str:
    raw = match.group(0)
    at = raw.find("@")
    return "***" + raw[at:]


def redact(text: str, protected_numbers: tuple[str, ...] = ()) -> tuple[str, bool]:
    """Redact PII patterns; return (redacted_text, had_pii).

    `protected_numbers` are phone numbers we should NOT redact (typically
    the call's from/to fields — those are legitimate metadata).
    """
    if not text:
        return text, False
    found = False

    def _phone_repl(match: re.Match) -> str:
        raw = match.group(0)
        digits = re.sub(r"\D", "", raw)
        for p in protected_numbers:
            if not p:
                continue
            if digits.endswith(re.sub(r"\D", "", p)[-10:]):
                return raw
        return "+" + ("*" * (len(digits) - 4)) + digits[-4:]

    out = _CC.sub(_mask_cc, text)
    if out != text:
        found = True

    new = _AADHAAR.sub(_mask_aadhaar, out)
    if new != out:
        found = True
    out = new

    new = _SSN.sub(_mask_ssn, out)
    if new != out:
        found = True
    out = new

    new = _EMAIL.sub(_mask_email, out)
    if new != out:
        found = True
    out = new

    new = _PHONE.sub(_phone_repl, out)
    if new != out:
        found = True
    out = new

    return out, found
```

- [ ] **Step 2: Inline tests**

```bash
cd voice-service && python -c "
from redactor import redact

# Luhn-valid Visa test number
t1, p1 = redact('My card is 4111 1111 1111 1111 thanks')
assert '4111' not in t1 and '1111' in t1, t1
assert p1

# Email
t2, p2 = redact('email me at john.doe@example.com')
assert t2 == 'email me at ***@example.com', t2
assert p2

# Aadhaar
t3, p3 = redact('My Aadhaar is 1234 5678 9012')
assert '1234' not in t3, t3
assert p3

# SSN
t4, p4 = redact('SSN: 123-45-6789')
assert '123' not in t4, t4
assert p4

# Phone (protected number is preserved)
t5, p5 = redact('call me on 9876543210', protected_numbers=('+919876543210',))
assert '9876543210' in t5  # protected
# Phone not in protected list IS redacted
t6, p6 = redact('call me on 9876543210', protected_numbers=())
assert '9876543210' not in t6, t6

# Non-Luhn 16 digits — left alone
t7, p7 = redact('order ref 1234567890123456')
assert '1234567890123456' in t7, t7
assert not p7

print('redactor OK')
"
```

- [ ] **Step 3: agent.py wires redactor on transcript insert**

Find where `agent.py` writes transcript rows (likely a `db.insert_transcript_message` or `agent_tools.append_transcript` call). Replace the content arg path:

```python
import redactor

# Existing call shape (illustrative — match the real one in the codebase):
mode = (await db.get_setting("PII_STORAGE_MODE")) or "redacted_only"
redaction_enabled = profile.get("redaction_enabled", True)
protected_nums = (phone, ctx.room.metadata or "")  # adjust to actual fields
redacted, had_pii = (redactor.redact(content, protected_nums)
                     if redaction_enabled else (content, False))
if redaction_enabled and mode == "redacted_only":
    db_content = redacted
    db_redacted = None
else:
    db_content = content
    db_redacted = redacted if redaction_enabled else None

await db.insert_transcript_message(
    call_id=call_id,
    role=role,
    content=db_content,
    content_redacted=db_redacted,
    has_pii=had_pii,
)
if had_pii:
    await db.mark_call_has_pii(call_id)
```

- [ ] **Step 4: Add db helpers if missing**

In `voice-service/db.py`:

```python
async def insert_transcript_message(
    call_id: str, role: str, content: str,
    content_redacted: str | None, has_pii: bool,
) -> None:
    pool = await get_pool()
    await pool.execute(
        '''INSERT INTO transcript_messages
             (id, "callId", role, content, "contentRedacted", "hasPii", timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, now())''',
        _cuid(), call_id, role, content, content_redacted, has_pii,
    )


async def mark_call_has_pii(call_id: str) -> None:
    pool = await get_pool()
    await pool.execute(
        '''UPDATE calls SET "transcriptHasPii" = true WHERE id = $1''',
        call_id,
    )


async def get_setting(key: str) -> str | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT value FROM settings WHERE key = $1''', key,
    )
    return row["value"] if row else None
```

(If any of these already exist with the same purpose, keep the existing ones and don't duplicate.)

- [ ] **Step 5: Commit**

```bash
git add voice-service/redactor.py voice-service/agent.py voice-service/db.py
git commit -m "feat(privacy): PII redactor — CC/Aadhaar/SSN/email/phone with Luhn check"
```

---

## Task 17: Call detail PII display + admin reveal

**Files:**
- Modify: `dashboard/app/(admin)/calls/[id]/page.tsx`

- [ ] **Step 1: Render redacted by default; toggle for ADMIN+**

```tsx
// Inside the transcript map, replace `m.content` rendering with:
{m.contentRedacted && m.contentRedacted !== m.content ? (
  <span title="Redacted">{m.contentRedacted}</span>
) : (
  m.content
)}

// Above the transcript section, after fetching the user role:
{call.transcriptHasPii && (
  <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-2 text-xs text-amber-200">
    PII detected and redacted in this transcript.
  </div>
)}
```

(Pull the user from the session at the top of the page; gate any "Show raw" UI behind role >= ADMIN. Implementation details: add `import { auth } from "@/lib/auth"`, fetch `session?.user?.email`, query `prisma.user.findUnique` for role.)

- [ ] **Step 2: TS-check + commit**

```bash
cd dashboard && npx tsc --noEmit
git add dashboard/app/\(admin\)/calls/\[id\]/page.tsx
git commit -m "feat(privacy): show redacted transcripts by default; admin reveal"
```

---

## Task 18: PII storage mode setting + DocsContent updates

**Files:**
- Modify: `dashboard/lib/known-settings.ts`
- Modify: `dashboard/components/DocsContent.tsx`

- [ ] **Step 1: Add PII setting**

In `known-settings.ts`, add to the array:

```ts
{
  key: "PII_STORAGE_MODE",
  label: "PII storage mode",
  category: "general",
  sensitive: false,
  type: "text",
  placeholder: "redacted_only",
  description:
    "How transcripts are stored. Values: redacted_only (default — raw discarded), both (raw + redacted, admin can toggle), redacted_persistent_raw_ephemeral (raw nulled after 24h).",
}
```

Also add quiet-hours settings:

```ts
{
  key: "QUIET_HOURS_START",
  label: "Quiet hours — allowed start (HH:MM)",
  category: "general",
  sensitive: false,
  type: "text",
  placeholder: "09:00",
  description: "Earliest local time outbound dispatches are allowed. 24h format.",
},
{
  key: "QUIET_HOURS_END",
  label: "Quiet hours — allowed end (HH:MM)",
  category: "general",
  sensitive: false,
  type: "text",
  placeholder: "21:00",
  description: "Latest local time outbound dispatches are allowed. 24h format. Wrap-around (e.g., 21:00 → 09:00) is supported but inverts the meaning.",
},
{
  key: "QUIET_HOURS_TIMEZONE",
  label: "Quiet hours — timezone",
  category: "general",
  sensitive: false,
  type: "text",
  placeholder: "Asia/Kolkata",
  description: "IANA timezone (default Asia/Kolkata). Per-contact override supported via Contact.timezone.",
}
```

- [ ] **Step 2: Docs sections**

In `DocsContent.tsx`, add a new section to the Sidebar TOC + Section JSX:

```tsx
{ id: "compliance", label: "Compliance", icon: ShieldCheck },
{ id: "idempotency", label: "Idempotency", icon: KeyRound },
```

Compliance section content:

> ### Compliance — DND, quiet hours, recording consent
>
> **DND list.** Add numbers to `/dnd` to block outbound dispatches. Returns 403 BLOCKED_DND on `/api/dispatch/single`; sets `CampaignTarget.status='BLOCKED'` for bulk.
>
> **Quiet hours.** Configured per-org in Settings (QUIET_HOURS_START / _END / _TIMEZONE). Per-contact override via `Contact.timezone`. Returns 429 OUTSIDE_QUIET_HOURS with `next_allowed_at`. Bulk dispatches set `status='DEFERRED'` and the campaign scheduler retries after the timestamp.
>
> **Recording consent.** Configure per-assistant. Plays after `firstMessage` when `recordingEnabled=true`.

Idempotency section content:

> ### Idempotency
>
> Send `Idempotency-Key: <random>` (≤128 chars) on `/api/dispatch/*`. We dedup against the request body hash for 24 h. Same key + same body = the original response with `Idempotency-Replayed: true`. Same key + different body = 422.
>
> ```ts
> const key = crypto.randomUUID();
> await fetch("/api/dispatch/single", {
>   method: "POST",
>   headers: {
>     "Content-Type": "application/json",
>     "Idempotency-Key": key,
>     "Authorization": "Bearer jjv_..."
>   },
>   body: JSON.stringify({ phone, ... })
> });
> ```

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/known-settings.ts dashboard/components/DocsContent.tsx
git commit -m "docs: compliance + idempotency sections; new settings keys registered"
```

---

## Task 19: Role-gate sweep on existing actions

**Files (modify):**
- `dashboard/app/(admin)/assistants/actions.ts`
- `dashboard/app/(admin)/campaigns/actions.ts`
- `dashboard/app/(admin)/contacts/actions.ts`
- `dashboard/app/(admin)/contacts/[phone]/actions.ts`
- `dashboard/app/(admin)/phone-numbers/actions.ts`
- `dashboard/app/(admin)/api-keys/actions.ts`
- `dashboard/app/(admin)/webhooks/actions.ts`
- `dashboard/app/(admin)/tools/actions.ts`
- `dashboard/app/(admin)/calls/actions.ts`
- `dashboard/app/(admin)/calendar/actions.ts`
- `dashboard/app/(admin)/settings/actions.ts`
- `dashboard/app/(admin)/costs/actions.ts`

- [ ] **Step 1: Add `await requireRole(...)` to every mutating server action**

Default roles:
- Create / update / delete on operational data (assistants, campaigns, phone-numbers, tools, webhooks): `ADMIN`.
- Sensitive (api-keys revoke/create, settings, team management): `OWNER` for OWNER-only ops, otherwise `ADMIN`.
- Bookings, contact updates, call notes, run-campaign: `AGENT`.
- Settings.upsertSetting, deleteSetting, revertSettingToEnv: `OWNER`.

Add `import { requireRole } from "@/lib/auth";` at the top and `await requireRole("ADMIN")` (or appropriate level) as the first line of each exported async function.

- [ ] **Step 2: TS-check**

```bash
cd dashboard && npx tsc --noEmit
```

- [ ] **Step 3: Sanity test as VIEWER (manual)**

Create an invite at role VIEWER, accept it, log in. Try to create an assistant — expect a server action error. Confirm reads still work (you can list assistants and view a call).

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/\(admin\)/
git commit -m "feat(auth): role-gate every mutating server action"
```

---

## Task 20: Smoke pack — full end-to-end check

- [ ] **Step 1: Apply all migrations on a clean dev DB**

```bash
cd dashboard
npx prisma migrate reset    # ⚠ destructive — only on dev
```

Expected: all migrations apply cleanly, including the seed of the existing single admin (if there's a seed script).

- [ ] **Step 2: Restart dev server + voice-service**

```bash
cd dashboard && npm run dev &
docker compose build voice-service && docker compose up -d voice-service
```

- [ ] **Step 3: Walk through Tier 0 happy path**

| Capability | Manual test |
|---|---|
| Multi-user | Log in as admin (now OWNER) → /team → invite an AGENT → open invite link in private tab → accept → log in. |
| TCPA — DND | /dnd → add a number → POST `/api/dispatch/single` with that number → expect 403 BLOCKED_DND. |
| TCPA — quiet hours | Set QUIET_HOURS_START=23:00, _END=23:30 → POST dispatch outside that window → expect 429 OUTSIDE_QUIET_HOURS with `next_allowed_at`. |
| Calls filters | /calls?direction=OUTBOUND → only outbound rows; /calls?q=hello → matching rows with highlighted snippets. |
| Webhook retry | Configure a webhook to a URL that returns 500 → trigger an event → see RETRY_SCHEDULED in /webhooks/[id] → wait 60s → see attemptsMade increment. |
| Idempotency | POST /api/dispatch/single with `Idempotency-Key: abc` twice → expect identical response, second has `Idempotency-Replayed: true` header. |
| PII redaction | Place a test call where the customer says "my card is 4111 1111 1111 1111" → /calls/[id] → transcript shows "**** **** **** 1111" with PII pill. |

- [ ] **Step 4: Final commit (no code changes — empty commit acceptable for marker)**

```bash
git commit --allow-empty -m "chore: feature pack 4 — Tier 0 smoke pass"
```

---

## Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Role enforcement misses a server action ⇒ privilege escalation | Task 19 dedicated sweep + grep audit (`grep -L 'requireRole' dashboard/app/\(admin\)/*/actions.ts`) |
| R2 | DND race between dispatch and SIP dial | Re-check in agent.py (Task 8 step 3) |
| R3 | Transcript backfill takes too long | Backfill is manual/CLI only — not auto-run on deploy |
| R4 | Webhook retry storm if receiver down for hours | 5-attempt cap + 12h max delay + dead-letter alert |
| R5 | Idempotency table grows | Daily prune job (Task 15 step 4) + `createdAt` index |
| R6 | Recording-consent disrupts conversation | `allow_interruptions=False` ensures completion; null = skip |
| R7 | Quiet-hours DST edge cases | `zoneinfo` handles DST natively; tested via inline asserts (Task 7 step 3) |
| R8 | SMTP misconfigured silently breaks invites | `sendEmail` returns preview link; UI surfaces it inline |

## Out of scope (Tier 1 follow-up)

- True multi-tenancy (multiple orgs / org switcher)
- SSO (Google / Microsoft / SAML)
- 2FA / TOTP
- Per-org rate limits / per-key quotas
- Distributed tracing across services
- Public REST API + OpenAPI spec
- SDKs (Node, Python)

---

**Plan summary:** 20 tasks, 11 migrations bundled into 2 migrations (one schema, one pg_trgm), zero destructive operations, every change additive. Recommended execution: Subagent-Driven Development, one task at a time with code-review subagent between.
