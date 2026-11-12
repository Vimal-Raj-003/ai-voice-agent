import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import {RoomEvent, Track, DisconnectReason} from "livekit-client";

type ViewNode = {type: unknown; props: {children?: ViewNode | ViewNode[]; onClick?: () => Promise<void>}};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}

function harness() {
  const token = deferred<object>(), connect = deferred<void>(), microphone = deferred<void>();
  let cleanup!: () => void;
  let created = 0, enabled = 0, stopped = 0, disconnected = 0;
  const states: unknown[] = [];
  class FakeRoom extends EventEmitter {
    localParticipant = {
      setMicrophoneEnabled: async () => { enabled++; await microphone.promise; },
      audioTrackPublications: new Map([["late", {track: {stop: () => { stopped++; }}}]]),
    };
    constructor() { super(); created++; }
    async connect() { await connect.promise; }
  }
  const dependencies: Record<string, unknown> = {
    "react": {
      useRef: (current: unknown) => ({current}),
      useState: (value: unknown) => [value, (next: unknown) => states.push(next)],
      useEffect: (effect: () => () => void) => { cleanup = effect(); },
    },
    "react/jsx-runtime": jsx,
    "livekit-client": {Room: FakeRoom, RoomEvent, Track, DisconnectReason},
    "@/lib/livekitLifecycle": {
      installLiveKitLogRouting() {}, logMount: () => () => {}, logRoomConnect() {},
      attachRoomLifecycleLogging: () => () => {},
      disconnectOnce: async () => { disconnected++; },
    },
    "lucide-react": {}, "./DemoAudioMonitor": {default: "monitor"},
    "./Select":{default:'select'},
  };
  const exported: {default?: (props: object) => ViewNode} = {};
  const compiled = ts.transpileModule(readFileSync("components/DemoWidget.tsx", "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(compiled, {exports: exported, console, AbortController,
    fetch: () => token.promise, require: (name: string) => {
      if (!(name in dependencies)) throw new Error(name);
      return dependencies[name];
    }});
  const tree = exported.default!({});
  const buttons: ViewNode[] = [];
  const walk = (node: ViewNode | ViewNode[] | undefined) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node?.props) { if (node.type === "button") buttons.push(node); walk(node.props.children); }
  };
  walk(tree);
  return {start: buttons[0].props.onClick as () => Promise<void>, cleanup: () => cleanup(), token, connect, microphone,
    counts: () => ({created, enabled, stopped, disconnected}), states};
}

const prepared = {ok: true, json: async () => ({url: "wss://synthetic.invalid", token: "synthetic"})};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("leaving while demo token request is pending cannot create a room", async () => {
  const h = harness();
  const pending = h.start();
  h.cleanup();
  const count = h.states.length;
  h.token.resolve(prepared);
  await pending;
  assert.equal(h.counts().created, 0);
  assert.equal(h.states.length, count, "no state updates after unmount");
});

test("leaving during room connection cannot publish a microphone afterward", async () => {
  const h = harness();
  const pending = h.start();
  h.token.resolve(prepared);
  await tick();
  assert.equal(h.counts().created, 1);
  h.cleanup();
  h.connect.resolve();
  await pending;
  assert.equal(h.counts().enabled, 0);
  assert.equal(h.counts().disconnected, 1);
});

test("microphone permission completing after navigation stops the late track", async () => {
  const h = harness();
  const pending = h.start();
  h.token.resolve(prepared); h.connect.resolve();
  await tick();
  assert.equal(h.counts().enabled, 1);
  h.cleanup();
  h.microphone.resolve();
  await pending;
  assert.equal(h.counts().stopped, 1);
  assert.equal(h.counts().disconnected, 1);
});
