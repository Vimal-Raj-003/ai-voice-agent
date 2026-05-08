# Feature Pack 4 — Industrial-grade Tier 0 — Design

**Date:** 2026-05-08
**Status:** Approved (single-org-multi-user scope, all six items bundled)
**Goal:** Lift Jilljill Voice from "internal tool" to "industrial-grade, ready-to-sell" by closing six Tier 0 gaps from the platform audit.
**Hard constraint:** Zero behavior change to anything that already works. Every change is additive — new columns are nullable or have defaults, new tables are net-new, new endpoints take optional headers, new UI gates are role-checked with `OWNER` as the existing single admin.

## Architecture summary

Six independent capabilities, one bundled spec because they all reuse the same auth/role/migration substrate.

```
┌───────────────────────────┐    ┌──────────────────────────┐
│ Dashboard (Next.js)       │    │ Voice-service (FastAPI)  │
│  /team   /dnd   /calls    │    │  /api/dispatch/*         │
│  Filters · Pagination     │    │  + Idempotency middleware│
│  Role gates · Invites     │    │  + DND/quiet-hours guard │
└──────────┬────────────────┘    │  + Webhook retry poller  │
           │                     │  + Transcript redactor   │
           │  Prisma             └──────────┬───────────────┘
           ▼                                ▼
┌──────────────────────────────────────────────────────────┐
│ Postgres (Neon)                                          │
│  + Invite, PasswordResetToken, DndNumber, IdempotencyKey │
│  + extended Org, Assistant, Call, TranscriptMessage,     │
│    WebhookDelivery                                       │
│  + pg_trgm GIN index on transcript_messages.content      │
└──────────────────────────────────────────────────────────┘
```

Six concerns, each isolated:
- **Tenancy** lives in `lib/auth.ts` + new `requireRole` helper. Existing single-admin keeps working with `role=OWNER` auto-applied via one-time data migration.
- **TCPA** lives in two files: `voice-service/compliance.py` (DND check, quiet-hours check) and dashboard `/dnd` page.
- **Calls UX** lives in `dashboard/app/(admin)/calls/` — pure additive `searchParams` parsing + new `CallsFilters` client component.
- **Webhook reliability** lives in voice-service: existing `notify.py` gains a retry-aware variant; new APScheduler job polls and replays.
- **Idempotency** is a single FastAPI dependency wired into the two dispatch endpoints.
- **PII redaction** is `voice-service/redactor.py`, called from `agent.py` on every transcript-message insert. UI shows redacted by default; admin can reveal raw.

---

## 1. Multi-user (single org)

### Schema
```prisma
enum UserRole {
  OWNER
  ADMIN
  AGENT
  VIEWER
}

model User {
  // existing fields preserved
  role UserRole @default(VIEWER)        // CHANGE: typed enum, default VIEWER
  isActive Boolean @default(true)        // NEW
  invitedBy String?                      // NEW (User.id)
  lastLoginAt DateTime?                  // NEW
}

model Invite {
  id           String   @id @default(cuid())
  organizationId String
  email        String
  role         UserRole
  tokenHash    String   @unique          // SHA-256(token)
  invitedBy    String                    // User.id
  expiresAt    DateTime                  // 72h after creation
  acceptedAt   DateTime?
  createdAt    DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([email])
  @@map("invites")
}

model PasswordResetToken {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime                    // 1h after creation
  usedAt    DateTime?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("password_reset_tokens")
}
```

**Data migration:** the existing single admin row's `role` becomes `OWNER`. Code path: `UPDATE users SET role='OWNER' WHERE role='admin' OR role IS NULL OR role='member'`.

### Authorization helper

```ts
// lib/auth.ts
export type Role = "OWNER" | "ADMIN" | "AGENT" | "VIEWER";
const RANK: Record<Role, number> = { VIEWER: 0, AGENT: 1, ADMIN: 2, OWNER: 3 };
export async function requireRole(min: Role): Promise<{ user: User }> {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }});
  if (!user?.isActive) throw new Error("INACTIVE");
  if (RANK[user.role as Role] < RANK[min]) throw new Error("FORBIDDEN");
  return { user };
}
```

