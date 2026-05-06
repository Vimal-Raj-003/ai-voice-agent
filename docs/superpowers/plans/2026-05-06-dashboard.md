# OutboundAI Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing two-component landing page with a full Vapi-style admin dashboard that drives the OutboundAI voice service through its REST API and reads/writes the same NeonDB tables via Prisma.

**Architecture:** Next.js 16 App Router (React 19 Server Components + Server Actions). Dashboard reads NeonDB through Prisma directly, writes call dispatches through the Python voice-service REST API at `${VOICE_SERVICE_URL}` with `Authorization: Bearer ${VOICE_SERVICE_TOKEN}`. LiveKit JWTs for the browser demo are minted by the voice-service `/api/demo/token` endpoint, never in the Node process. Tailwind v4 styling.

**Tech stack:** Next.js 16.1.6, React 19.2.3, Prisma 6, livekit-client 2.17, livekit-server-sdk (kept for browser-side imports only), Tailwind v4, lucide-react. Server Actions for all mutations. Single shared admin session (no per-user auth in this plan — Plan 3 covers that).

---

## Phase 7 — Foundations

### Task 7.1: Voice-service proxy client

**Files:**
- Create: `dashboard/lib/voice-service.ts`

- [ ] **Step 1: Write the proxy client**

```typescript
// dashboard/lib/voice-service.ts
const URL_BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

type FetchOpts = Omit<RequestInit, "body"> & { body?: unknown };

async function call<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set("Content-Type", "application/json");
  if (TOKEN) headers.set("Authorization", `Bearer ${TOKEN}`);
  const r = await fetch(`${URL_BASE}${path}`, {
    ...opts,
    headers,
    body: opts.body == null ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`voice-service ${path} -> ${r.status} ${txt.slice(0, 200)}`);
  }
  return r.json() as Promise<T>;
}

export const voiceService = {
  health: () => call<{ status: string }>(`/health`),
  dispatchSingle: (body: {
    phone: string;
    agent_profile_id?: string;
    lead_name?: string;
    business_name?: string;
    service_type?: string;
    campaign_id?: string;
    language_preset?: string;
  }) => call<{ status: string; dispatch_id: string; room: string; phone: string }>(
    `/api/dispatch/single`,
    { method: "POST", body },
  ),
  dispatchBulk: (body: {
    contacts: Array<{ phone: string; lead_name?: string; business_name?: string; service_type?: string }>;
    delay_seconds?: number;
    agent_profile_id?: string;
    campaign_id?: string;
  }) => call<{ batch_id: string; total: number; results: Array<{ phone: string; status: string; dispatch_id?: string; room?: string; message?: string }> }>(
    `/api/dispatch/bulk`,
    { method: "POST", body },
  ),
  demoToken: () => call<{ token: string; room: string; url: string }>(`/api/demo/token`, { method: "POST" }),
  campaignRunNow: (id: string) => call<{ status: string; campaign_id: string }>(
    `/api/campaigns/${id}/run-now`,
    { method: "POST" },
  ),
  campaignSchedulerReload: () => call<{ status: string }>(`/api/campaigns/scheduler/reload`, { method: "POST" }),
  campaignSchedulerStatus: () => call<{ running: boolean; jobs: Array<{ id: string; next_run: string | null }> }>(`/api/campaigns/scheduler/status`),
};
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/lib/voice-service.ts
git commit -m "feat(dashboard): typed voice-service REST proxy client"
```

---

### Task 7.2: Default organization helper

**Files:**
- Create: `dashboard/lib/org.ts`
- Modify: `dashboard/prisma/seed.ts` (add Organization seed if missing)

- [ ] **Step 1: Write helper**

The Call/Campaign/CampaignTarget/AgentProfile/Tool models all require `organizationId`. For Plan 2 we use a single fixed org until multi-tenant comes in Plan 3.

```typescript
// dashboard/lib/org.ts
import { prisma } from "./prisma";

const DEFAULT_SLUG = "default";
const DEFAULT_NAME = "Default Organization";

let cached: { id: string } | null = null;

export async function getDefaultOrg(): Promise<{ id: string }> {
  if (cached) return cached;
  const existing = await prisma.organization.findUnique({ where: { slug: DEFAULT_SLUG } });
  if (existing) {
    cached = { id: existing.id };
    return cached;
  }
  const created = await prisma.organization.create({
    data: { name: DEFAULT_NAME, slug: DEFAULT_SLUG },
  });
  cached = { id: created.id };
  return cached;
}
```

- [ ] **Step 2: Update seed.ts to upsert the default org idempotently and write the resolved id to `Setting`**

Add this block to the existing `prisma/seed.ts` `main()` function (before the AgentProfile seed):

```typescript
const org = await prisma.organization.upsert({
  where: { slug: "default" },
  update: {},
  create: { name: "Default Organization", slug: "default" },
});
await prisma.setting.upsert({
  where: { key: "DEFAULT_ORG_ID" },
  update: { value: org.id },
  create: { key: "DEFAULT_ORG_ID", value: org.id },
});
console.log("Seeded default org:", org.id);
```

- [ ] **Step 3: Run seed + commit**

