import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceService } from "../lib/voice-service";

test("demo token survives the observed 2.85-second room allocation without orphaning its caller", async (t) => {
  const timers: Array<{ at: number; run: () => void }> = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    const controller = new AbortController();
    timers.push({ at: ms, run: () => controller.abort(new DOMException("Timed out", "TimeoutError")) });
    return controller.signal;
  });
  t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => new Promise((resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    timers.push({ at: 2853, run: () => resolve({ ok: true,
      json: async () => ({ token: "synthetic", room: "demo-gpt-live-offline", url: "wss://synthetic.invalid" }),
    }) });
  }));
  const pending = voiceService.demoToken().then((value) => ({ value }), (error) => ({ error }));
  for (const timer of timers.sort((a, b) => a.at - b.at)) {
    if (timer.at <= 3000) timer.run();
  }
  const result = await pending;
  assert(!("error" in result), "The dashboard aborted before the API returned the allocated room token");
  assert.equal(result.value.room, "demo-gpt-live-offline");
});