Wrapped around mutations in server actions; reads stay open to authenticated users.

### Email transport

`lib/email.ts` wraps nodemailer with SMTP env vars. When SMTP is not configured, `sendEmail` returns the link payload to the caller and the UI surfaces it inline ("Email not configured — copy this link to send manually"). This preserves the single-admin happy path.

### UI

- `/team` page (OWNER/ADMIN): list, invite (modal), change role (Select), deactivate. Pagination via `?page=`.
- `/login` gets a "Forgot password?" link → `/forgot-password` page.
- `/reset-password/[token]` page validates token (constant-time hash compare), accepts new password.
- `/accept-invite/[token]` page accepts the invite and creates the User row with the role from the invite.
- Sidebar: "Team" entry, gated to OWNER/ADMIN.

### Acceptance criteria
- Existing admin keeps full access without any user action.
- A new invitee can complete sign-up entirely from the email link without an existing dashboard session.
- Role enforcement: a VIEWER cannot create assistants, campaigns, tools, phone numbers, api keys, webhooks, or invites; AGENT can do all of those except invite/role-change/team management.

---

## 2. TCPA compliance

### Schema
```prisma
model DndNumber {
  id            String   @id @default(cuid())
  organizationId String
  phoneE164     String                   // normalized E.164
  reason        String?                  // optional context
  source        DndSource                // see enum below
  addedBy       String?                  // User.id (null when self-service)
  createdAt     DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, phoneE164])
  @@index([organizationId])
  @@map("dnd_numbers")
}

enum DndSource {
  MANUAL
  CALLER_REQUEST     // agent recorded an opt-out
  CSV_IMPORT
  WEBHOOK            // external CRM pushed
}

model Organization {
  // existing fields preserved
  quietHoursStart    String?  @default("09:00")    // "HH:MM" 24h, caller-local
  quietHoursEnd      String?  @default("21:00")
  quietHoursTimezone String   @default("Asia/Kolkata")
  recordingDefaultConsentMessage String? @default("This call may be recorded for quality and training purposes.")
}

model Contact {
  // existing fields preserved
  timezone String?         // optional override; falls back to org default
}

model Assistant {
  // existing fields preserved
  recordingConsentMessage String?    // null = no prompt (existing behavior)
}

enum CampaignTargetStatus {
  PENDING
  DISPATCHED
  COMPLETED
  FAILED
  BLOCKED                 // NEW — on DND list
  DEFERRED                // NEW — outside quiet hours, retry at dispatchAfter
}

model CampaignTarget {
  // existing fields preserved
  dispatchAfter DateTime?    // NEW
}

enum CallOutcome {
  // existing values preserved
  OPT_OUT                  // NEW
}
```

### voice-service compliance check

```python
# voice-service/compliance.py
async def check_dispatch_allowed(org_id: str, phone_e164: str, contact_tz: str | None) -> Result:
    if await db.is_on_dnd(org_id, phone_e164):
        return Result(allowed=False, reason="DND", code=403)
    org = await db.get_org(org_id)
    tz = contact_tz or org.quiet_hours_timezone
    local_now = datetime.now(zoneinfo.ZoneInfo(tz))
    if not _in_window(local_now.time(), org.quiet_hours_start, org.quiet_hours_end):
        return Result(
            allowed=False, reason="OUTSIDE_QUIET_HOURS", code=429,
            next_allowed=_next_allowed(local_now, org)
        )
    return Result(allowed=True)
```

Wired into `dispatch_single` and `dispatch_bulk`. On `BLOCKED`, return 403 with body `{"error": "BLOCKED_DND"}`. On `OUTSIDE_QUIET_HOURS`, return 429 with body `{"error": "OUTSIDE_QUIET_HOURS", "next_allowed_at": "..."}`. CampaignTarget rows get `status=BLOCKED` or `status=DEFERRED, dispatchAfter=<next>`.

The campaign scheduler picks deferred targets back up via `WHERE status='DEFERRED' AND dispatchAfter <= now()`.

### Recording-consent prompt

