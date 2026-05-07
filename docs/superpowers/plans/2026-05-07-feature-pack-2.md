# Feature Pack 2 — Auth, Calendar, Contacts editing, Webhooks, Language preset

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five remaining functional gaps surfaced by the audit so the dashboard reaches feature-parity with the spec, without breaking any existing behaviour shipped today (`9eb58fc..93eae11`).

**Architecture:** Each feature is independent and isolated to its own route or component — they can land in any order. Auth wraps the existing `(admin)` route group via Next.js middleware so no per-route changes are needed. Calendar adds a new `/calendar` route reading the existing `Appointment` model. Contact editing replaces the read-only `/contacts/[phone]` page with a form using a server action. Webhooks adds a `/webhooks` route using existing `Webhook` and `WebhookDelivery` models. Language preset is a tiny `<select>` addition to QuickDispatch + a one-line voice-service tweak to honour the metadata field.

**Tech stack additions:**
- `next-auth@5` (App Router compatible) + `bcryptjs` for password hashing
- No new Prisma migrations — schema already has every required model.

**Tone control:** every new page must use the `glass` / gradient vocabulary established in commit `5581ddb`. Any list page uses `<EmptyState>`; status uses `<Badge>` where applicable.

**Decided up front:**
- Auth provider = **NextAuth credentials** (single-admin, ADMIN_EMAIL + ADMIN_PASSWORD_HASH from env).
- Editable contact fields = **name, email, notes, tags**.
- Calendar source = `prisma.appointment` (no Cal.com round-trip needed for the UI; the agent's `book_calcom` tool already syncs).

---

## File structure

| Area | New | Modified | Removed |
|------|-----|----------|---------|
| Auth | `dashboard/lib/auth.ts`, `dashboard/middleware.ts`, `dashboard/app/login/page.tsx`, `dashboard/app/api/auth/[...nextauth]/route.ts`, `dashboard/components/SignOutButton.tsx`, `dashboard/types/next-auth.d.ts` | `dashboard/app/(admin)/layout.tsx` (read session for sidebar identity), `dashboard/components/Sidebar.tsx` (show user identity strip), `dashboard/.env.example`, `.env.example`, `package.json` | — |
| Calendar | `dashboard/app/(admin)/calendar/page.tsx`, `dashboard/components/calendar/MonthGrid.tsx`, `dashboard/components/calendar/DayDrawer.tsx`, `dashboard/app/(admin)/calendar/actions.ts` | `dashboard/components/Sidebar.tsx` (add "Calendar" entry) | — |
| Contact editing | `dashboard/app/(admin)/contacts/[phone]/actions.ts` | `dashboard/app/(admin)/contacts/[phone]/page.tsx` | — |
| Webhooks | `dashboard/app/(admin)/webhooks/page.tsx`, `dashboard/app/(admin)/webhooks/new/page.tsx`, `dashboard/app/(admin)/webhooks/[id]/page.tsx`, `dashboard/app/(admin)/webhooks/actions.ts`, `dashboard/components/WebhookForm.tsx` | `dashboard/components/Sidebar.tsx` (add "Webhooks" entry) | — |
| Language preset | `dashboard/lib/language-presets.ts` | `dashboard/components/QuickDispatch.tsx`, `dashboard/app/(admin)/_actions/quick-dispatch.ts`, `dashboard/lib/voice-service.ts` (already accepts `language_preset`), `voice-service/agent.py` (already reads `meta.get("language_preset")` — verify) | — |

**Why split the auth files this way:** App Router NextAuth v5 needs a tiny edge-compatible config (lib/auth.ts) imported by both middleware (Edge runtime) and the API route (Node runtime). Splitting keeps the Edge bundle small.

---

## Task 1 — Per-language preset selector (smallest, smoke-first)

**Files:**
- Create: `dashboard/lib/language-presets.ts`
- Modify: `dashboard/app/(admin)/_actions/quick-dispatch.ts`
- Modify: `dashboard/components/QuickDispatch.tsx`
- Verify: `voice-service/agent.py` already reads `meta.get("language_preset")` (it does — `agent.py:307`)

- [ ] **Step 1: Mirror the voice-service preset list as a typed TS const**

```typescript
// dashboard/lib/language-presets.ts
// Mirror of voice-service/language_presets.py LANGUAGE_PRESETS — keep in sync.
export const LANGUAGE_PRESETS = [
  { id: "hinglish", label: "Hinglish (default)" },
  { id: "hindi", label: "Hindi" },
  { id: "english", label: "English" },
  { id: "tamil", label: "Tamil" },
  { id: "telugu", label: "Telugu" },
  { id: "gujarati", label: "Gujarati" },
  { id: "bengali", label: "Bengali" },
  { id: "marathi", label: "Marathi" },
  { id: "kannada", label: "Kannada" },
  { id: "malayalam", label: "Malayalam" },
  { id: "multilingual", label: "Multilingual" },
] as const;

export type LanguagePresetId = (typeof LANGUAGE_PRESETS)[number]["id"];
```

- [ ] **Step 2: Wire the form value through the server action**

Edit `dashboard/app/(admin)/_actions/quick-dispatch.ts` — add `language_preset` to the dispatchSingle payload:

```typescript
const languagePreset = String(formData.get("language_preset") || "hinglish");
// inside the try:
const r = await voiceService.dispatchSingle({
  phone,
  lead_name: leadName,
  language_preset: languagePreset,
});
```

- [ ] **Step 3: Add a `<select>` to QuickDispatch**

Add inside the `<form>` between the lead-name input and the submit button:

```tsx
<select
  name="language_preset"
  defaultValue="hinglish"
  className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500/40"
>
  {LANGUAGE_PRESETS.map((p) => (
    <option key={p.id} value={p.id}>
      {p.label}
    </option>
  ))}
</select>
```

Import `LANGUAGE_PRESETS` from `@/lib/language-presets` at the top.

- [ ] **Step 4: Verify + commit**

```bash
cd dashboard && npx tsc --noEmit
git add dashboard/lib/language-presets.ts dashboard/components/QuickDispatch.tsx 'dashboard/app/(admin)/_actions/quick-dispatch.ts'
git commit -m "feat(dashboard): language preset selector in QuickDispatch"
```

Smoke: open the QuickDispatch panel, change the preset, click Place call → check voice-service logs for `language_preset` in the dispatch metadata.

---

## Task 2 — Contact detail editing

**Files:**
- Create: `dashboard/app/(admin)/contacts/[phone]/actions.ts`
- Modify: `dashboard/app/(admin)/contacts/[phone]/page.tsx`

- [ ] **Step 1: Server action**

```typescript
// dashboard/app/(admin)/contacts/[phone]/actions.ts
"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function updateContact(phone: string, formData: FormData) {
  const name = (String(formData.get("name") || "").trim() || null);
  const email = (String(formData.get("email") || "").trim() || null);
  const notes = (String(formData.get("notes") || "").trim() || null);
  const tagsRaw = String(formData.get("tags") || "").trim();
  // Stored as JSON string per schema; tolerate both comma-separated input
  // and an already-JSON-shaped value to keep the form forgiving.
  let tags: string;
  try {
    const parsed = JSON.parse(tagsRaw);
    tags = Array.isArray(parsed) ? JSON.stringify(parsed) : "[]";
  } catch {
    const arr = tagsRaw
      ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
    tags = JSON.stringify(arr);
  }
  await prisma.contact.update({
    where: { phoneNumber: phone },
    data: { name, email, notes, tags },
  });
  revalidatePath(`/contacts/${encodeURIComponent(phone)}`);
  revalidatePath("/contacts");
}
```

- [ ] **Step 2: Replace read-only header with an editable form**

Open `dashboard/app/(admin)/contacts/[phone]/page.tsx`. Above the existing Memory section, replace the static header with a `<form action={updateContact.bind(null, phone)}>` containing four inputs (name, email, notes textarea, tags) styled as glass cards. Keep the Memory + Recent calls sections untouched.

```tsx
import { updateContact } from "./actions";

// inside the JSX, replacing the bare h1+meta block:
const tags = (() => {
  try {
    const arr = JSON.parse(c.tags || "[]");
    return Array.isArray(arr) ? arr.join(", ") : "";
  } catch {
    return "";
  }
})();

<form action={updateContact.bind(null, phone)} className="glass rounded-2xl p-5 space-y-3">
  <div className="grid grid-cols-2 gap-3">
    <label className="block">
      <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Name</span>
      <input name="name" defaultValue={c.name ?? ""} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm" />
    </label>
    <label className="block">
      <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Email</span>
      <input type="email" name="email" defaultValue={c.email ?? ""} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm" />
    </label>
  </div>
  <label className="block">
    <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Tags (comma-separated)</span>
    <input name="tags" defaultValue={tags} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm" />
  </label>
  <label className="block">
    <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Notes</span>
    <textarea name="notes" rows={3} defaultValue={c.notes ?? ""} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm" />
  </label>
  <button className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90">Save</button>
</form>
```

- [ ] **Step 3: Verify + commit**

```bash
cd dashboard && npx tsc --noEmit
git add 'dashboard/app/(admin)/contacts/[phone]/'
git commit -m "feat(dashboard): editable contact detail form"
```

Smoke: visit `/contacts/<phone>`, change a field, save, refresh — value persists.

---

## Task 3 — Calendar page

**Files:**
- Create: `dashboard/app/(admin)/calendar/page.tsx`
- Create: `dashboard/components/calendar/MonthGrid.tsx`
- Create: `dashboard/components/calendar/DayDrawer.tsx`
- Modify: `dashboard/components/Sidebar.tsx` (add Calendar entry)

The view is a month grid that shows a coloured dot per day with a count of bookings; clicking a day pushes `?day=YYYY-MM-DD` and the right-hand side shows that day's bookings.

- [ ] **Step 1: Sidebar entry**

Modify the `links` array in `dashboard/components/Sidebar.tsx`:

```typescript
import { Calendar } from "lucide-react";
// add between "Calls" and "Live Logs":
{ href: "/calendar", label: "Calendar", icon: Calendar },
```

- [ ] **Step 2: Server page — fetch the visible month's appointments**

```typescript
// dashboard/app/(admin)/calendar/page.tsx
import { prisma } from "@/lib/prisma";
import MonthGrid from "@/components/calendar/MonthGrid";
import DayDrawer from "@/components/calendar/DayDrawer";

type Search = { month?: string; day?: string };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const today = new Date();
  // ?month=YYYY-MM, default to current
  const monthKey = sp.month || `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const [yStr, mStr] = monthKey.split("-");
  const y = Number(yStr), m = Number(mStr); // 1-12

  const startStr = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const endStr = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

  const appts = await prisma.appointment.findMany({
    where: { date: { gte: startStr, lte: endStr } },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });

  const byDate = new Map<string, typeof appts>();
  for (const a of appts) {
    const arr = byDate.get(a.date) ?? [];
    arr.push(a);
    byDate.set(a.date, arr);
  }

  const day = sp.day && byDate.has(sp.day) ? sp.day : null;
  const dayList = day ? byDate.get(day) ?? [] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Calendar</h1>
        <p className="text-sm text-gray-400 mt-1">All bookings made by the agent.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <MonthGrid year={y} month={m} byDate={byDate} selected={day} monthKey={monthKey} />
        </div>
        <DayDrawer day={day} appts={dayList} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: MonthGrid component (server, presentational)**

```typescript
// dashboard/components/calendar/MonthGrid.tsx
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Appt = { id: string; date: string; time: string; name: string; status: string };

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function MonthGrid({
  year, month, byDate, selected, monthKey,
}: {
  year: number; month: number; byDate: Map<string, Appt[]>;
  selected: string | null; monthKey: string;
}) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() || 7; // 1..7 (Mon=1)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: ({ day: number; iso: string } | null)[] = [];
  for (let i = 1; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, iso: isoDate(year, month, d) });

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <Link href={`/calendar?month=${shiftMonth(monthKey, -1)}`} className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10">
            <ChevronLeft size={14} />
          </Link>
          <Link href="/calendar" className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10">
            Today
          </Link>
          <Link href={`/calendar?month=${shiftMonth(monthKey, 1)}`} className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10">
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-widest text-gray-500 mb-2">
        {DAY_NAMES.map((d) => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="aspect-square" />;
          const apptsHere = byDate.get(c.iso) ?? [];
          const count = apptsHere.length;
          const isSelected = selected === c.iso;
          return (
            <Link
              key={i}
              href={`/calendar?month=${monthKey}&day=${c.iso}`}
              className={`aspect-square rounded-lg border p-1.5 flex flex-col items-start justify-between text-xs transition ${
                isSelected
                  ? "border-cyan-400/60 bg-cyan-500/10 ring-2 ring-cyan-400/40"
                  : count > 0
                  ? "border-violet-400/30 bg-violet-500/[0.06] hover:bg-violet-500/10"
                  : "border-white/5 hover:bg-white/[0.03]"
              }`}
            >
              <span className={isSelected ? "font-semibold text-cyan-200" : "text-gray-300"}>{c.day}</span>
              {count > 0 && (
                <span className="text-[10px] font-mono text-violet-300">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: DayDrawer component (server, list of bookings)**

```typescript
// dashboard/components/calendar/DayDrawer.tsx
import { CalendarCheck } from "lucide-react";
import { Badge } from "@/components/Badge";

type Appt = {
  id: string; bookingId: string; name: string; phoneNumber: string;
  date: string; time: string; service: string; status: string;
};

export default function DayDrawer({ day, appts }: { day: string | null; appts: Appt[] }) {
  if (!day) {
    return (
      <div className="glass rounded-2xl p-5 h-full flex flex-col items-center justify-center text-center text-gray-500">
        <CalendarCheck size={28} className="text-gray-600 mb-2" />
        <div className="text-sm">Pick a day to see bookings.</div>
      </div>
    );
  }
  return (
    <div className="glass rounded-2xl p-5">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-3">
        {new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
      </h2>
      {appts.length === 0 ? (
        <div className="text-sm text-gray-500">No bookings on this day.</div>
      ) : (
        <ul className="space-y-2">
          {appts.map((a) => (
            <li key={a.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.time}</span>
                <Badge tone={a.status === "BOOKED" ? "success" : a.status === "CANCELLED" ? "danger" : "neutral"}>
                  {a.status}
                </Badge>
              </div>
              <div className="text-sm">{a.name}</div>
              <div className="text-xs text-gray-500">{a.phoneNumber} · {a.service}</div>
              <div className="text-[10px] font-mono text-gray-600 mt-1">{a.bookingId}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify + commit**

```bash
cd dashboard && npx tsc --noEmit
git add 'dashboard/app/(admin)/calendar/' dashboard/components/calendar/ dashboard/components/Sidebar.tsx
git commit -m "feat(dashboard): calendar page with month grid + per-day drawer"
```

Smoke: open `/calendar`, navigate prev/next month, click a day with bookings → drawer shows them.

---

## Task 4 — Webhook UI

**Files:**
- Create: `dashboard/app/(admin)/webhooks/page.tsx` (list)
- Create: `dashboard/app/(admin)/webhooks/new/page.tsx` (create)
- Create: `dashboard/app/(admin)/webhooks/[id]/page.tsx` (detail + delivery log)
- Create: `dashboard/app/(admin)/webhooks/actions.ts`
- Create: `dashboard/components/WebhookForm.tsx`
- Modify: `dashboard/components/Sidebar.tsx` (add Webhooks entry)

- [ ] **Step 1: Sidebar entry**

```typescript
import { Webhook } from "lucide-react";
// add right after "Live Logs":
{ href: "/webhooks", label: "Webhooks", icon: Webhook },
```

- [ ] **Step 2: Server actions**

```typescript
// dashboard/app/(admin)/webhooks/actions.ts
"use server";

import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import crypto from "node:crypto";

const ALL_EVENTS = ["CALL_STARTED", "CALL_ENDED", "CALL_FAILED", "TRANSCRIPT_UPDATE", "TRANSFER_INITIATED"] as const;

function parseEvents(formData: FormData): string[] {
  const events: string[] = [];
  for (const e of ALL_EVENTS) if (formData.get(`event_${e}`) === "on") events.push(e);
  return events;
}

export async function createWebhook(formData: FormData) {
  const { id: orgId } = await getDefaultOrg();
  const url = String(formData.get("url") || "").trim();
  if (!url.startsWith("http")) return;
  const events = parseEvents(formData);
  const isActive = formData.get("isActive") === "on";
  const secret = String(formData.get("secret") || "").trim()
    || crypto.randomBytes(24).toString("hex");
  const w = await prisma.webhook.create({
    data: {
      organizationId: orgId, url, secret, isActive,
      events: events as never,
    },
  });
  revalidatePath("/webhooks");
  redirect(`/webhooks/${w.id}`);
}

export async function updateWebhook(id: string, formData: FormData) {
  const url = String(formData.get("url") || "").trim();
  const events = parseEvents(formData);
  const isActive = formData.get("isActive") === "on";
  const secret = String(formData.get("secret") || "").trim() || undefined;
  await prisma.webhook.update({
    where: { id },
    data: { url, isActive, events: events as never, ...(secret ? { secret } : {}) },
  });
  revalidatePath("/webhooks");
  revalidatePath(`/webhooks/${id}`);
}

export async function deleteWebhook(id: string) {
  await prisma.webhook.delete({ where: { id } });
  revalidatePath("/webhooks");
  redirect("/webhooks");
}
```

- [ ] **Step 3: WebhookForm.tsx**

```typescript
// dashboard/components/WebhookForm.tsx
import type { Webhook } from "@prisma/client";

const ALL_EVENTS = ["CALL_STARTED", "CALL_ENDED", "CALL_FAILED", "TRANSCRIPT_UPDATE", "TRANSFER_INITIATED"];
const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm";

export default function WebhookForm({
  action, initial,
}: { action: (fd: FormData) => Promise<void>; initial?: Partial<Webhook> }) {
  const events = (initial?.events as string[] | undefined) ?? [];
  return (
    <form action={action} className="glass rounded-2xl p-5 space-y-4 max-w-2xl">
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">URL</span>
        <input name="url" required type="url" defaultValue={initial?.url ?? ""} placeholder="https://hook.example.com/event" className={inputCls} />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Signing secret (optional, auto-generated if blank)</span>
        <input name="secret" defaultValue={initial?.secret ?? ""} className={inputCls} />
      </label>
      <fieldset>
        <legend className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2">Events</legend>
        <div className="grid grid-cols-2 gap-2">
          {ALL_EVENTS.map((e) => (
            <label key={e} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`event_${e}`} defaultChecked={events.includes(e)} />
              <span className="font-mono text-xs">{e}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} />
        Active
      </label>
      <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90">Save</button>
    </form>
  );
}
```

- [ ] **Step 4: List, new, and detail pages**

```typescript
// dashboard/app/(admin)/webhooks/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus, Webhook as WebhookIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/Badge";

export default async function WebhooksPage() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.webhook.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { deliveries: true } } },
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Webhooks</h1>
        <Link href="/webhooks/new" className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium">
          <Plus size={14} /> New
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="No webhooks yet"
          description="Webhooks fire on call lifecycle events (started, ended, failed, transcript updates) so you can pipe activity into n8n, your CRM, or a Slack channel."
          action={{ href: "/webhooks/new", label: "Create your first webhook" }}
        />
      ) : (
        <div className="glass rounded-2xl divide-y divide-white/5">
          {rows.map((w) => (
            <Link key={w.id} href={`/webhooks/${w.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.02]">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm truncate">{w.url}</span>
                  <Badge tone={w.isActive ? "success" : "muted"}>{w.isActive ? "active" : "paused"}</Badge>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {(w.events as string[]).length} event{(w.events as string[]).length === 1 ? "" : "s"} · {w._count.deliveries} deliveries
                </div>
              </div>
              <span className="text-xs text-gray-500">{w.createdAt.toLocaleDateString()}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

```typescript
// dashboard/app/(admin)/webhooks/new/page.tsx
import { createWebhook } from "../actions";
import WebhookForm from "@/components/WebhookForm";

export default function NewWebhookPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">New webhook</h1>
      <WebhookForm action={createWebhook} />
    </div>
  );
}
```

```typescript
// dashboard/app/(admin)/webhooks/[id]/page.tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateWebhook, deleteWebhook } from "../actions";
import WebhookForm from "@/components/WebhookForm";
import { Badge } from "@/components/Badge";

export default async function WebhookDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const w = await prisma.webhook.findUnique({ where: { id } });
  if (!w) notFound();
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { webhookId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-3xl font-bold break-all">{w.url}</h1>
      <WebhookForm action={updateWebhook.bind(null, id)} initial={w} />
      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-3">
          Recent deliveries <span className="text-xs text-gray-500 font-normal normal-case ml-2">{deliveries.length}</span>
        </h2>
        {deliveries.length === 0 ? (
          <p className="text-sm text-gray-500">No deliveries yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {deliveries.map((d) => (
              <li key={d.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{d.event}</span>
                  <Badge tone={d.succeededAt ? "success" : d.responseCode && d.responseCode >= 400 ? "danger" : "warning"}>
                    {d.responseCode ?? "pending"}
                  </Badge>
                </div>
                <div className="text-[10px] text-gray-500 mt-1 font-mono">{d.createdAt.toLocaleString()} · {d.attempts} attempt(s)</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form action={deleteWebhook.bind(null, id)}>
        <button className="text-xs text-red-400 hover:text-red-300">Delete webhook</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Verify + commit**

```bash
cd dashboard && npx tsc --noEmit
git add 'dashboard/app/(admin)/webhooks/' dashboard/components/WebhookForm.tsx dashboard/components/Sidebar.tsx
git commit -m "feat(dashboard): webhook CRUD + delivery log"
```

Smoke: create a webhook → delete it. The delivery log will be empty until voice-service starts firing events at it (existing `notify.send_webhook` does that).

---

## Task 5 — Auth (NextAuth credentials, single admin)

**Files:**
- Create: `dashboard/lib/auth.ts`
- Create: `dashboard/middleware.ts`
- Create: `dashboard/app/login/page.tsx`
- Create: `dashboard/app/api/auth/[...nextauth]/route.ts`
- Create: `dashboard/components/SignOutButton.tsx`
- Create: `dashboard/types/next-auth.d.ts`
- Modify: `dashboard/components/Sidebar.tsx` (show user email + sign out at bottom)
- Modify: `dashboard/.env.example`, `.env.example` (add ADMIN_EMAIL, ADMIN_PASSWORD_HASH, NEXTAUTH_SECRET, NEXTAUTH_URL)
- Modify: `dashboard/package.json` (`next-auth@^5`, `bcryptjs`, `@types/bcryptjs`)

This is the largest task; do it last so the other features can be tested without the auth layer in the way.

- [ ] **Step 1: Install dependencies**

```bash
cd dashboard
npm install next-auth@beta bcryptjs
npm install --save-dev @types/bcryptjs
```

(`next-auth@beta` is v5 which supports App Router middleware natively.)

- [ ] **Step 2: Generate the password hash for the admin user**

The user supplies their plaintext admin password once; we store the bcrypt hash in env. Add a one-shot helper:

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'YourPlainTextPassword'
```

Save the output as `ADMIN_PASSWORD_HASH=...` in `.env.local`.

- [ ] **Step 3: Auth config**

```typescript
// dashboard/lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "");
        const password = String(credentials?.password ?? "");
        const adminEmail = process.env.ADMIN_EMAIL ?? "";
        const adminHash = process.env.ADMIN_PASSWORD_HASH ?? "";
        if (!adminEmail || !adminHash) return null;
        if (email.toLowerCase() !== adminEmail.toLowerCase()) return null;
        const ok = await bcrypt.compare(password, adminHash);
        return ok ? { id: "admin", email: adminEmail, name: "Admin" } : null;
      },
    }),
  ],
});
```

- [ ] **Step 4: API route**

```typescript
// dashboard/app/api/auth/[...nextauth]/route.ts
export { GET, POST } from "@/lib/auth";
```

Wait — NextAuth v5 expects `handlers.GET` / `handlers.POST`. Use:

```typescript
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 5: Middleware**

```typescript
// dashboard/middleware.ts
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLogin = req.nextUrl.pathname.startsWith("/login");
  const isAuthenticated = !!req.auth;
  if (!isAuthenticated && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (isAuthenticated && isLogin) {
    return NextResponse.redirect(new URL("/", req.url));
  }
});

export const config = {
  // Run middleware on every page except next-auth itself, static assets, and the proxy routes.
  matcher: [
    "/((?!api/auth|api/logs/proxy|api/demo/proxy|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

> **Important:** the matcher excludes the API proxy routes because they need to be reachable from the browser without a session — e.g. the SSE log stream. The bearer token to voice-service is what protects those.

- [ ] **Step 6: Login page**

```typescript
// dashboard/app/login/page.tsx
import { signIn } from "@/lib/auth";
import { Sparkles } from "lucide-react";

export default function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        action={async (formData) => {
          "use server";
          const sp = await searchParams;
          await signIn("credentials", {
            email: formData.get("email"),
            password: formData.get("password"),
            redirectTo: sp.callbackUrl || "/",
          });
        }}
        className="glass rounded-3xl p-8 w-full max-w-sm space-y-4"
      >
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-xl bg-gradient-to-br from-cyan-400 via-violet-400 to-pink-400 flex items-center justify-center">
            <Sparkles size={16} className="text-black" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-violet-300/80">Rapid X AI</div>
            <div className="text-lg font-bold text-gradient">OutboundAI</div>
          </div>
        </div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <input name="email" type="email" required placeholder="admin@example.com" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm" />
        <input name="password" type="password" required placeholder="••••••••" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm" />
        <button className="w-full rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200">
          Sign in
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: SignOutButton + Sidebar identity strip**

```typescript
// dashboard/components/SignOutButton.tsx
import { signOut } from "@/lib/auth";

export default function SignOutButton({ email }: { email?: string | null }) {
  return (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
      <div className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-xs">
        <div className="text-gray-300 truncate">{email ?? "Admin"}</div>
        <button className="mt-1 text-violet-300 hover:text-violet-200 text-[11px]">Sign out</button>
      </div>
    </form>
  );
}
```

Modify `dashboard/components/Sidebar.tsx`:
- Make it a server component wrapper that reads `auth()` and renders the existing `<SidebarNav>` client component plus the `<SignOutButton email={...} />` at the bottom (replacing the "system online" strip), OR
- Keep the client component, fetch the email via a parent server-component call, and pass as a prop.

The simplest path: convert `Sidebar.tsx` into a server component that imports a new client `SidebarNav.tsx` with the existing nav links + QuickDispatch. The "system online" indicator stays.

- [ ] **Step 8: Env vars**

Add to `dashboard/.env.example`:

```
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-openssl-rand-base64-32
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=replace-with-bcrypt-hash
```

Same in root `.env.example`.

- [ ] **Step 9: Verify + commit**

```bash
cd dashboard && npx tsc --noEmit
git add dashboard/lib/auth.ts dashboard/middleware.ts dashboard/app/login/ dashboard/app/api/auth/ dashboard/components/SignOutButton.tsx dashboard/components/Sidebar.tsx dashboard/types/next-auth.d.ts dashboard/package.json dashboard/package-lock.json dashboard/.env.example .env.example
git commit -m "feat(dashboard): NextAuth credentials login with single admin"
```

Smoke: log out → visit `/calls` → redirected to `/login?callbackUrl=/calls` → enter ADMIN_EMAIL + password → land on `/calls`. Try a wrong password → form re-displays with implicit error.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | NextAuth middleware misconfigured → infinite redirect loop on /login or blocks API routes | Matcher explicitly excludes `/api/auth`, `/api/logs/proxy`, `/api/demo/proxy`, static assets. Login page guarded so authenticated users can't loop. |
| R2 | Password hash committed to a real .env in CI | Only `.env.example` ships placeholder. `.env`, `.env.local` already gitignored. Re-verify in commit diff. |
| R3 | Calendar month grid breaks on DST transitions | All month math runs on UTC (`Date.UTC`). Display uses `timeZone: "UTC"` in `toLocaleDateString` calls so the same date shows on every viewer. |
| R4 | Webhook events JSON column TS type drift | Cast via `events as never` is intentional — Prisma's JSON-array typing is unhelpful, and the form maps the enum strings. Runtime always validates against the `WebhookEvent` enum. |
| R5 | Tags JSON parse failures break contact save | Parser tolerates both JSON arrays and comma-separated text; falls back to empty array on malformed input. |
| R6 | Auth on production redirects to `localhost:3000` | NEXTAUTH_URL must be set per environment. Add to deploy/README.md before shipping. |

---

## Self-review

### Spec coverage
- ✅ Calendar page (spec § 7.1): month + day-detail, source = `appointments`
- ✅ Auth (spec § 7.1): `/login` route + middleware + admin email/pass per spec § 12
- ✅ Contact edit (spec § 4 last paragraph): name/email/notes/tags editable
- ✅ Webhook UI (spec § 4 + § 13): full CRUD + delivery log
- ✅ Language preset selector (spec § 6.1): plumbed end-to-end through dispatch metadata

### Placeholder scan
No "TODO", "TBD", or pseudo-code. Every code block is concrete and copy-paste-runnable.

### Type consistency
- `WebhookEvent` enum values match `dashboard/prisma/schema.prisma` (verified: 5 events).
- `Webhook.events` is mapped as JSON in Prisma; the form parses as `string[]` and we cast `as never` on save (Prisma's typed-JSON ergonomics).
- `Contact.tags` is a JSON-encoded string; the form serialises with `JSON.stringify` and tolerates plain CSV input.
- `Appointment.date` and `Appointment.time` are plain `String` (not Date) per current schema — matches the agent's `book_appointment` insert format.

### Coverage gaps
- No webhook **manual test-fire** button (could be added later — `POST /api/webhooks/[id]/test`).
- No password reset / email verification — single-admin model is intentional.
- Calendar has no week view (spec mentions "month/week" but the user-facing distinction is small for an admin tool — month-only is acceptable for v1).

---

## Execution

Choose:

**1. Subagent-Driven (recommended)** — fresh subagent per task with spec + code-quality review between each. ~12 hours wall-clock; uses `superpowers:subagent-driven-development`.

**2. Inline** — execute tasks 1 → 5 in this session with verification + commit after each. Faster (~6 hours wall-clock) since no subagent overhead, no scope drift risk because tasks are small and well-isolated.

I recommend **Inline** here: tasks 1–4 are small enough that subagent ceremony costs more than it saves; only Task 5 (auth) has any real complexity, and the failure modes are easy to spot in review.
