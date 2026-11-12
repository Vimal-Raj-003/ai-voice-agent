import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import test from "node:test";
import {ConnectionState, getLogger, LoggerNames, type Room} from "livekit-client";
import {attachRoomLifecycleLogging, disconnectOnce, installLiveKitLogRouting} from "../lib/livekitLifecycle";

test("actual SDK logging keeps expected remote channel aborts off the fatal error channel before Disconnected", async () => {
  Object.defineProperty(globalThis, "window", {value: {}, configurable: true});
  const originalError = console.error, originalWarn = console.warn, originalDebug = console.debug;
  const errors: unknown[][] = [], warnings: unknown[][] = [];
  console.error = (...args) => { errors.push(args); };
  console.warn = (...args) => { warnings.push(args); };
  console.debug = () => {};
  const observed = Object.assign(new EventEmitter(), {state: ConnectionState.Connected, name: "synthetic"});
  const detach = attachRoomLifecycleLogging(observed as unknown as Room, "test");
  try {
    installLiveKitLogRouting();
    const logger = getLogger(LoggerNames.Engine);
    logger.error("DataChannel error on lossy: User-Initiated Abort, reason={}", {room: "synthetic"});
    logger.error("publisher data channel 'LOSSY' closed unexpectedly", {room: "synthetic"});
    assert.equal(errors.length, 0);
    assert.equal(warnings.length, 2);
    logger.error("failed to authenticate signaling connection", {status: 401});
    assert.equal(errors.length, 1, "genuine failures must remain visible");
    observed.state = ConnectionState.Connecting;
    logger.error("DataChannel error on reliable: DTLS negotiation failed");
    assert.equal(errors.length, 2, "a connecting room is not evidence of an intentional teardown");
  } finally {
    detach();
    console.error = originalError; console.warn = originalWarn; console.debug = originalDebug;
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("concurrent disconnect callers await the same actual teardown", async () => {
  let release!: () => void;
  let count = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const room = {disconnect: () => { count++; return pending; }} as unknown as Room;
  const first = disconnectOnce(room, "test", "end");
  const second = disconnectOnce(room, "test", "unmount");
  let settled = false;
  void second.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await Promise.all([first, second]);
  assert.equal(count, 1);
  await disconnectOnce(room, "test", "late cleanup");
  assert.equal(count, 1);
});
