import assert from "node:assert/strict";
import test from "node:test";
import {callIntelligenceReport, intelligenceSettings, withIntelligenceSettings, INTELLIGENCE_FEATURES} from "../lib/call-intelligence";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import CallIntelligence from "../components/CallIntelligence";

test("assistant controls preserve voice, prompts and explicitly disabled capabilities", () => {
  const metadata = {voiceRuntime: {engine: "gemini-live", voice: "Zephyr"}, directionPrompts: {outbound: "SAVED"}, intelligence: {future: "preserved"}};
  const form = new FormData();
  for (const {key} of INTELLIGENCE_FEATURES) if (key !== "emotion") form.set(`intelligence_${key}`, "true");
  const saved = withIntelligenceSettings(metadata, form);
  assert.deepEqual(saved.voiceRuntime, metadata.voiceRuntime);
  assert.deepEqual(saved.directionPrompts, metadata.directionPrompts);
  assert.equal(intelligenceSettings(saved).emotion, false);
  assert.equal(intelligenceSettings(saved).recovery, true);
  assert.equal((saved.intelligence as {future: string}).future, "preserved");
});

test("old assistant metadata gets defaults; unrecognised call reports are not rendered", () => {
  assert.equal(intelligenceSettings(null).quality, true);
  assert.equal(callIntelligenceReport({callIntelligence: {version: 2}}), null);
  assert.equal(callIntelligenceReport({callIntelligence: {version: 1}})?.version, 1);
});

test("actual call report distinguishes missing evidence, queued email, and measured room timing", () => {
  const empty = renderToStaticMarkup(createElement(CallIntelligence, {metadata: null}));
  assert.match(empty, /No intelligence report was recorded/);
  const html = renderToStaticMarkup(createElement(CallIntelligence, {metadata: {callIntelligence: {
    version: 1, outcome: {booking: "confirmed", email: "queued", transfer: "not_recorded"},
    quality: {flags: ["tool_errors"], response_samples: 1, room_response_p95_ms: 800},
  }}}));
  assert.match(html, /queued/);
  assert.match(html, /Review needed/);
  assert.match(html, /800 ms/);
  assert.match(html, /handset latency/);
});
