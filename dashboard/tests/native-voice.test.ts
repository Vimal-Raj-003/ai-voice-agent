import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceSettings, withVoiceSettings } from "../lib/native-voice";
import { preservePromptLineEndings } from "../lib/assistant-prompts";

test("native voice metadata preserves outbound prompt and unrelated assistant configuration", () => {
  const before = {directionPrompts: {outbound: "SAVED OUTBOUND"}, custom: {keep: true}};
  const after = withVoiceSettings(before, {engine: "gemini-live", model: "gemini-3.8-live", voice: "Zephyr"});
  assert.deepEqual(after.directionPrompts, before.directionPrompts);
  assert.deepEqual(after.custom, before.custom);
  assert.deepEqual(voiceSettings(after), {engine: "gemini-live", model: "gemini-3.8-live", voice: "Zephyr"});
  assert.equal(voiceSettings(null).engine, "inherit");
});

test("invalid engine/model/voice combinations cannot be saved", () => {
  for (const input of [
    {engine: "other", model: "gemini-3.8-live", voice: "Zephyr"},
    {engine: "gemini-live", model: "gemini-text-model", voice: "Zephyr"},
    {engine: "gemini-live", model: "gemini-3.8-live", voice: "kavya"},
  ]) assert.throws(() => withVoiceSettings({}, input));
});

test("a voice-only form save preserves business prompts despite browser CRLF normalization", () => {
  const saved = "தமிழ் instructions\nSecond instruction\n";
  assert.equal(preservePromptLineEndings(saved, saved.replace(/\n/g, "\r\n")), saved);
  assert.equal(preservePromptLineEndings(saved, "Actually edited instruction"), "Actually edited instruction");
});
