import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCallCost, type CallCostInput } from "../lib/cost";

const native: CallCostInput = {
  direction: "INBOUND", durationSeconds: 60,
  llmInputTokens: 1000, llmOutputTokens: 100,
  llmProviderUsed: "openrouter", llmSkuUsed: "selected-backend",
  sttSeconds: 75, sttProviderUsed: "openai", sttSkuUsed: "gpt-live-1",
  ttsChars: 0, ttsProviderUsed: null, ttsSkuUsed: null, telephonyProvider: "vobiz",
};
const rates = new Map([
  ["openai|gpt-live-1|STT_MINUTE", 0.05],
  ["openrouter|selected-backend|LLM_INPUT_MTOK", 1],
  ["openrouter|selected-backend|LLM_OUTPUT_MTOK", 2],
  ["vobiz|inbound|TELEPHONY_MINUTE", 0],
]);

test("native audio is metered once as full-duplex voice plus actual backend usage", () => {
  const cost = computeCallCost(native, rates);
  const voice = cost.lines.find((line) => line.sku === "gpt-live-1")!;
  assert.equal(voice.category, "LLM");
  assert.equal(voice.label, "OpenAI GPT-Live full-duplex audio");
  assert.equal(voice.units, 1.25);
  assert.equal(voice.costUsd, 0.0625);
  assert.equal(cost.lines.some((line) => line.category === "STT" || line.category === "TTS"), false);
  assert(Math.abs(cost.totalUsd - 0.0637) < 1e-10);
});

test("missing native price is explicit, never a fabricated zero-price voice", () => {
  const cost = computeCallCost(native, new Map(), { includeUnavailable: true });
  assert.equal(cost.hasUnknownRates, true);
  assert.equal(cost.lines.find((line) => line.sku === "gpt-live-1")?.unavailable, true);
});

test("legacy Sarvam calls keep separate STT and TTS meters", () => {
  const call = { ...native, sttProviderUsed: "sarvam", sttSkuUsed: "saaras-v4", ttsChars: 500,
    ttsProviderUsed: "sarvam", ttsSkuUsed: "bulbul-v3" };
  const legacyRates = new Map([...rates, ["sarvam|saaras-v4|STT_MINUTE", 0.0036] as const,
    ["sarvam|bulbul-v3|TTS_KCHARS", 0.01] as const]);
  const cost = computeCallCost(call, legacyRates);
  assert(cost.lines.some((line) => line.category === "STT"));
  assert(cost.lines.some((line) => line.category === "TTS"));
});
