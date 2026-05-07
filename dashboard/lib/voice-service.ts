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
  settings: () =>
    call<Record<string, { value: string; configured: boolean }>>(
      `/api/settings`,
    ),
  generatePrompt: (description: string) =>
    call<{ prompt: string; model: string }>(
      `/api/assistants/generate-prompt`,
      { method: "POST", body: { description } },
    ),
};
