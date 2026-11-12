import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import * as cost from "../lib/cost";
import { assistantPrompts, preservePromptLineEndings, withOutboundPrompt } from "../lib/assistant-prompts";
import { withBusinessName } from "../lib/assistant-identity";
import { withVoiceSettings } from "../lib/native-voice";
import { withIntelligenceSettings } from "../lib/call-intelligence";
import {withTransferPeople} from "../lib/human-transfer";
import { overviewRange, overallDaysBack } from "../lib/overview-range";

test("Overall has no lower date bound and includes the earliest calendar day", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  assert.equal(overviewRange("overall", now).since, null);
  assert.equal(overviewRange("OVERALL", now).value, "overall");
  assert.equal(overallDaysBack(new Date("2024-01-01T01:00:00Z"), now), 1038);
  assert.equal(overallDaysBack(undefined, now), 1);
  assert.equal(overviewRange("7d", now).since?.toISOString(), "2026-10-27T12:00:00.000Z");
  assert.equal(overviewRange("invalid", now).value, "14d");
});

test("actual Overview includes historical calls, tokens and costs in Overall only", async () => {
  const source = readFileSync(path.resolve("app/(admin)/page.tsx"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const oldDate = new Date();
  oldDate.setUTCFullYear(oldDate.getUTCFullYear() - 1);
  const rows = [oldDate, new Date()].map((createdAt, i) => ({
    id: `synthetic-${i}`, createdAt, organizationId: "synthetic-org", direction: "INBOUND",
    outcome: "BOOKED", wasBooked: true, llmInputTokens: (i + 1) * 1_000_000,
    llmOutputTokens: 0, llmProviderUsed: "openai", llmSkuUsed: "synthetic-model",
    durationSeconds: 60, fromNumber: "synthetic", status: "COMPLETED",
  }));
  const queries: Array<{ organizationId: string; createdAt?: { gte: Date } }> = [];
  const prisma = {
    call: { count: async () => 2, findMany: async ({ where }: { where: typeof queries[number] }) => {
      queries.push(where);
      return rows.filter((r) => !where.createdAt || r.createdAt >= where.createdAt.gte);
    } },
    assistant: { count: async () => 1 }, campaign: { count: async () => 0 },
    activeCall: { findMany: async () => [] },
    providerRate: { findMany: async () => [{ provider: "openai", sku: "synthetic-model", kind: "LLM_INPUT_MTOK", rateUsd: 1, lastVerifiedAt: new Date() }] },
  };
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime, "@/lib/prisma": { prisma },
    "@/lib/org": { getDefaultOrg: async () => ({ id: "synthetic-org" }) },
    "@/lib/overview-range": { overviewRange, overallDaysBack }, "@/lib/cost": cost,
    "@/lib/currency": { getUsdInrRate: async () => ({ usdInr: 85 }) },
  };
  const exports: { default?: (props: object) => Promise<any> } = {};
  vm.runInNewContext(compiled, { exports, Date, Map, Math,
    require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith("@/components/")) return { default: name };
      if (name === "lucide-react") return {};
      throw new Error(name);
    } });
  const all = await exports.default!({ searchParams: Promise.resolve({ range: "overall" }) });
  assert(queries.every((q) => q.organizationId === "synthetic-org" && !q.createdAt));
  assert.equal(all.props.costs.totalCalls, 2);
  assert.equal(all.props.costs.totalUsd, 3);
  assert.equal(all.props.costs.byDay[0].date, oldDate.toISOString().slice(0, 10));
  const tree: any[] = [];
  function walk(node: any) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node?.props) { tree.push(node); walk(node.props.children); }
  }
  walk(all);
  const calls = tree.find((n) => n.type === "@/components/charts/CallsTimeline").props.data;
  const tokens = tree.find((n) => n.type === "@/components/charts/TokensTimeline").props.data;
  assert.equal(calls.reduce((sum: number, row: any) => sum + row.calls, 0), 2);
  assert.equal(tokens.reduce((sum: number, row: any) => sum + row.input, 0), 3_000_000);
  queries.length = 0;
  const week = await exports.default!({ searchParams: Promise.resolve({ range: "7d" }) });
  assert(queries.every((q) => q.createdAt?.gte));
  assert.equal(week.props.costs.totalCalls, 1);
  assert.equal(week.props.costs.totalUsd, 2);
});

test("legacy assistants keep their existing prompt in both editors", () => {
  for (const metadata of [null, [], "invalid", { directionPrompts: { outbound: 42 } }]) {
    assert.deepEqual(assistantPrompts("Original", metadata), { inbound: "Original", outbound: "Original" });
  }
});