```bash
cd dashboard && npx prisma db seed
git add dashboard/lib/org.ts dashboard/prisma/seed.ts
git commit -m "feat(dashboard): default org helper + seed wires DEFAULT_ORG_ID setting"
```

Expected: seed prints `Seeded default org: <cuid>`; the voice-service can now read `DEFAULT_ORG_ID` from the `settings` table.

---

### Task 7.3: Sidebar layout shell

**Files:**
- Modify: `dashboard/app/layout.tsx`
- Create: `dashboard/components/Sidebar.tsx`
- Create: `dashboard/app/(admin)/layout.tsx`

- [ ] **Step 1: Sidebar component**

```typescript
// dashboard/components/Sidebar.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Bot, Users, Megaphone, PhoneCall, Activity, Settings, Sparkles,
} from "lucide-react";

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assistants", label: "Assistants", icon: Bot },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/live-logs", label: "Live Logs", icon: Activity },
  { href: "/demo", label: "Demo", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-white/5 bg-black/40 backdrop-blur p-4 flex flex-col gap-1">
      <div className="px-3 py-4">
        <div className="text-xs uppercase tracking-widest text-purple-300/70">Rapid X AI</div>
        <div className="text-lg font-bold">OutboundAI</div>
      </div>
      {links.map(({ href, label, icon: Icon }) => {
        const active = path === href || (href !== "/" && path.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
              active ? "bg-white/10 text-white" : "text-gray-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </aside>
  );
}
```

- [ ] **Step 2: Move existing landing page into the admin layout**

Create `dashboard/app/(admin)/layout.tsx`:

```typescript
import Sidebar from "@/components/Sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#050505] text-white flex">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">{children}</div>
      </main>
    </div>
  );
}
```

Move the existing `dashboard/app/page.tsx` into `dashboard/app/(admin)/page.tsx` as the Overview page (rename file, keep content; update component imports to relative paths if needed). Drop the ambient background/light divs since the sidebar layout owns the chrome now — replace the `<main>` outer wrapper with a fragment.

The new `dashboard/app/(admin)/page.tsx` should be a server component that fetches summary stats:

```typescript
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";

export default async function Overview() {
  const { id: orgId } = await getDefaultOrg();
  const [callCount, bookedCount, assistantCount, activeCampaigns] = await Promise.all([
    prisma.call.count({ where: { organizationId: orgId } }),
    prisma.call.count({ where: { organizationId: orgId, wasBooked: true } }),
    prisma.assistant.count({ where: { organizationId: orgId } }),
    prisma.campaign.count({ where: { organizationId: orgId, status: "RUNNING" } }),
  ]);
  const stats = [
    { label: "Total calls", value: callCount },
    { label: "Bookings", value: bookedCount },
    { label: "Assistants", value: assistantCount },
    { label: "Running campaigns", value: activeCampaigns },
  ];
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Overview</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs text-gray-400 uppercase tracking-wide">{s.label}</div>
            <div className="mt-2 text-3xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Trim root layout**

Open `dashboard/app/layout.tsx`. Keep `<html>`, `<body>` and metadata; strip any landing-page-specific styling (the (admin) layout owns chrome). Verify globals.css still imports.

- [ ] **Step 4: Commit**

```bash
git add dashboard/components/Sidebar.tsx dashboard/app/(admin)/ dashboard/app/layout.tsx dashboard/app/page.module.css
git rm -f dashboard/app/page.tsx 2>/dev/null || true
git commit -m "feat(dashboard): sidebar layout + Overview page"
```

If `dashboard/app/page.module.css` is unused after the move, also delete it.

Smoke: `cd dashboard && npm run dev` then open http://localhost:3000 — sidebar visible, overview shows 0/0/0/0 (or seeded numbers).

---

## Phase 8 — CRUD pages

### Task 8.1: Assistants CRUD

**Files:**
- Create: `dashboard/app/(admin)/assistants/page.tsx`
- Create: `dashboard/app/(admin)/assistants/new/page.tsx`
- Create: `dashboard/app/(admin)/assistants/[id]/page.tsx`
- Create: `dashboard/app/(admin)/assistants/actions.ts`
- Create: `dashboard/components/AssistantForm.tsx`

The `Assistant` model from Prisma covers system prompt, model, voice, temperature etc. Confirm the field list from `dashboard/prisma/schema.prisma` (model `Assistant`).

- [ ] **Step 1: Server actions**

```typescript
// dashboard/app/(admin)/assistants/actions.ts
"use server";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createAssistant(formData: FormData) {
  const { id: orgId } = await getDefaultOrg();
  const a = await prisma.assistant.create({
    data: {
      organizationId: orgId,
      name: String(formData.get("name") || "New Assistant"),
      systemPrompt: String(formData.get("systemPrompt") || ""),
      llmProvider: (String(formData.get("llmProvider") || "OPENAI") as any),
      llmModel: String(formData.get("llmModel") || "gpt-4o-mini"),
      ttsProvider: (String(formData.get("ttsProvider") || "OPENAI") as any),
      ttsVoice: String(formData.get("ttsVoice") || "alloy"),
      sttProvider: (String(formData.get("sttProvider") || "DEEPGRAM") as any),
      firstMessage: String(formData.get("firstMessage") || ""),
    },
  });
  revalidatePath("/assistants");
  redirect(`/assistants/${a.id}`);
}

