"use client";

// LiveKit room lifecycle logging + teardown-noise handling.
//
// Two jobs, deliberately in one place:
//
//  1. OBSERVE. Every room logs Connected / Reconnecting / Reconnected /
//     Disconnected (with reason), plus explicit connect/disconnect calls and
//     component mount/unmount. Without this there is no way to tell whether a
//     DataChannel error happened mid-call or while tearing down.
//
//  2. DOWNGRADE, NARROWLY. WebRTC aborts its data channels when a peer
//     connection closes, and livekit-client logs that at error level. During an
//     intentional disconnect that is expected noise, not a fault. It is routed
//     to console.debug ONLY when all of these hold:
//       * the message matches a known benign DataChannel abort/closed string
//       * a room is currently disconnecting, or a component is unmounting
//     Anything else — including the same message during a healthy call — is
//     left exactly as livekit emitted it. The gate is what keeps this honest:
//     if these errors turn out to happen mid-call, they still surface loudly.
//
// Note on mechanism: livekit's own `setLogExtension` calls the console method
// FIRST and then the extension, so it can observe but cannot downgrade. Wrapping
// `methodFactory` (the same hook livekit uses) is the only way to change where
// a line goes without patching `console` globally.

import { getLogger, LoggerNames, type Room, RoomEvent } from "livekit-client";

/** Substrings of the WebRTC/livekit teardown messages we treat as expected. */
const BENIGN_TEARDOWN = [
  "datachannel error on lossy",
  "datachannel error on reliable",
  "user-initiated abort",
  "closed unexpectedly",          // "publisher data channel 'LOSSY' closed unexpectedly"
  "data channel is closed",
  "datachannel is closed",
];

/** Rooms currently being torn down, and components currently unmounting. */
let teardownDepth = 0;
const disconnecting = new Set<Room>();

/** Exported for tests: is a teardown window currently open? */
export function isInTeardownWindow(): boolean {
  return inTeardown();
}

function inTeardown(): boolean {
  return teardownDepth > 0 || disconnecting.size > 0;
}

/** Exported for tests: is this one of the known benign teardown messages? */
export function isBenignTeardownMessage(msg: string): boolean {
  return isBenign(msg);
}

function isBenign(msg: string): boolean {
  const m = (msg || "").toLowerCase();
  return BENIGN_TEARDOWN.some((p) => m.includes(p));
}

/**
 * Mark a teardown window. Everything inside `fn` (and a short tail afterwards,
 * because the aborts land asynchronously as the peer connection unwinds) is
 * allowed to downgrade benign DataChannel noise.
 */
export function duringTeardown<T>(fn: () => T): T {
  teardownDepth++;
  try {
    return fn();
  } finally {
    // The DataChannel aborts arrive a tick or two after disconnect() returns.
    setTimeout(() => { teardownDepth = Math.max(0, teardownDepth - 1); }, 4000);
  }
}

let installed = false;

/**
 * Install the log router once per page. Safe to call repeatedly.
 */
export function installLiveKitLogRouting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  for (const name of Object.values(LoggerNames)) {
    try {
      // loglevel logger; livekit exposes it so consumers can adjust levels.
      const lg = getLogger(name) as unknown as {
        methodFactory: (m: string, l: number, n: string | symbol) => (...a: unknown[]) => void;
        getLevel: () => number;
        setLevel: (l: number) => void;
      };
      const original = lg.methodFactory;
      lg.methodFactory = (methodName, configLevel, loggerName) => {
        const raw = original(methodName, configLevel, loggerName);
        if (methodName !== "error" && methodName !== "warn") return raw;
        return (...args: unknown[]) => {
          const msg = typeof args[0] === "string" ? args[0] : "";
          if (isBenign(msg) && inTeardown()) {
            // Expected disconnect noise: keep it visible for debugging, but off
            // the error channel so it cannot raise the Next.js error overlay.
            console.debug("[livekit teardown]", msg, ...args.slice(1));
            return;
          }
          raw(...args);
        };
      };
      lg.setLevel(lg.getLevel());      // re-apply so the new factory takes effect
    } catch {
      /* a logger we cannot wrap is left entirely alone */
    }
  }
}

/**
 * Wire lifecycle logging onto a room. Returns a detach function that removes
 * every listener it added — call it from the component's cleanup so listeners
 * never accumulate across remounts.
 */
export function attachRoomLifecycleLogging(room: Room, ctx: string): () => void {
  const at = () => new Date().toISOString();
  const onConnected = () => console.info(`[lk:${ctx}] RoomEvent.Connected`, { sid: room.name, at: at() });
  const onReconnecting = () => console.warn(`[lk:${ctx}] RoomEvent.Reconnecting`, { at: at() });
  const onReconnected = () => console.info(`[lk:${ctx}] RoomEvent.Reconnected`, { at: at() });
  const onDisconnected = (reason?: unknown) => {
    // A disconnect is a teardown window even when the server initiated it.
    duringTeardown(() => {});
    console.info(`[lk:${ctx}] RoomEvent.Disconnected`, { reason: String(reason ?? "(none)"), at: at() });
  };

  room.on(RoomEvent.Connected, onConnected);
  room.on(RoomEvent.Reconnecting, onReconnecting);
  room.on(RoomEvent.Reconnected, onReconnected);
  room.on(RoomEvent.Disconnected, onDisconnected);

  return () => {
    room.off(RoomEvent.Connected, onConnected);
    room.off(RoomEvent.Reconnecting, onReconnecting);
    room.off(RoomEvent.Reconnected, onReconnected);
    room.off(RoomEvent.Disconnected, onDisconnected);
  };
}

/** Log an explicit connect attempt. */
export function logRoomConnect(ctx: string, roomName?: string): void {
  console.info(`[lk:${ctx}] room.connect()`, { room: roomName, at: new Date().toISOString() });
}

/**
 * Disconnect exactly once, inside a teardown window. Repeated calls are no-ops,
 * which is what stops a second disconnect from racing the first one's cleanup.
 */
export async function disconnectOnce(room: Room | null, ctx: string, why: string): Promise<void> {
  if (!room || disconnecting.has(room)) return;
  disconnecting.add(room);
  console.info(`[lk:${ctx}] room.disconnect()`, { why, at: new Date().toISOString() });
  try {
    await room.disconnect();
  } catch (e) {
    console.debug(`[lk:${ctx}] disconnect threw`, e);
  } finally {
    // Keep the window open briefly: the DataChannel aborts land after this.
    setTimeout(() => disconnecting.delete(room), 4000);
  }
}

/** Log component mount/unmount, and treat unmount as a teardown window. */
export function logMount(ctx: string): () => void {
  console.info(`[lk:${ctx}] mount`, { at: new Date().toISOString() });
  return () => {
    console.info(`[lk:${ctx}] unmount`, { at: new Date().toISOString() });
    duringTeardown(() => {});
  };
}