`agent.py` after `firstMessage`:
```python
consent = profile.get("recording_consent_message")
if profile.get("recording_enabled") and consent:
    await session.say(consent, allow_interruptions=False)
```

Existing assistants have `recordingConsentMessage=null` ⇒ no prompt ⇒ unchanged behavior. New assistants get the org-wide default (settable in `/settings`).

### UI

- New `/dnd` page: list, add (single phone), CSV import, CSV export, remove (with reason capture). OWNER/ADMIN only.
- Settings tab gets quiet-hours fields under a new "Compliance" category.
- AssistantForm gets a "Recording consent message" textarea (tooltip explains 11-state US two-party consent and India guidelines).
- Campaign target rows in /campaigns/[id] show the new statuses with explanatory pills.

### Acceptance criteria
- A dispatch to a DND number returns 403, no LiveKit room is created, no SIP cost is incurred.
- A campaign run at 11 PM IST defers all targets without making any calls; at 9 AM IST they fire.
- Toggling `recordingEnabled` off bypasses the consent prompt regardless of the message field.

---

## 3. Calls table — filters, pagination, transcript search

### Migration

```sql
-- 20260508_add_pg_trgm_transcript_index.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transcript_content_trgm
  ON transcript_messages USING gin (content gin_trgm_ops);
```

### Server-side query

`/calls/page.tsx` reads `searchParams`:
- `q` — substring/trigram match on transcript_messages.content
- `direction`, `status`, `outcome`, `assistantId` — exact match
- `from`, `to` — ISO date range
- `page` (default 1), `pageSize` (default 25, max 100)
- `sort` — `createdAt` (default) | `duration` | `outcome`

When all params are absent, behavior matches today's page exactly.