test("separate prompts round-trip without losing unrelated metadata", () => {
  const metadata = { business: { name: "Synthetic" }, directionPrompts: { note: "retain" } };
  const merged = withOutboundPrompt(metadata, "Outbound draft");
  assert.deepEqual(assistantPrompts("Inbound draft", merged), { inbound: "Inbound draft", outbound: "Outbound draft" });
  assert.deepEqual(merged.business, { name: "Synthetic" });
  assert.equal(merged.directionPrompts.note, "retain");
  assert.equal(metadata.directionPrompts.note, "retain");
});

// Execute the real server action with DB/navigation boundaries mocked. No real
// assistant prompts or forwarding destinations are changed by these tests.
test("Save assistant stores both directions and preserves metadata", async () => {
  const source = readFileSync(path.resolve("app/(admin)/assistants/actions.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let written: Record<string, unknown> | undefined;
  const prisma = {
    assistant: {
      findUniqueOrThrow: async () => ({ metadata: {
        keep: "existing-setting", intelligence: { memory: false, recovery: true },
      } }),
      update: async ({ data }: { data: Record<string, unknown> }) => { written = data; },
    },
    assistantTool: { findMany: async () => [] },
    humanTransferTarget: { upsert: async () => ({}) },
  };
  const dependencies: Record<string, unknown> = {
    "@/lib/prisma": { prisma }, "@/lib/org": { getDefaultOrg: async () => ({ id: "org" }) },
    "next/cache": { revalidatePath() {} }, "next/navigation": { redirect() {} },
    "@/lib/require-role": { requireRole: async () => ({}) },
    "@/lib/llm-models": { coerceModelForProvider: () => "synthetic-model" },
    "@/lib/tts-voices": { coerceVoiceForProvider: () => "synthetic-voice" },
    "@/lib/human-transfer": { TRANSFER_CATEGORIES: [], isE164: () => true, withTransferPeople },
    "@/lib/assistant-prompts": { assistantPrompts, preservePromptLineEndings, withOutboundPrompt },
    "@/lib/native-voice": { withVoiceSettings },
    "@/lib/call-intelligence": { withIntelligenceSettings },
    "@/lib/assistant-identity": { withBusinessName },
  };
  const exports: Record<string, (state: object, form: FormData) => Promise<unknown>> = {};
  vm.runInNewContext(compiled, { exports, console, Number, String, Set, Object,
    require: (name: string) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; } });
  const form = new FormData();
  form.set("assistantId", "synthetic-assistant");
  form.set("businessName", "Vasan Eye Care");
  form.set("systemPrompt", "Inbound instructions");
  form.set("outboundSystemPrompt", "Outbound instructions");
  form.set("endOfSpeechSensitivity", "HIGH");
  form.set("minPauseMs", "0");
  form.set("interruptionThresholdMs", "230");
  form.set("silenceTimeoutSeconds", "44");
  form.set("maxDurationSeconds", "900");
  form.set("confidenceThresholdPct", "65");
  form.set("backgroundDenoising", "false");
  form.set("voicemailDetection", "true");
  form.set("hallucinationGuard", "false");
  form.set("recordingEnabled", "true");
  await exports.saveAssistant({}, form);
  assert.equal(written?.systemPrompt, "Inbound instructions");
  assert.equal((written?.metadata as {businessName:string}).businessName, "Vasan Eye Care");
  assert.equal(written?.endOfSpeechSensitivity, "HIGH");
  assert.equal(written?.minPauseMs, 0);
  assert.equal(written?.interruptionThresholdMs, 230);
  assert.equal(written?.silenceTimeoutSeconds, 44);
  assert.equal(written?.maxDurationSeconds, 900);
  assert.equal(written?.confidenceThresholdPct, 65);
  assert.equal(written?.backgroundDenoising, false);
  assert.equal(written?.voicemailDetection, true);
  assert.equal(written?.hallucinationGuard, false);
  assert.equal(written?.recordingEnabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(written?.metadata)), {
    keep: "existing-setting", businessName: "Vasan Eye Care", directionPrompts: { outbound: "Outbound instructions" },
    intelligence: { memory: false, recovery: true },
  });
  form.set("minPauseMs", "99999");
  form.set("recordingEnabled", "false");
  form.set("interruptionThresholdMs", "");
  form.delete("maxDurationSeconds");
  await exports.saveAssistant({}, form);
  assert.equal(written?.minPauseMs, 3000);
  assert.equal(written?.interruptionThresholdMs, 150);
  assert.equal(written?.maxDurationSeconds, 1800);
  assert.equal(written?.recordingEnabled, false);
});
