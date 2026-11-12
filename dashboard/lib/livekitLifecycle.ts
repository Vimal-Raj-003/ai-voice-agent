"use client";

import { ConnectionState, getLogger, LoggerNames, type Room, RoomEvent } from "livekit-client";

// Room ownership and logger installation must survive Next development reloads.
type LifecycleState = {
  teardownUntil: number;
  observed: Set<Room>;
  closing: WeakMap<Room, Promise<void>>;
  installed: WeakSet<object>;
};
const key = Symbol.for("jilljill.livekit.lifecycle.v2");
const registry = globalThis as unknown as Record<symbol, LifecycleState>;
const state = registry[key] ??= {
  teardownUntil: 0, observed: new Set(), closing: new WeakMap(), installed: new WeakSet(),
};

export function isBenignTeardownMessage(message: string): boolean {
  // Unknown/DTLS/SCTP failures and unrelated closed channels remain errors.
  return /^DataChannel error on (lossy|reliable): User-Initiated Abort(?:,|$)/i.test(message)
    || /^publisher data channel '(LOSSY|RELIABLE)' closed unexpectedly$/i.test(message);
}

export function isInTeardownWindow(): boolean {
  for (const room of state.observed) {
    if (!state.closing.has(room) && room.state !== ConnectionState.Disconnected) return false;
  }
  return Date.now() < state.teardownUntil;
}

export function duringTeardown<T>(fn: () => T): T {
  state.teardownUntil = Date.now() + 4000;
  try { return fn(); }
  finally { state.teardownUntil = Date.now() + 4000; }
}

export function installLiveKitLogRouting(): void {
  if (typeof window === "undefined") return;
  for (const name of Object.values(LoggerNames)) {
    const logger = getLogger(name) as unknown as {
      methodFactory: (method: string, level: number, name: string | symbol) => (...args: unknown[]) => void;
      getLevel: () => number; setLevel: (level: number) => void;
    };
    if (state.installed.has(logger)) continue;
    const original = logger.methodFactory;
    logger.methodFactory = (method, level, name) => {
      const raw = original(method, level, name);
      if (method !== "error" && method !== "warn") return raw;
      return (...args: unknown[]) => {
        const message = typeof args[0] === "string" ? args[0] : "";
        if (!isBenignTeardownMessage(message)) return raw(...args);
        // Remote teardown can precede RoomEvent.Disconnected. Keep that case
        // visible as a warning; it is not proof of a healthy connection.
        if (isInTeardownWindow()) console.debug("[livekit teardown]", ...args);
        else console.warn("[livekit channel]", ...args);
      };
    };
    logger.setLevel(logger.getLevel());
    state.installed.add(logger);
  }
}

export function attachRoomLifecycleLogging(room: Room, ctx: string): () => void {
  const at = () => new Date().toISOString();
  const connected = () => console.info(`[lk:${ctx}] RoomEvent.Connected`, { at: at() });
  const reconnecting = () => console.warn(`[lk:${ctx}] RoomEvent.Reconnecting`, { at: at() });
  const reconnected = () => console.info(`[lk:${ctx}] RoomEvent.Reconnected`, { at: at() });
  const disconnected = (reason?: unknown) => {
    duringTeardown(() => {});
    console.info(`[lk:${ctx}] RoomEvent.Disconnected`, { reason: String(reason ?? "(none)"), at: at() });
  };
  room.on(RoomEvent.Connected, connected);
  room.on(RoomEvent.Reconnecting, reconnecting);
  room.on(RoomEvent.Reconnected, reconnected);
  room.on(RoomEvent.Disconnected, disconnected);
  state.observed.add(room);
  return () => {
    room.off(RoomEvent.Connected, connected);
    room.off(RoomEvent.Reconnecting, reconnecting);
    room.off(RoomEvent.Reconnected, reconnected);
    room.off(RoomEvent.Disconnected, disconnected);
    state.observed.delete(room);
  };
}

export function logRoomConnect(ctx: string, roomName?: string): void {
  console.info(`[lk:${ctx}] room.connect()`, { room: roomName, at: new Date().toISOString() });
}

export function disconnectOnce(room: Room | null, ctx: string, why: string): Promise<void> {
  if (!room) return Promise.resolve();
  const pending = state.closing.get(room);
  if (pending) return pending;
  // Store ownership before disconnect can synchronously emit room events.
  const operation = Promise.resolve().then(async () => {
    console.info(`[lk:${ctx}] room.disconnect()`, { why, at: new Date().toISOString() });
    duringTeardown(() => {});
    try { await room.disconnect(); }
    catch (error) { console.warn(`[lk:${ctx}] disconnect failed`, error); }
    finally { duringTeardown(() => {}); }
  });
  state.closing.set(room, operation);
  return operation;
}

export function logMount(ctx: string): () => void {
  console.info(`[lk:${ctx}] mount`, { at: new Date().toISOString() });
  return () => {
    console.info(`[lk:${ctx}] unmount`, { at: new Date().toISOString() });
    duringTeardown(() => {});
  };
}