Transcript search uses raw SQL (Prisma can't compose trigram operators):
```sql
SELECT DISTINCT call_id FROM transcript_messages
WHERE content % $1
ORDER BY similarity(content, $1) DESC
LIMIT 200
```
Then loads the calls via Prisma. For each match, the page also returns the highest-similarity transcript snippet to render under the row.

### Frontend

- `CallsFilters.tsx` — client component above the table. URL-driven via `useRouter().replace(...)`.
- Filter chips: Direction, Status, Outcome (each a Select); Assistant (typeahead if >10), date range (two date inputs).
- Search box: debounced 250ms, hits same `?q=` param.
- Pagination: prev / page numbers / next at the bottom. URL-driven.
- Active-filter pills above the table with × to remove individual filters; "Clear all" when ≥2 active.
- Transcript snippet preview: when `q` is present and matches, render a `<mark>`-highlighted snippet under each call.

### Acceptance criteria
- `/calls` with no params renders identically to today.
- `/calls?q=refund` returns only calls whose transcript matches "refund" (trigram), with highlighted snippets.
- `/calls?direction=INBOUND&status=COMPLETED&from=2026-05-01&to=2026-05-08&page=2` paginates correctly.
- p95 query time < 500ms with 100k transcript_messages rows.

---

## 4. Webhook retry + dead-letter

### Schema

```prisma
enum WebhookDeliveryStatus {
  PENDING
  SUCCESS
  RETRY_SCHEDULED
  DEAD_LETTER
}

model WebhookDelivery {
  // existing fields preserved
  status         WebhookDeliveryStatus @default(PENDING)   // NEW
  attemptsMade   Int                   @default(0)         // RENAME from `attempts`
  nextAttemptAt  DateTime?                                  // NEW
  lastError      String?               @db.Text            // NEW
}
```

Migration handles the rename via `ALTER TABLE webhook_deliveries RENAME COLUMN attempts TO "attemptsMade"`. The current schema has `attempts Int @default(1)` so the rename is straightforward; default value preserved.

### Retry schedule

5 attempts at: `+1m, +5m, +30m, +2h, +12h` (exponential). After the 5th failure → `DEAD_LETTER` and a Telegram alert via existing `notify.py`.

### Background poller

```python
# voice-service/server.py — APScheduler job
@scheduler.scheduled_job("interval", seconds=60, id="webhook_retry_poll", coalesce=True, max_instances=1)
async def poll_webhook_retries() -> None:
    pool = await db.get_pool()
    rows = await pool.fetch(
        '''SELECT id, "webhookId", url, secret, event, payload, "attemptsMade"
           FROM webhook_deliveries
           WHERE status = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= now()
           ORDER BY "nextAttemptAt" ASC
           LIMIT 50
           FOR UPDATE SKIP LOCKED'''
    )
    for r in rows:
        await _retry_delivery(r)
```

`_retry_delivery` invokes `notify.send_signed_webhook`, increments `attemptsMade`, and either sets `status=SUCCESS` on 2xx or schedules the next `nextAttemptAt` from the table below. After attempt 5 fails → `status=DEAD_LETTER`.

### UI

- `/webhooks/[id]` detail page (already shows delivery list) gets:
  - Status badge per row.
  - "Retry now" button per row → sets `nextAttemptAt=now()`, re-queues.
  - "Replay all dead-lettered" bulk action at top of the list.
- `/webhooks` (list) shows count of dead-lettered deliveries with a red dot.

### Acceptance criteria
- A webhook URL returning 500 gets retried 5 times before dead-lettering.
- A webhook URL returning 2xx on the second attempt is marked SUCCESS, no further retries.
- Manual "Retry now" on a dead-lettered delivery re-attempts and updates status.

---

## 5. Idempotency keys

### Schema

```prisma
model IdempotencyKey {
  id             String   @id @default(cuid())
  organizationId String
  scope          String                              // "dispatch.single" | "dispatch.bulk"
  key            String                              // client-supplied
  requestHash    String                              // SHA-256 of canonical request body
  responseStatus Int
  responseBody   Json
  createdAt      DateTime @default(now())

  @@unique([organizationId, scope, key])
  @@index([createdAt])                                // for prune job
  @@map("idempotency_keys")
}
```

### Middleware

```python
# voice-service/idempotency.py
async def idempotency(request: Request, scope: str) -> tuple[str | None, dict | None]:
    key = request.headers.get("Idempotency-Key")
    if not key:
        return None, None
    body = await request.body()
    body_hash = hashlib.sha256(body).hexdigest()
    org_id = request.state.organization_id  # set by require_token
    existing = await db.get_idempotency(org_id, scope, key)
    if existing:
        if existing["requestHash"] != body_hash:
            raise HTTPException(422, {"error": "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"})
        return key, existing  # caller returns cached response
    return key, None
```

After the handler finishes, `record_idempotency(org_id, scope, key, body_hash, status, response)` stores the result.

### Prune job

Daily APScheduler job: `DELETE FROM idempotency_keys WHERE "createdAt" < now() - interval '24 hours'`.

### Header semantics (Stripe-style)

- Header name: `Idempotency-Key` (any opaque string, ≤128 chars).
- Window: 24h.
- Same key + same body → cached response with `Idempotency-Replayed: true` header.
- Same key + different body → 422.
- Missing header → no caching, today's behavior.

### UI

DocsContent gains an "Idempotency" subsection in API Reference with a Node example using `crypto.randomUUID()`.

### Acceptance criteria
- Two identical POSTs to `/api/dispatch/single` with the same `Idempotency-Key` produce one dispatch and two identical 200 responses.
- A POST without the header behaves exactly as today.

---

## 6. PII redaction in transcripts

### Schema

```prisma
model TranscriptMessage {
  // existing fields preserved (`content` stays — that's the raw)
  contentRedacted String? @db.Text         // NEW
  hasPii          Boolean @default(false)  // NEW
}

model Call {
  // existing fields preserved
  transcriptHasPii Boolean @default(false) // NEW (rolled-up flag)
}

model Assistant {
  // existing fields preserved
  redactionEnabled Boolean @default(true)  // NEW; existing assistants get true via migration default
}
```

### Redactor

```python
# voice-service/redactor.py
def redact(text: str) -> tuple[str, bool]:
    """Return (redacted_text, had_pii)."""
    found = False
    out = text
    out, n = _redact_credit_cards(out); found |= n > 0
    out, n = _redact_aadhaar(out);     found |= n > 0
    out, n = _redact_ssn(out);          found |= n > 0
    out, n = _redact_email(out);        found |= n > 0
    out, n = _redact_phone(out);        found |= n > 0
    return out, found
```

Patterns:
- **Credit cards**: 13-19 digits, optional spaces/dashes; verify Luhn checksum before redacting; replace with `**** **** **** 1234`.
- **Aadhaar**: 12 digits in `\d{4}\s?\d{4}\s?\d{4}` form; redact full → `**** **** ****`.
- **SSN**: `\d{3}-?\d{2}-?\d{4}`; full redact → `***-**-****`.
- **Email**: standard regex; redact local part → `***@example.com`.
- **Phone**: redact only patterns *not* matching the call's `from`/`to` numbers (those are legit metadata).

### Storage policy (env-driven)

`PII_STORAGE_MODE` (env or `setting.PII_STORAGE_MODE`):
- `redacted_only` (default) — `content` set to redacted text, no raw retained.
- `both` — `content` keeps raw, `contentRedacted` is computed and stored.
- `redacted_persistent_raw_ephemeral` — both written, daily job nullifies `content` for messages older than 24h.

### Insert path

`agent.py` after each transcript turn:
```python
redacted, had_pii = redactor.redact(turn_text)
mode = settings_cache.get("PII_STORAGE_MODE", "redacted_only")
if mode == "redacted_only":
    content = redacted
    content_redacted = None
else:
    content = turn_text
    content_redacted = redacted
await db.insert_transcript(call_id, role, content, content_redacted, had_pii)
if had_pii:
    await db.mark_call_has_pii(call_id)
```

### Backfill migration

Batched job in `voice-service/migrations/redact_existing_transcripts.py`. Reads in chunks of 1000, runs redactor, sets `contentRedacted` and `hasPii`. Idempotent — re-runnable. Triggered manually via a new CLI command, not auto-run on deploy.

### UI

Call detail page (`calls/[id]/page.tsx`):
- Default render uses `contentRedacted` if not null, else `content`.
- If raw is available (mode=`both` or `redacted_persistent_raw_ephemeral` and message age <24h) AND user role >= ADMIN, show a "Show raw" toggle. Server-side guard via `requireRole("ADMIN")` on the toggle action.
- A small "PII detected" pill on rows where `hasPii=true`.

AssistantForm: redaction-enabled toggle (defaults true).

### Acceptance criteria
- A turn containing `"My card is 4111 1111 1111 1111"` is stored as `"My card is **** **** **** 1111"` with `hasPii=true`.
- Existing transcript rows render unchanged in the UI until the backfill script is run.
- A VIEWER cannot reveal raw transcripts even when raw is stored.

---

## Migrations summary

| # | Operation | File |
|---|---|---|
| 1 | New table `Invite` | `prisma/migrations/<ts>_add_invites/` |
| 2 | New table `PasswordResetToken` | (same migration) |
| 3 | `User` adds `isActive`, `invitedBy`, `lastLoginAt`; `role` becomes `UserRole` enum with default `VIEWER`; data migration to set existing users to `OWNER` | `prisma/migrations/<ts>_user_roles/` |
| 4 | New table `DndNumber` + enum `DndSource` | `prisma/migrations/<ts>_add_dnd/` |
| 5 | `Organization` adds quiet-hours + recordingDefaultConsentMessage | (same migration) |
| 6 | `Contact.timezone`, `Assistant.recordingConsentMessage`, `Assistant.redactionEnabled` | `prisma/migrations/<ts>_compliance_fields/` |
| 7 | `CampaignTargetStatus` adds `BLOCKED, DEFERRED`; `CallOutcome` adds `OPT_OUT`; `CampaignTarget.dispatchAfter` | (same migration) |
| 8 | `pg_trgm` extension + GIN index on `transcript_messages.content` | `prisma/migrations/<ts>_transcript_search/` (raw SQL) |
| 9 | `WebhookDelivery` rename `attempts` → `attemptsMade`, add `status` enum, `nextAttemptAt`, `lastError` | `prisma/migrations/<ts>_webhook_retry/` |
| 10 | New table `IdempotencyKey` | `prisma/migrations/<ts>_idempotency/` |
| 11 | `TranscriptMessage` adds `contentRedacted`, `hasPii`; `Call.transcriptHasPii` | `prisma/migrations/<ts>_pii_redaction/` |

All migrations are forward-only additions or default-applied changes. Rolling back any one is safe (drop the new column / table / enum value).

## Files touched (summary)

**New files:**
- `dashboard/app/(admin)/team/{page.tsx, actions.ts, new/page.tsx, [id]/page.tsx}`
- `dashboard/app/(admin)/dnd/{page.tsx, actions.ts, new/page.tsx}`
- `dashboard/app/forgot-password/page.tsx`, `dashboard/app/reset-password/[token]/page.tsx`, `dashboard/app/accept-invite/[token]/page.tsx`
- `dashboard/components/{TeamForm.tsx, DndForm.tsx, CallsFilters.tsx}`
- `dashboard/lib/{email.ts, phone.ts}`
- `voice-service/{compliance.py, idempotency.py, redactor.py}`

**Modified files:**
- `dashboard/lib/auth.ts` — adds `requireRole`, role types
- `dashboard/app/(admin)/calls/page.tsx` — searchParams, filters, pagination, snippets
- `dashboard/app/(admin)/webhooks/[id]/page.tsx` — retry/replay UI
- `dashboard/app/(admin)/assistants/actions.ts` — recording consent + redaction toggle
- `dashboard/components/{AssistantForm.tsx, SidebarNav.tsx, DocsContent.tsx, SettingRow.tsx}`
- `dashboard/lib/known-settings.ts` — quiet-hours, PII_STORAGE_MODE
- `voice-service/{server.py, agent.py, db.py, notify.py}`
- All actions.ts files in admin pages: wrap mutations in `requireRole`

## Out of scope (explicit)
- True multi-tenancy (multiple orgs) — Tier 1
- SSO (Google/Microsoft/SAML) — Tier 1
- 2FA — Tier 1
- Per-org rate limits / per-key quotas — Tier 1
- Distributed tracing — Tier 1

## Risks & mitigations
| # | Risk | Mitigation |
|---|---|---|
| R1 | Role enforcement misses a server action ⇒ privilege escalation | Audit all `actions.ts` in PR review; add a unit test that imports each `actions.ts` and asserts every exported async function calls `requireRole` |
| R2 | DND check race: contact added to DND between dispatch decision and call placement | Re-check DND inside `agent.entrypoint` before SIP dial; abort with `outcome=OPT_OUT` if hit |
| R3 | Transcript backfill takes too long on large DBs | Batched with explicit chunk size, pause-able, idempotent, manually triggered via CLI not auto-run |
| R4 | Webhook retry storm if the receiver is down for hours | 5-attempt cap with exponential backoff; dead-letter alerts admins; "Pause webhook" toggle on the webhook row |
| R5 | Idempotency table grows unbounded | Daily prune job; `createdAt` index for fast scan |
| R6 | Recording-consent prompt disrupts conversational flow | Optional per-assistant; defaults off for existing assistants; the prompt is short and `allow_interruptions=False` ensures it completes |
| R7 | Quiet-hours timezone math edge cases (DST, midnight wrap-around) | Use `zoneinfo` (Python stdlib), test cases for: DST-spring, DST-fall, midnight-spanning windows (e.g., "21:00 → 09:00" wraps over midnight) |
| R8 | Email transport not configured ⇒ invites/resets fail silently | `sendEmail` returns the link inline; UI surfaces it; logs a WARNING |

## Acceptance for the pack
- [ ] Existing single-admin can sign in and use every existing feature unchanged
- [ ] All 11 migrations apply forward and roll back cleanly
- [ ] No existing route returns a different status code or response shape than before
- [ ] Each of the 6 capabilities passes its acceptance criteria above
- [ ] `npx tsc --noEmit` clean; `python -m py_compile` clean on changed Python files
- [ ] Smoke test: a complete inbound call + outbound dispatch + webhook delivery + transcript view works after the migration