export async function updateAssistant(id: string, formData: FormData) {
  await prisma.assistant.update({
    where: { id },
    data: {
      name: String(formData.get("name") || "Untitled"),
      systemPrompt: String(formData.get("systemPrompt") || ""),
      llmProvider: (String(formData.get("llmProvider") || "OPENAI") as any),
      llmModel: String(formData.get("llmModel") || "gpt-4o-mini"),
      ttsProvider: (String(formData.get("ttsProvider") || "OPENAI") as any),
      ttsVoice: String(formData.get("ttsVoice") || "alloy"),
      sttProvider: (String(formData.get("sttProvider") || "DEEPGRAM") as any),
      firstMessage: String(formData.get("firstMessage") || ""),
    },
  });
  revalidatePath("/assistants");
  revalidatePath(`/assistants/${id}`);
}

export async function deleteAssistant(id: string) {
  await prisma.assistant.delete({ where: { id } });
  revalidatePath("/assistants");
  redirect("/assistants");
}
```

(Adjust enum cast typing once the codegen output is read; `as any` keeps TS off the critical path.)

- [ ] **Step 2: List page**

```typescript
// dashboard/app/(admin)/assistants/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus } from "lucide-react";

export default async function AssistantsPage() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.assistant.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Assistants</h1>
        <Link href="/assistants/new" className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium hover:opacity-90">
          <Plus size={14} /> New
        </Link>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {rows.length === 0 && <div className="p-6 text-gray-500">No assistants yet.</div>}
        {rows.map((a) => (
          <Link key={a.id} href={`/assistants/${a.id}`} className="flex items-center justify-between p-4 hover:bg-white/[0.02]">
            <div>
              <div className="font-medium">{a.name}</div>
              <div className="text-xs text-gray-500">{a.llmProvider}/{a.llmModel} · TTS {a.ttsProvider}/{a.ttsVoice}</div>
            </div>
            <span className="text-xs text-gray-500">{a.updatedAt.toLocaleString()}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: New page (uses AssistantForm)**

```typescript
// dashboard/app/(admin)/assistants/new/page.tsx
import { createAssistant } from "../actions";
import AssistantForm from "@/components/AssistantForm";

export default function NewAssistantPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">New assistant</h1>
      <AssistantForm action={createAssistant} />
    </div>
  );
}
```

- [ ] **Step 4: Edit page + delete**

```typescript
// dashboard/app/(admin)/assistants/[id]/page.tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateAssistant, deleteAssistant } from "../actions";
import AssistantForm from "@/components/AssistantForm";

export default async function AssistantDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const a = await prisma.assistant.findUnique({ where: { id } });
  if (!a) notFound();
  const update = updateAssistant.bind(null, id);
  const remove = deleteAssistant.bind(null, id);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{a.name}</h1>
      <AssistantForm action={update} initial={a} />
      <form action={remove}>
        <button className="text-sm text-red-400 hover:text-red-300">Delete assistant</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Form component**

```typescript
// dashboard/components/AssistantForm.tsx
import type { Assistant } from "@prisma/client";

type Props = {
  action: (formData: FormData) => Promise<void>;
  initial?: Partial<Assistant>;
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="block text-xs uppercase tracking-wide text-gray-400 mb-1">{label}</span>
    {children}
  </label>
);
const inputCls = "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40";

export default function AssistantForm({ action, initial }: Props) {
  return (
    <form action={action} className="space-y-4 max-w-2xl">
      <Field label="Name">
        <input name="name" required defaultValue={initial?.name} className={inputCls} />
      </Field>
      <Field label="First message (greeting)">
        <input name="firstMessage" defaultValue={initial?.firstMessage ?? ""} className={inputCls} />
      </Field>
      <Field label="System prompt">
        <textarea name="systemPrompt" rows={10} defaultValue={initial?.systemPrompt ?? ""} className={inputCls + " font-mono"} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="LLM provider">
          <select name="llmProvider" defaultValue={initial?.llmProvider ?? "OPENAI"} className={inputCls}>
            {["OPENAI","GROQ","OPENROUTER","ANTHROPIC","CUSTOM"].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="LLM model">
          <input name="llmModel" defaultValue={initial?.llmModel ?? "gpt-4o-mini"} className={inputCls} />
        </Field>
        <Field label="TTS provider">
          <select name="ttsProvider" defaultValue={initial?.ttsProvider ?? "OPENAI"} className={inputCls}>
            {["OPENAI","DEEPGRAM","SARVAM","CARTESIA","ELEVENLABS"].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="TTS voice">
          <input name="ttsVoice" defaultValue={initial?.ttsVoice ?? "alloy"} className={inputCls} />
        </Field>
        <Field label="STT provider">
          <select name="sttProvider" defaultValue={initial?.sttProvider ?? "DEEPGRAM"} className={inputCls}>
            {["DEEPGRAM","OPENAI","SARVAM"].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
      </div>
      <button className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:opacity-90">Save</button>
    </form>
  );
}
```

- [ ] **Step 6: Build + commit**

```bash
cd dashboard && npx tsc --noEmit
git add dashboard/app/(admin)/assistants dashboard/components/AssistantForm.tsx
git commit -m "feat(dashboard): assistants CRUD"
```

If the Prisma schema field names differ from the assumptions above (e.g. `systemPrompt` is `instructions`), adapt the form + actions to match. Read `dashboard/prisma/schema.prisma` `model Assistant` first.

---

### Task 8.2: Campaigns CRUD + run-now + targets upload

**Files:**
- Create: `dashboard/app/(admin)/campaigns/page.tsx`
- Create: `dashboard/app/(admin)/campaigns/new/page.tsx`
- Create: `dashboard/app/(admin)/campaigns/[id]/page.tsx`
- Create: `dashboard/app/(admin)/campaigns/actions.ts`
- Create: `dashboard/components/CampaignForm.tsx`
- Create: `dashboard/components/TargetsUploader.tsx`

- [ ] **Step 1: Actions**

```typescript
// dashboard/app/(admin)/campaigns/actions.ts
"use server";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { voiceService } from "@/lib/voice-service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createCampaign(formData: FormData) {
  const { id: orgId } = await getDefaultOrg();
  const c = await prisma.campaign.create({
    data: {
      organizationId: orgId,
      assistantId: (formData.get("assistantId") as string) || null,
      name: String(formData.get("name") || "New campaign"),
      prompt: String(formData.get("prompt") || ""),
      callDelaySeconds: Number(formData.get("callDelaySeconds") || 3),
      scheduleType: (formData.get("scheduleType") as string || "ONCE") as any,
      scheduleTime: String(formData.get("scheduleTime") || "10:00"),
      agentProfileId: (formData.get("agentProfileId") as string) || null,
    },
  });
  revalidatePath("/campaigns");
  redirect(`/campaigns/${c.id}`);
}

export async function updateCampaign(id: string, formData: FormData) {
  await prisma.campaign.update({
    where: { id },
    data: {
      assistantId: (formData.get("assistantId") as string) || null,
      name: String(formData.get("name") || ""),
      prompt: String(formData.get("prompt") || ""),
      callDelaySeconds: Number(formData.get("callDelaySeconds") || 3),
      scheduleType: (formData.get("scheduleType") as string || "ONCE") as any,
      scheduleTime: String(formData.get("scheduleTime") || "10:00"),
      status: (formData.get("status") as string || "DRAFT") as any,
      agentProfileId: (formData.get("agentProfileId") as string) || null,
    },
  });
  await voiceService.campaignSchedulerReload();
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}

export async function deleteCampaign(id: string) {
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export async function runCampaignNow(id: string) {
  await voiceService.campaignRunNow(id);
  revalidatePath(`/campaigns/${id}`);
}

export async function uploadTargets(id: string, formData: FormData) {
  const csv = String(formData.get("csv") || "").trim();
  if (!csv) return;
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("phone");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = dataLines.map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    return { phone: cols[0] || "", lead_name: cols[1] || null };
  }).filter((r) => r.phone.startsWith("+"));
  if (rows.length === 0) return;
  await prisma.campaignTarget.createMany({
    data: rows.map((r) => ({ campaignId: id, phoneNumber: r.phone, leadName: r.lead_name ?? undefined })),
    skipDuplicates: true,
  });
  await prisma.campaign.update({
    where: { id },
    data: { totalTargets: { increment: rows.length } },
  });
  revalidatePath(`/campaigns/${id}`);
}
```

- [ ] **Step 2: List page**

```typescript
// dashboard/app/(admin)/campaigns/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus } from "lucide-react";

export default async function CampaignsPage() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.campaign.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { targets: true } } },
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Campaigns</h1>
        <Link href="/campaigns/new" className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium">
          <Plus size={14} /> New
        </Link>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {rows.length === 0 && <div className="p-6 text-gray-500">No campaigns yet.</div>}
        {rows.map((c) => (
          <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center justify-between p-4 hover:bg-white/[0.02]">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-gray-500">{c.status} · {c._count.targets} targets · {c.scheduleType ?? "—"} {c.scheduleTime ?? ""}</div>
            </div>
            <span className="text-xs text-gray-500">{c.dispatchedTargets}/{c.totalTargets} dispatched</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: New + detail page + form + uploader**

`new/page.tsx` mirrors the assistants new page, calling `createCampaign`. `[id]/page.tsx` shows `CampaignForm` (with status/scheduleType/scheduleTime selects), the target list, the `TargetsUploader`, and a "Run now" button calling `runCampaignNow`.

```typescript
// dashboard/components/CampaignForm.tsx
import type { Campaign, Assistant } from "@prisma/client";

const inputCls = "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm";
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block"><span className="block text-xs uppercase tracking-wide text-gray-400 mb-1">{label}</span>{children}</label>
);

export default function CampaignForm({
  action, assistants, initial,
}: { action: (fd: FormData) => Promise<void>; assistants: Assistant[]; initial?: Partial<Campaign> }) {
  return (
    <form action={action} className="space-y-4 max-w-2xl">
      <Field label="Name"><input name="name" required defaultValue={initial?.name} className={inputCls} /></Field>
      <Field label="Assistant">
        <select name="assistantId" defaultValue={initial?.assistantId ?? ""} className={inputCls}>
          <option value="">— None —</option>
          {assistants.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Prompt override"><textarea name="prompt" rows={4} defaultValue={initial?.prompt ?? ""} className={inputCls} /></Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Status">
          <select name="status" defaultValue={initial?.status ?? "DRAFT"} className={inputCls}>
            {["DRAFT","RUNNING","PAUSED","COMPLETED","FAILED"].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Schedule">
          <select name="scheduleType" defaultValue={initial?.scheduleType ?? "ONCE"} className={inputCls}>
            {["ONCE","DAILY","WEEKDAYS"].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Schedule time (HH:MM IST)">
          <input name="scheduleTime" defaultValue={initial?.scheduleTime ?? "10:00"} className={inputCls} />
        </Field>
        <Field label="Call delay (s)">
          <input type="number" min={0} name="callDelaySeconds" defaultValue={initial?.callDelaySeconds ?? 3} className={inputCls} />
        </Field>
        <Field label="Agent profile id">
          <input name="agentProfileId" defaultValue={initial?.agentProfileId ?? ""} className={inputCls} />
        </Field>
      </div>
      <button className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium">Save</button>
    </form>
  );
}
```

```typescript
// dashboard/components/TargetsUploader.tsx
"use client";
import { useState, useTransition } from "react";

export default function TargetsUploader({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("csv", text);
        start(() => action(fd).then(() => setText("")));
      }}
      className="space-y-3"
    >
      <textarea
        rows={6}
        placeholder={"phone,lead_name\n+919876543210,Ravi"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 font-mono text-xs"
      />
      <button disabled={pending || !text.trim()} className="rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50">
        {pending ? "Uploading…" : "Upload targets"}
      </button>
    </form>
  );
}
```

In `[id]/page.tsx`, fetch assistants + campaign + targets list; pass `uploadTargets.bind(null, id)` to `TargetsUploader`. Show a "Run now" button that calls `runCampaignNow.bind(null, id)` via a one-line server-action `<form>`.

- [ ] **Step 4: Build + commit**

```bash
cd dashboard && npx tsc --noEmit
git add dashboard/app/(admin)/campaigns dashboard/components/CampaignForm.tsx dashboard/components/TargetsUploader.tsx
git commit -m "feat(dashboard): campaigns CRUD + targets uploader + run-now"
```

---

### Task 8.3: Contacts list + memory view

**Files:**
- Create: `dashboard/app/(admin)/contacts/page.tsx`
- Create: `dashboard/app/(admin)/contacts/[phone]/page.tsx`
- Create: `dashboard/app/(admin)/contacts/actions.ts`

- [ ] **Step 1: Actions + pages**

The Contact / ContactMemory tables are snake_case (`phone_number`, `created_at`). Prisma will use whatever field names are mapped in `schema.prisma`. Read the schema first to confirm field names — adjust the queries to match.

```typescript
// dashboard/app/(admin)/contacts/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function ContactsPage() {
  const rows = await prisma.contact.findMany({
    orderBy: { lastCallAt: "desc" },
    take: 200,
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Contacts</h1>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {rows.length === 0 && <div className="p-6 text-gray-500">No contacts yet.</div>}
        {rows.map((c) => (
          <Link key={c.phoneNumber} href={`/contacts/${encodeURIComponent(c.phoneNumber)}`} className="flex items-center justify-between p-4 hover:bg-white/[0.02]">
            <div>
              <div className="font-medium">{c.name || c.phoneNumber}</div>
              <div className="text-xs text-gray-500">{c.phoneNumber} · {c.totalCalls} calls · {c.lastOutcome ?? "—"}</div>
            </div>
            {c.isBooked && <span className="text-xs text-green-400">Booked</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

```typescript
// dashboard/app/(admin)/contacts/[phone]/page.tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function ContactDetail({ params }: { params: Promise<{ phone: string }> }) {
  const { phone: rawPhone } = await params;
  const phone = decodeURIComponent(rawPhone);
  const c = await prisma.contact.findUnique({ where: { phoneNumber: phone } });
  if (!c) notFound();
  const memories = await prisma.contactMemory.findMany({
    where: { phoneNumber: phone },
    orderBy: { createdAt: "desc" },
  });
  const calls = await prisma.call.findMany({
    where: { OR: [{ toNumber: phone }, { fromNumber: phone }] },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{c.name || c.phoneNumber}</h1>
        <div className="text-sm text-gray-500">{c.phoneNumber} · {c.totalCalls} calls · last outcome {c.lastOutcome ?? "—"}</div>
      </div>
      <section>
        <h2 className="text-lg font-semibold mb-2">Memory</h2>
        <ul className="space-y-2">
          {memories.length === 0 && <li className="text-gray-500 text-sm">No memory yet.</li>}
          {memories.map((m) => (
            <li key={m.id} className="rounded-lg bg-white/5 border border-white/10 p-3 text-sm">
              <div className="text-xs text-gray-500 mb-1">{m.createdAt.toLocaleString()}</div>
              {m.insight}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-2">Recent calls</h2>
        <ul className="space-y-1 text-sm">
          {calls.map((cc) => (
            <li key={cc.id} className="flex justify-between border-b border-white/5 py-1">
              <span>{cc.createdAt.toLocaleString()}</span>
              <span className="text-gray-400">{cc.outcome ?? cc.status} · {cc.durationSeconds ?? 0}s</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
cd dashboard && npx tsc --noEmit
git add dashboard/app/(admin)/contacts
git commit -m "feat(dashboard): contacts list + memory + recent calls"
```

If the Prisma model field name is `phoneNumber` (camelCase via @map to `phone_number`), no change. If the schema kept the snake-case field name, switch to `phone_number` everywhere. Read schema first.

---

### Task 8.4: Calls log + detail with transcript

**Files:**
- Create: `dashboard/app/(admin)/calls/page.tsx`
- Create: `dashboard/app/(admin)/calls/[id]/page.tsx`

- [ ] **Step 1: List with filters**

```typescript
// dashboard/app/(admin)/calls/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";

type Search = { outcome?: string; status?: string; phone?: string; page?: string };

export default async function CallsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { id: orgId } = await getDefaultOrg();
  const page = Math.max(1, Number(sp.page || 1));
  const limit = 25;
  const where = {
    organizationId: orgId,
    ...(sp.outcome ? { outcome: sp.outcome as any } : {}),
    ...(sp.status ? { status: sp.status as any } : {}),
    ...(sp.phone ? { OR: [{ toNumber: { contains: sp.phone } }, { fromNumber: { contains: sp.phone } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.call.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: (page - 1) * limit }),
    prisma.call.count({ where }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Calls</h1>
      <form className="flex gap-2 text-sm">
        <input name="phone" placeholder="phone…" defaultValue={sp.phone ?? ""} className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5" />
        <select name="outcome" defaultValue={sp.outcome ?? ""} className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5">
          <option value="">All outcomes</option>
          {["BOOKED","NOT_INTERESTED","WRONG_NUMBER","VOICEMAIL","NO_ANSWER","CALLBACK_REQUESTED","TRANSFERRED","FAILED","COMPLETED"].map(v => <option key={v}>{v}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5">
          <option value="">All statuses</option>
          {["QUEUED","RINGING","IN_PROGRESS","COMPLETED","FAILED","NO_ANSWER","BUSY","CANCELED"].map(v => <option key={v}>{v}</option>)}
        </select>
        <button className="rounded-lg bg-white text-black px-3 py-1.5 font-medium">Filter</button>
      </form>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {rows.map((c) => (
          <Link key={c.id} href={`/calls/${c.id}`} className="flex items-center justify-between p-4 hover:bg-white/[0.02]">
            <div>
              <div className="font-medium">{c.toNumber}</div>
              <div className="text-xs text-gray-500">{c.direction} · {c.status} · {c.outcome ?? "—"} · {c.durationSeconds ?? 0}s</div>
            </div>
            <span className="text-xs text-gray-500">{c.createdAt.toLocaleString()}</span>
          </Link>
        ))}
      </div>
      <div className="text-xs text-gray-500">Page {page} · {total} total</div>
    </div>
  );
}
```

- [ ] **Step 2: Detail page with transcript + recording**

```typescript
// dashboard/app/(admin)/calls/[id]/page.tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function CallDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.call.findUnique({ where: { id } });
  if (!c) notFound();
  const transcript = await prisma.transcriptMessage.findMany({
    where: { callId: id }, orderBy: { timestamp: "asc" },
  });
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">{c.toNumber}</h1>
        <div className="text-sm text-gray-500">{c.direction} · {c.status} · {c.outcome ?? "—"} · {c.durationSeconds ?? 0}s · ${Number(c.costUsd ?? 0).toFixed(4)}</div>
      </div>
      {c.recordingUrl && (
        <audio controls src={c.recordingUrl} className="w-full">Your browser does not support audio.</audio>
      )}
      {c.summary && (
        <section className="rounded-2xl bg-white/5 p-4 border border-white/10">
          <h2 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Summary</h2>
          <p className="text-sm">{c.summary}</p>
        </section>
      )}
      <section>
        <h2 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Transcript</h2>
        <ul className="space-y-2 text-sm">
          {transcript.map((m) => (
            <li key={m.id} className={`rounded-lg p-3 ${m.role === "USER" ? "bg-blue-500/10 border border-blue-500/20" : m.role === "ASSISTANT" ? "bg-white/5 border border-white/10" : "bg-yellow-500/10 border border-yellow-500/20"}`}>
              <div className="text-xs text-gray-500 mb-1">{m.role.toLowerCase()} · {m.timestamp.toLocaleTimeString()}</div>
              {m.content}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
cd dashboard && npx tsc --noEmit
git add dashboard/app/(admin)/calls
git commit -m "feat(dashboard): calls log + detail with transcript and recording"
```

---

### Task 8.5: Settings page

**Files:**
- Create: `dashboard/app/(admin)/settings/page.tsx`
- Create: `dashboard/app/(admin)/settings/actions.ts`

- [ ] **Step 1: Read all settings + edit form**

The `Setting` model is snake_case (`is_sensitive`, `updated_at`); Prisma maps it.

```typescript
// dashboard/app/(admin)/settings/actions.ts
"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function upsertSetting(formData: FormData) {
  const key = String(formData.get("key") || "").trim();
  const value = String(formData.get("value") || "");
  const sensitive = formData.get("sensitive") === "on";
  if (!key) return;
  await prisma.setting.upsert({
    where: { key },
    update: { value, isSensitive: sensitive },
    create: { key, value, isSensitive: sensitive },
  });
  revalidatePath("/settings");
}

export async function deleteSetting(key: string) {
  await prisma.setting.delete({ where: { key } });
  revalidatePath("/settings");
}
```

```typescript
// dashboard/app/(admin)/settings/page.tsx
import { prisma } from "@/lib/prisma";
import { upsertSetting, deleteSetting } from "./actions";

export default async function SettingsPage() {
  const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-3xl font-bold">Settings</h1>
      <form action={upsertSetting} className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
        <input name="key" placeholder="KEY" required className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm font-mono" />
        <input name="value" placeholder="value" className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm font-mono" />
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input type="checkbox" name="sensitive" /> sensitive (mask in display)
        </label>
        <button className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium">Save</button>
      </form>
      <ul className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {rows.map((s) => (
          <li key={s.key} className="p-3 flex items-center justify-between text-sm">
            <div>
              <div className="font-mono">{s.key}</div>
              <div className="text-xs text-gray-500 font-mono break-all">
                {s.isSensitive ? "•".repeat(Math.min(20, s.value.length)) : s.value}
              </div>
            </div>
            <form action={deleteSetting.bind(null, s.key)}>
              <button className="text-xs text-red-400 hover:text-red-300">delete</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
cd dashboard && npx tsc --noEmit
git add dashboard/app/(admin)/settings
git commit -m "feat(dashboard): settings CRUD"
```

---

## Phase 9 — Realtime + demo widget

### Task 9.1: Live logs SSE consumer

**Files:**
- Create: `dashboard/app/(admin)/live-logs/page.tsx`
- Create: `dashboard/app/api/logs/proxy/route.ts`
- Create: `dashboard/components/LiveLogs.tsx`

The voice-service `/api/logs/stream` requires a bearer token, so we proxy it through Next so the browser doesn't need it.

- [ ] **Step 1: Proxy route**

```typescript
// dashboard/app/api/logs/proxy/route.ts
const URL_BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const upstream = await fetch(`${URL_BASE}/api/logs/stream${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!upstream.ok || !upstream.body) {
    return new Response("upstream error", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Client component**

```typescript
// dashboard/components/LiveLogs.tsx
"use client";
import { useEffect, useRef, useState } from "react";

type Log = { id: string; source: string; level: string; message: string; detail?: string; timestamp: string };

export default function LiveLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const es = new EventSource("/api/logs/proxy");
    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const l = JSON.parse(e.data) as Log;
        setLogs((prev) => [...prev.slice(-499), l]);
      } catch {}
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, []);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [logs]);
  return (
    <div ref={ref} className="rounded-2xl border border-white/10 bg-black/40 h-[60vh] overflow-y-auto p-3 font-mono text-xs">
      {logs.length === 0 && <div className="text-gray-500">Waiting for logs…</div>}
      {logs.map((l) => (
        <div key={l.id} className={`py-0.5 ${l.level === "ERROR" || l.level === "CRITICAL" ? "text-red-400" : l.level === "WARNING" ? "text-yellow-400" : "text-gray-300"}`}>
          <span className="text-gray-600">[{new Date(l.timestamp).toLocaleTimeString()}]</span>{" "}
          <span className="text-purple-300">{l.source}</span>{" "}
          {l.message}
          {l.detail && <span className="text-gray-500"> — {l.detail}</span>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Page**

```typescript
// dashboard/app/(admin)/live-logs/page.tsx
import LiveLogs from "@/components/LiveLogs";

export default function LiveLogsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Live logs</h1>
      <LiveLogs />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/(admin)/live-logs dashboard/app/api/logs dashboard/components/LiveLogs.tsx
git commit -m "feat(dashboard): live logs SSE viewer (proxied)"
```

---

### Task 9.2: Browser demo widget

**Files:**
- Create: `dashboard/app/(admin)/demo/page.tsx`
- Create: `dashboard/app/api/demo/proxy/route.ts`
- Create: `dashboard/components/DemoWidget.tsx`

- [ ] **Step 1: Token proxy**

```typescript
// dashboard/app/api/demo/proxy/route.ts
import { voiceService } from "@/lib/voice-service";

export async function POST() {
  const t = await voiceService.demoToken();
  return Response.json(t);
}
```

- [ ] **Step 2: Demo widget**

```typescript
// dashboard/components/DemoWidget.tsx
"use client";
import { useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { Mic, PhoneOff, Sparkles } from "lucide-react";

export default function DemoWidget() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "ended">("idle");
  const [room, setRoom] = useState<Room | null>(null);

  async function start() {
    setStatus("connecting");
    const r = await fetch("/api/demo/proxy", { method: "POST" });
    const { token, room: roomName, url } = await r.json();
    const lkRoom = new Room({ adaptiveStream: true, dynacast: true });
    lkRoom.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLAudioElement;
        el.style.display = "none";
        document.body.appendChild(el);
      }
    });
    lkRoom.on(RoomEvent.Disconnected, () => setStatus("ended"));
    await lkRoom.connect(url, token);
    await lkRoom.localParticipant.setMicrophoneEnabled(true);
    setRoom(lkRoom);
    setStatus("connected");
    console.log("demo connected", { roomName });
  }

  async function stop() {
    await room?.disconnect();
    setRoom(null);
    setStatus("ended");
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-purple-500/10 to-blue-500/10 p-8 max-w-md text-center">
      <Sparkles className="mx-auto text-purple-300" size={28} />
      <h2 className="mt-2 text-2xl font-bold">Try the agent</h2>
      <p className="text-gray-400 text-sm mt-1">Open mic in your browser; the AI will pick up.</p>
      <div className="mt-6 flex justify-center">
        {status !== "connected" ? (
          <button onClick={start} disabled={status === "connecting"} className="rounded-full bg-white text-black px-6 py-3 font-medium inline-flex items-center gap-2 disabled:opacity-50">
            <Mic size={16} /> {status === "connecting" ? "Connecting…" : "Start call"}
          </button>
        ) : (
          <button onClick={stop} className="rounded-full bg-red-500 text-white px-6 py-3 font-medium inline-flex items-center gap-2">
            <PhoneOff size={16} /> End call
          </button>
        )}
      </div>
      <div className="mt-4 text-xs text-gray-500">Status: {status}</div>
    </div>
  );
}
```

- [ ] **Step 3: Page**

```typescript
// dashboard/app/(admin)/demo/page.tsx
import DemoWidget from "@/components/DemoWidget";

export default function DemoPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Demo</h1>
      <DemoWidget />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/(admin)/demo dashboard/app/api/demo dashboard/components/DemoWidget.tsx
git commit -m "feat(dashboard): browser demo widget via livekit-client + voice-service mint token"
```

---

### Task 9.3: Decommission legacy components

**Files:**
- Delete: `dashboard/app/api/dispatch/route.ts`, `dashboard/app/api/queue/route.ts`
- Delete: `dashboard/components/CallDispatcher.tsx`, `dashboard/components/BulkDialer.tsx`
- Delete: `dashboard/lib/server-utils.ts` (LiveKit SDK stays as a Node-side dep only via voice-service)

These are replaced by the campaigns + demo + voice-service proxy. Clean removal:

```bash
git rm dashboard/app/api/dispatch/route.ts dashboard/app/api/queue/route.ts
git rm dashboard/components/CallDispatcher.tsx dashboard/components/BulkDialer.tsx
git rm dashboard/lib/server-utils.ts
git commit -m "chore(dashboard): drop legacy direct-LiveKit dispatch in favor of voice-service proxy"
```

(If any page still imports these, fix the import — the new (admin)/page.tsx replacement was created in Task 7.3 so the old `app/page.tsx` should be gone.)

- [ ] **Build clean**

```bash
cd dashboard && npx tsc --noEmit
cd dashboard && npm run build 2>&1 | tail -30
```

Expected: build succeeds. Address any type errors against the actual generated Prisma types — the `as any` casts in Server Actions take care of enum types but type-narrow them where TS allows.

---

## Self-Review

### Spec coverage check (Plan 2)

- ✅ Foundations: voice-service proxy, default org helper, sidebar layout, overview stats (Tasks 7.1–7.3)
- ✅ Assistants CRUD (Task 8.1)
- ✅ Campaigns CRUD + bulk targets upload + run-now (Task 8.2)
- ✅ Contacts list + memory + recent calls (Task 8.3)
- ✅ Calls log with filters + detail with transcript and recording (Task 8.4)
- ✅ Settings UI (Task 8.5)
- ✅ Live logs SSE viewer (Task 9.1)
- ✅ Browser demo widget (Task 9.2)
- ✅ Removed legacy direct-dispatch (Task 9.3)

### Placeholder scan

No `TBD`, `TODO`, "implement later". Code blocks are concrete.

### Type consistency

- Field name assumptions for Assistant (`systemPrompt`, `firstMessage`, `llmProvider`, `llmModel`, `ttsProvider`, `ttsVoice`, `sttProvider`) need to be verified against `dashboard/prisma/schema.prisma model Assistant` before each task — adjust the form + actions accordingly. Note this in the implementer prompt.
- Campaign field names (`scheduleType`, `scheduleTime`, `callDelaySeconds`, `agentProfileId`, `lastRunAt`) match the Prisma schema as updated by the recent `campaign_scheduler_fields` migration.
- Contact / ContactMemory / Setting field names assume Prisma camelCase mapping (e.g. `phoneNumber` → `phone_number`). If schema kept snake_case directly, switch identifiers — read schema first.

### Coverage gaps

- No per-user authentication (single shared admin session) — Plan 3 will add Clerk or NextAuth.
- No `Active calls` panel — folded into live logs since the voice-service does not yet emit per-call status events to a dedicated table. Plan 3 will wire that.
- No webhook UI — the `Webhook` model exists in schema but managing it is Plan 3.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-dashboard.md`. Use **Subagent-Driven** execution per the established workflow (one implementer subagent per task; spec compliance + code-quality reviewer between tasks). After Plan 2 ships, Plan 3 will cover deployment, observability rollup, and onboarding docs.
