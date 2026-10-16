"use client";

// Shared collapsed/expanded state for the sidebar AND the main content, so the
// content can reclaim the width the sidebar gives up. Both sides read the same
// value instead of guessing.
//
// The preference lives in localStorage and is read through useSyncExternalStore
// rather than an effect: that is the supported way to subscribe to state owned
// outside React, it gives SSR an explicit snapshot (expanded) so hydration
// matches, and it avoids the cascading re-render an effect+setState would cause.
//
// Storage access is wrapped because it throws in some privacy modes; the
// fallback is simply "expanded, preference not remembered".
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

const KEY = "jilljill.sidebar.collapsed";

const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(v: boolean): void {
  try {
    window.localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* preference simply is not remembered */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Keep two tabs in step.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

type Ctx = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
};

const SidebarCtx = createContext<Ctx>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
});

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Server snapshot is "expanded": the sidebar renders full-width in the HTML
  // and narrows on hydration if that is the stored preference.
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  const setCollapsed = useCallback((v: boolean) => write(v), []);
  const toggle = useCallback(() => write(!read()), []);

  return (
    <SidebarCtx.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarCtx.Provider>
  );
}

export function useSidebar(): Ctx {
  return useContext(SidebarCtx);
}
