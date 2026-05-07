// Self-contained docs page for the Settings → Docs & API tab. Renders the
// full Jilljill Voice user guide, dashboard overview, API reference, env
// var reference, and troubleshooting section. Each code block has a
// CopyButton via the client island.

import {
  Book,
  Zap,
  Bot,
  Megaphone,
  PhoneCall,
  CircleDollarSign,
  Webhook,
  Code2,
  Settings as SettingsIcon,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import CopyButton from "./CopyButton";

function Code({ children }: { children: string }) {
  return (
    <div className="relative group">
      <pre className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-[11px] text-gray-200 font-mono overflow-x-auto whitespace-pre">
        {children}
      </pre>
      <CopyButton text={children} />
    </div>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: typeof Book;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="glass rounded-2xl p-5 space-y-3 scroll-mt-24">
      <div className="flex items-center gap-2 mb-1">
        <div className="size-8 rounded-lg bg-gradient-to-br from-cyan-400/20 via-violet-400/20 to-pink-400/20 flex items-center justify-center">
          <Icon size={14} className="text-cyan-300" />
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="text-sm text-gray-300 space-y-3 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

const TOC = [
  { id: "quick-start", label: "Quick start", icon: Zap },
  { id: "dashboard-tour", label: "Dashboard tour", icon: Book },
  { id: "assistants", label: "Creating assistants", icon: Bot },
  { id: "campaigns", label: "Running campaigns", icon: Megaphone },
  { id: "dispatch", label: "Placing calls", icon: PhoneCall },
  { id: "costs-rates", label: "Costs & rates", icon: CircleDollarSign },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "api-reference", label: "REST API reference", icon: Code2 },
  { id: "env-vars", label: "Environment variables", icon: SettingsIcon },
  { id: "troubleshooting", label: "Troubleshooting", icon: AlertTriangle },
];

export default function DocsContent() {
  return (
    <div className="space-y-5">
      {/* ── Header + table of contents ─────────────────────────────────────── */}
      <div className="ring-gradient rounded-2xl bg-gradient-to-br from-violet-500/[0.08] via-fuchsia-500/[0.04] to-cyan-500/[0.08] p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-violet-300" />
          <h1 className="text-lg font-bold text-gradient">
            Jilljill Voice — Guide &amp; API Reference
          </h1>
        </div>
        <p className="text-sm text-gray-300">
          Everything you need to set up, run, and integrate with Jilljill
          Voice. Bookmarkable section anchors below jump straight to topics.
        </p>
        <nav className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-1.5">
          {TOC.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-gray-300 hover:bg-white/[0.05] hover:text-white transition"
            >
              <t.icon size={11} className="text-violet-300" />
              {t.label}
            </a>
          ))}
        </nav>
      </div>

      {/* ── Quick start ─────────────────────────────────────────────────────── */}
      <Section id="quick-start" icon={Zap} title="Quick start (5 minutes)">
        <ol className="list-decimal list-inside space-y-2">
          <li>
            <strong>Sign in</strong> at <code className="text-violet-300">/login</code>{" "}
            with your admin credentials. The defaults baked into local
            development are <code className="text-violet-300">admin@local</code> /{" "}
            <code className="text-violet-300">admin123</code> — rotate before
            deploying. Generate a fresh password hash with{" "}
            <code className="text-violet-300">node -e &quot;console.log(require(&apos;bcryptjs&apos;).hashSync(&apos;your-pw&apos;, 10))&quot;</code>
            , then escape every <code>$</code> as <code>\$</code> in your
            <code> .env</code>.
          </li>
          <li>
            <strong>Configure credentials</strong> at{" "}
            <code className="text-violet-300">Settings → Credentials</code>.
            At minimum: <code>LIVEKIT_*</code>, <code>GOOGLE_API_KEY</code>{" "}
            (or set <code>USE_GEMINI_REALTIME=false</code> and supply{" "}
            <code>OPENAI_API_KEY</code> as a fallback), and one TTS provider
            key. Vobiz SIP credentials are required for outbound phone calls.
          </li>
          <li>
            <strong>Create your first Assistant</strong> at{" "}
            <code className="text-violet-300">/assistants/new</code>. Pick a
            template (Receptionist, Booker, Outbound Sales, Customer Support,
            or Marketing) or use the &quot;Generate with AI&quot; button to
            describe the assistant in one sentence and have a complete prompt
            written for you. Edit the result, save.
          </li>
          <li>
            <strong>Place a test call</strong> via the{" "}
            <strong>Quick Dispatch</strong> panel in the sidebar. Enter a
            phone number in E.164 format (e.g. <code>+919876543210</code>),
            optionally a lead name and language preset, and click{" "}
            <strong>Place call</strong>. The agent dials out via your Vobiz
            trunk; you&apos;ll see the call land in{" "}
            <code className="text-violet-300">/calls</code> with full
            transcript, recording (if R2 is configured), and cost breakdown.
          </li>
          <li>
            <strong>Wire webhooks</strong> at{" "}
            <code className="text-violet-300">/webhooks</code> if you want
            voice-service to POST call events to your CRM, n8n flow, or
            Slack channel.
          </li>
        </ol>
      </Section>

      {/* ── Dashboard tour ──────────────────────────────────────────────────── */}
      <Section id="dashboard-tour" icon={Book} title="Dashboard tour">
        <ul className="space-y-2">
          <li>
            <strong>Overview</strong> — top-of-funnel stats: 14-day call total,
            booking rate, spend, token usage. Live calls panel polls
            in-progress calls. Charts: calls timeline, token usage stacked
            area, spend-by-provider stacked bar, outcome donut, booking-rate
            radial gauge.
          </li>
          <li>
            <strong>Assistants</strong> — Vapi-style agent definitions:
            persona, voice stack (LLM/STT/TTS), industry-standard speech
            tuning. Five templates ship out of the box; custom prompts can
            be auto-generated from a one-line description.
          </li>
          <li>
            <strong>Campaigns</strong> — bulk calling. Upload a CSV of
            contacts, pick an assistant, schedule (once / daily / weekdays
            in IST), set call delay. Pause/resume from the campaign detail
            page.
          </li>
          <li>
            <strong>Contacts</strong> — CRM. Auto-populated from completed
            calls + manual CSV import/export. Editable name/email/notes/tags
            per contact. Per-contact memory (insights the agent has stored)
            and recent calls.
          </li>
          <li>
            <strong>Calls</strong> — every dispatched call with filters
            (phone / status / outcome). Detail page shows direction, status,
            duration, recording playback, transcript, post-call cost
            breakdown, editable notes.
          </li>
          <li>
            <strong>Costs</strong> — per-provider spend computed live from{" "}
            <code>usage × current ProviderRate</code>. LLM rates auto-refresh
            every 3 hours from OpenRouter. Manual refresh button + admin-
            editable rates table.
          </li>
          <li>
            <strong>Calendar</strong> — month grid of bookings. Click any day
            to drill in; cancel any BOOKED row inline; create a manual
            booking via the &quot;Add booking&quot; form.
          </li>
          <li>
            <strong>Live Logs</strong> — SSE stream of structured logs from
            the voice-service. Errors and warnings highlighted.
          </li>
          <li>
            <strong>Webhooks</strong> — outbound event delivery. CRUD +
            delivery log per webhook.
          </li>
          <li>
            <strong>Demo</strong> — browser-based test call. Mints a LiveKit
            JWT server-side and connects you to the agent without dialing a
            phone.
          </li>
          <li>
            <strong>Settings</strong> — credentials, integrations, general
            tunables, and this docs tab.
          </li>
        </ul>
      </Section>

      {/* ── Assistants ──────────────────────────────────────────────────────── */}
      <Section id="assistants" icon={Bot} title="Creating an assistant">
        <p>
          Assistants are reusable agent definitions. One Assistant can power
          many Campaigns and inbound numbers.
        </p>
        <ol className="list-decimal list-inside space-y-2">
          <li>
            Visit <code className="text-violet-300">/assistants/new</code>.
            Pick a template card (Receptionist, Booker, Sales,
            Support+Survey, Marketing) or click <strong>Blank / Custom</strong>.
          </li>
          <li>
            <strong>Identity</strong> (top-left): name + first message
            (greeting) + system prompt. Use the <strong>Generate with AI</strong>{" "}
            button if you don&apos;t want to write a prompt from scratch —
            describe the assistant in 1-3 sentences and the model writes a
            full prompt with placeholders, conversation flow, and objection
            handling.
          </li>
          <li>
            <strong>Call accuracy &amp; speech</strong> (top-right):
            industry-standard knobs.
            <ul className="list-disc list-inside mt-1 ml-3 space-y-1 text-gray-400">
              <li>
                <em>End-of-speech sensitivity</em> — LOW (2.0s patient) /
                MEDIUM (1.0s balanced) / HIGH (0.4s snappy).
              </li>
              <li>
                <em>Interruption threshold (ms)</em> — minimum continuous
                user speech to interrupt the agent. 100-250 typical.
              </li>
              <li>
                <em>Min pause before agent responds (ms)</em> — floor that
                prevents trampling the customer.
              </li>
              <li>
                <em>STT confidence threshold (%)</em> — agent asks user to
                repeat below this. 0 = never. 55 typical.
              </li>
              <li>
                <em>Hallucination guard</em> — auto-appends a &quot;don&apos;t
                invent information&quot; clause to your prompt. Recommended on.
              </li>
              <li>
                <em>Voicemail detection / Recording / Background denoising</em>
                {" "}— self-explanatory toggles.
              </li>
            </ul>
          </li>
          <li>
            <strong>Voice stack</strong> (bottom): LLM, TTS, STT provider
            and SKU choices. The cost dashboard tracks usage per provider.
          </li>
          <li>
            Click <strong>Save assistant</strong>. The agent will pick up
            new settings on its next call.
          </li>
        </ol>
      </Section>

      {/* ── Campaigns ───────────────────────────────────────────────────────── */}
      <Section id="campaigns" icon={Megaphone} title="Running a campaign">
        <ol className="list-decimal list-inside space-y-2">
          <li>
            Go to <code className="text-violet-300">/campaigns/new</code>.
            Name the campaign and pick an assistant.
          </li>
          <li>
            (Optional) <strong>Prompt override</strong> — replaces the
            assistant&apos;s system prompt only for calls in this campaign.
            Useful for A/B testing.
          </li>
          <li>
            <strong>Schedule</strong>: <code>ONCE</code> (run when manually
            started) / <code>DAILY</code> / <code>WEEKDAYS</code> at the
            given HH:MM IST.
          </li>
          <li>
            <strong>Call delay</strong> — seconds between each dial. 3-5s is
            the typical SIP-friendly pace.
          </li>
          <li>
            Save → land on the detail page. Use the <strong>Add targets</strong>{" "}
            uploader: paste a CSV like{" "}
            <code>phone,lead_name</code> with one E.164 number per line.
          </li>
          <li>
            Hit <strong>Run now</strong> to fire immediately, or rely on the
            schedule. The voice-service APScheduler picks scheduled
            campaigns up automatically; the dashboard reloads the scheduler
            after every campaign edit.
          </li>
        </ol>
      </Section>

      {/* ── Dispatch ────────────────────────────────────────────────────────── */}
      <Section id="dispatch" icon={PhoneCall} title="Placing calls">
        <p>Three ways to dial:</p>
        <ol className="list-decimal list-inside space-y-2">
          <li>
            <strong>Quick Dispatch</strong> in the sidebar — phone + lead name
            + language preset → place call.
          </li>
          <li>
            <strong>Demo</strong> page — browser-to-agent without a phone
            number.
          </li>
          <li>
            <strong>REST API</strong> — see{" "}
            <a href="#api-reference" className="text-violet-300 hover:text-violet-200 underline">
              API reference
            </a>{" "}
            below for the full payload.
          </li>
        </ol>
      </Section>

      {/* ── Costs & rates ───────────────────────────────────────────────────── */}
      <Section id="costs-rates" icon={CircleDollarSign} title="Costs & live rates">
        <p>
          Cost is computed at query time as{" "}
          <code className="text-violet-300">usage × current ProviderRate</code>
          {" "}— never stored on the call row alone. So when OpenAI cuts
          gpt-4o-mini prices tomorrow, every historical call&apos;s reported
          cost moves with it.
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>LLM rates</strong> auto-refresh every 3 hours from
            OpenRouter&apos;s free <code>/api/v1/models</code> API.
          </li>
          <li>
            <strong>STT / TTS / telephony</strong> rates have no public
            pricing API; they&apos;re seeded with Nov 2026 list prices and
            admin-editable. The Costs page flags rows verified more than
            200 minutes ago as stale.
          </li>
          <li>
            <strong>Manual refresh</strong> — click <em>Refresh now</em> on
            the rates table to force an OpenRouter fetch.
          </li>
          <li>
            <strong>Per-call breakdown</strong> — every call detail page has
            a Post-call cost breakdown panel showing each provider × kind
            line item (units × rate = cost).
          </li>
        </ul>
      </Section>

      {/* ── Webhooks ────────────────────────────────────────────────────────── */}
      <Section id="webhooks" icon={Webhook} title="Webhooks">
        <p>
          Voice-service POSTs JSON payloads to your URL on each enabled
          event. Subscribe to: <code>CALL_STARTED</code>,{" "}
          <code>CALL_ENDED</code>, <code>CALL_FAILED</code>,{" "}
          <code>TRANSCRIPT_UPDATE</code>, <code>TRANSFER_INITIATED</code>.
        </p>
        <p>Sample payload (CALL_ENDED):</p>
        <Code>{`{
  "event": "CALL_ENDED",
  "call_id": "clxyz...",
  "phone": "+919876543210",
  "lead_name": "Ravi",
  "duration": 142,
  "outcome": "BOOKED",
  "reason": "Booked consultation for 2026-05-15 11:00",
  "sentiment": "positive",
  "cost_usd": 0.0231,
  "was_booked": true,
  "recording_url": "https://recordings.r2/...",
  "transcript": "[USER] Hi...\\n[ASSISTANT] Hello..."
}`}</Code>
        <p>
          Each delivery is recorded in the <code>WebhookDelivery</code>{" "}
          table. The detail page shows status (success / 4xx / 5xx /
          pending), attempts, and the response body.
        </p>
      </Section>

      {/* ── API Reference ───────────────────────────────────────────────────── */}
      <Section id="api-reference" icon={Code2} title="REST API reference">
        <p>
          Voice-service is the integration surface. Base URL:
        </p>
        <ul className="list-disc list-inside text-[11px] font-mono text-gray-400 ml-4">
          <li>Local dev: <code>http://localhost:8000</code></li>
          <li>Production: <code>https://voice.yourdomain.com</code></li>
        </ul>
        <p>
          All <code>/api/*</code> routes (except <code>/api/webhook/livekit</code>
          {" "}and <code>/health</code>) require:
        </p>
        <Code>{`Authorization: Bearer <VOICE_SERVICE_TOKEN>`}</Code>

        <h3 className="text-sm font-semibold text-gray-200 mt-4">
          POST /api/dispatch/single
        </h3>
        <p>Place a single outbound call.</p>
        <Code>{`curl -X POST $VOICE_URL/api/dispatch/single \\
  -H "Authorization: Bearer $VOICE_SERVICE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "+919876543210",
    "lead_name": "Ravi",
    "business_name": "Acme Dental",
    "service_type": "consultation",
    "language_preset": "hinglish"
  }'

# → 200 OK
{
  "status": "ok",
  "dispatch_id": "AGT_xxx",
  "room": "call-919876543210-7421",
  "phone": "+919876543210"
}`}</Code>

        <h3 className="text-sm font-semibold text-gray-200 mt-4">
          POST /api/dispatch/bulk
        </h3>
        <p>
          Dispatch many in one request. Returns immediately; calls fan out
          on the server-side worker spaced by <code>delay_seconds</code>.
        </p>
        <Code>{`curl -X POST $VOICE_URL/api/dispatch/bulk \\
  -H "Authorization: Bearer $VOICE_SERVICE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contacts": [
      {"phone": "+91...", "lead_name": "Ravi"},
      {"phone": "+91...", "lead_name": "Priya"}
    ],
    "delay_seconds": 3,
    "language_preset": "hinglish"
  }'`}</Code>

        <h3 className="text-sm font-semibold text-gray-200 mt-4">
          POST /api/demo/token
        </h3>
        <p>Mint a LiveKit JWT for the browser demo widget.</p>
        <Code>{`curl -X POST $VOICE_URL/api/demo/token \\
  -H "Authorization: Bearer $VOICE_SERVICE_TOKEN"

# → { "token": "ey...", "room": "demo-xxx", "url": "wss://..." }`}</Code>

        <h3 className="text-sm font-semibold text-gray-200 mt-4">
          GET /api/logs/stream
        </h3>
        <p>
          Server-Sent Events feed of <code>error_logs</code> rows. The
          dashboard&apos;s Live Logs page consumes this via its proxy.
        </p>
        <Code>{`curl -N -H "Authorization: Bearer $VOICE_SERVICE_TOKEN" \\
  $VOICE_URL/api/logs/stream`}</Code>

        <h3 className="text-sm font-semibold text-gray-200 mt-4">
          GET /api/rates
        </h3>
        <p>List all provider rates (LLM/STT/TTS/telephony).</p>
        <Code>{`curl -H "Authorization: Bearer $VOICE_SERVICE_TOKEN" \\
  $VOICE_URL/api/rates

# → [
#   {
#     "provider": "openai",
#     "sku": "gpt-4o-mini",
#     "kind": "LLM_INPUT_MTOK",
#     "rateUsd": "0.15000000",
#     "source": "OPENROUTER",
#     "last_verified_at": "2026-05-08T..."
#   }, ...
# ]`}</Code>

        <h3 className="text-sm font-semibold text-gray-200 mt-4">
          POST /api/rates/refresh
        </h3>
        <p>
          Force an immediate OpenRouter fetch. Same code path the 3-hourly
          cron runs.
        </p>
        <Code>{`curl -X POST -H "Authorization: Bearer $VOICE_SERVICE_TOKEN" \\
  $VOICE_URL/api/rates/refresh

# → {"input": 5, "output": 5, "errors": 0}`}</Code>

        <h3 className="text-sm font-semibold text-gray-200 mt-4">
          POST /api/assistants/generate-prompt
        </h3>
        <p>
          AI-generates a complete system prompt from a 1-3 sentence
          description. Uses <code>OPENAI_API_KEY</code> if set, else falls
          back to Groq.
        </p>
        <Code>{`curl -X POST $VOICE_URL/api/assistants/generate-prompt \\
  -H "Authorization: Bearer $VOICE_SERVICE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "A friendly dental clinic receptionist that books appointments and routes urgent calls"
  }'

# → {"prompt": "You are a friendly...", "model": "gpt-4o-mini"}`}</Code>

        <h3 className="text-sm font-semibold text-gray-200 mt-4">
          POST /api/campaigns/{`{id}`}/run-now
        </h3>
        <p>Fire a campaign immediately, ignoring its schedule.</p>
        <Code>{`curl -X POST -H "Authorization: Bearer $VOICE_SERVICE_TOKEN" \\
  $VOICE_URL/api/campaigns/$CAMPAIGN_ID/run-now`}</Code>

        <h3 className="text-sm font-semibold text-gray-200 mt-4">
          GET /health · GET /metrics
        </h3>
        <p>
          <code>/health</code> returns <code>{`{"status": "ok"}`}</code> for
          load-balancer probes. <code>/metrics</code> returns the Prometheus
          exposition format. Neither endpoint requires the bearer token.
        </p>
      </Section>

      {/* ── Env vars ────────────────────────────────────────────────────────── */}
      <Section id="env-vars" icon={SettingsIcon} title="Environment variables">
        <p>
          The full reference lives in{" "}
          <code className="text-violet-300">.env.example</code> at both the
          root and <code>dashboard/</code>. Critical ones:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-gray-500">
              <tr>
                <th className="text-left py-1.5 font-medium">Var</th>
                <th className="text-left py-1.5 font-medium">Required</th>
                <th className="text-left py-1.5 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {[
                ["DATABASE_URL", "yes", "Neon Postgres pooled DSN"],
                ["VOICE_SERVICE_TOKEN", "yes", "Bearer secret shared between dashboard ↔ voice-service"],
                ["LIVEKIT_URL / KEY / SECRET", "yes", "LiveKit Cloud project credentials"],
                ["LIVEKIT_WEBHOOK_SECRET", "yes (prod)", "HMAC verification for /api/webhook/livekit"],
                ["GOOGLE_API_KEY", "yes if Gemini Live", "Realtime LLM. Set USE_GEMINI_REALTIME=false to skip."],
                ["OPENAI_API_KEY", "fallback", "Pipeline-mode LLM + AI prompt generator"],
                ["GROQ_API_KEY / ANTHROPIC_API_KEY", "fallback", "Alternative LLMs"],
                ["DEEPGRAM / SARVAM / ELEVENLABS / CARTESIA _API_KEY", "≥ 1 required", "STT + TTS"],
                ["VOBIZ_*  + OUTBOUND_TRUNK_ID", "yes for outbound", "SIP telephony"],
                ["INBOUND_TRUNK_ID", "yes for inbound", "LiveKit inbound trunk"],
                ["R2_*", "no", "Cloudflare R2 for call recordings"],
                ["NEXTAUTH_URL / SECRET", "yes (dashboard)", "Single-admin login"],
                ["ADMIN_EMAIL / ADMIN_PASSWORD_HASH", "yes (dashboard)", "Login credentials. Escape every $ in the bcrypt hash as \\$"],
                ["DEFAULT_ORG_ID", "yes (voice-service)", "FK target for Call rows. Read from settings table or set explicitly."],
              ].map(([k, req, purpose], i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="py-1.5 font-mono text-[11px]">{k}</td>
                  <td className="py-1.5 text-[11px] text-gray-500">{req}</td>
                  <td className="py-1.5 text-[11px]">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Troubleshooting ─────────────────────────────────────────────────── */}
      <Section id="troubleshooting" icon={AlertTriangle} title="Troubleshooting">
        <ul className="space-y-3">
          <li>
            <strong>Login fails with &quot;Wrong email or password&quot;</strong>{" "}
            — most common cause: unescaped <code>$</code> in{" "}
            <code>ADMIN_PASSWORD_HASH</code>. Next.js&apos;s env loader expands{" "}
            <code>$VAR</code> sequences. Escape every <code>$</code> as{" "}
            <code>\$</code>: <code>ADMIN_PASSWORD_HASH=\$2b\$10\$...</code>.
            Voice-service also logs a warning at startup if the hash is
            malformed.
          </li>
          <li>
            <strong>Quick Dispatch fails with 401 / 403</strong> — the
            dashboard&apos;s <code>VOICE_SERVICE_TOKEN</code> doesn&apos;t
            match voice-service&apos;s. They must be identical. Check both
            <code> .env.local</code> (dashboard) and <code>.env</code> (root,
            for docker compose).
          </li>
          <li>
            <strong>Calls fail with FK violation on Call insert</strong> —{" "}
            <code>DEFAULT_ORG_ID</code> isn&apos;t set, so voice-service
            tries to insert with a literal <code>&quot;default-org&quot;</code>
            {" "}that doesn&apos;t match any real Organization. Run{" "}
            <code>prisma db seed</code> to create the default org and copy
            the printed cuid into your env, or read it from the{" "}
            <code>settings</code> table.
          </li>
          <li>
            <strong>Costs page shows everything in DEFAULT source, no
            OPENROUTER</strong> — voice-service couldn&apos;t reach
            openrouter.ai. Check container egress, click <strong>Refresh now</strong>
            {" "}for an immediate retry, or look for{" "}
            <code>provider_rates_refresh_failed</code> in voice-service logs.
          </li>
          <li>
            <strong>Recording playback is empty</strong> — Cloudflare R2 env
            vars (<code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>,
            <code> R2_SECRET_ACCESS_KEY</code>, <code>R2_BUCKET</code>,
            <code> R2_ENDPOINT</code>) aren&apos;t set, so the agent skipped
            egress at session start (it logs <code>egress_skipped_no_r2_config</code>
            ). Add the keys, restart voice-service, place a new call.
          </li>
          <li>
            <strong>Dropdown shows white-on-white on Windows</strong> — fixed
            in commit <code>e76260a</code>. Hard-refresh (Ctrl-F5) to load
            the new globals.css.
          </li>
        </ul>
      </Section>

      <p className="text-[11px] text-gray-500 text-center pt-4">
        Repository:{" "}
        <a
          href="https://github.com/Vimal-Raj-003/ai-voice-agent"
          target="_blank"
          rel="noreferrer"
          className="text-violet-300 hover:text-violet-200 underline"
        >
          github.com/Vimal-Raj-003/ai-voice-agent
        </a>
        . Found a gap in the docs? Open an issue.
      </p>
    </div>
  );
}
