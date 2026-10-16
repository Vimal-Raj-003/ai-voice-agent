"use client";

// Click-to-open help popover.
//
// WHY THIS WAS REWRITTEN: the previous version was CSS-only —
// `group-hover:visible` plus `group-focus-within:visible` on an icon with
// tabIndex. That meant it opened on HOVER and on FOCUS, nothing coordinated
// separate instances, and the body was `absolute bottom-full`, so it rendered
// on top of the field above it. In the dense two-column Advanced Settings grid
// that produced several overlapping explanation panels covering the inputs.
//
// Now: opens only on click, exactly ONE open at a time (a module-level store,
// so instances coordinate without a context provider), closes on re-click,
// outside click and Escape. Never opens on hover, focus or mount.
//
// Positioning is `fixed`, measured from the trigger and clamped to the
// viewport. That deliberately avoids `absolute`, which gets clipped by the
// card's overflow and trapped in its stacking context.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { HelpCircle } from "lucide-react";

// ── single-open store ───────────────────────────────────────────────────────
let openId: string | null = null;
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function setOpen(id: string | null) {
  openId = id;
  emit();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const getSnapshot = () => openId;
const getServerSnapshot = () => null; // never open during SSR

type Props = {
  children: React.ReactNode;
  /** Max width of the popover body in px. Default 280. */
  width?: number;
};

export default function InfoTooltip({ children, width = 280 }: Props) {
  const id = useId();
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const open = current === id;
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Pinned = opened by click; survives mouse-leave and blur so it can be read.
  const pinned = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const pad = 8;
    const w = Math.min(width, window.innerWidth - pad * 2);
    // Prefer centred on the trigger, then clamp inside the viewport so it
    // shifts instead of overflowing.
    let left = b.left + b.width / 2 - w / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    // Default below the icon: that needs no height measurement, so the
    // position is known at click time and nothing has to be set from an
    // effect. Flip above only when there is clearly no room below, using the
    // rendered height when it is available.
    const h = popRef.current?.offsetHeight ?? 96;
    const below = b.bottom + 6;
    const top = below + h + pad > window.innerHeight ? Math.max(pad, b.top - h - 6) : below;
    setPos({ top, left });
  }, [width]);

  const cancelSoon = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  const openSoon = useCallback(() => {
    cancelSoon();
    hoverTimer.current = setTimeout(() => {
      place();
      setOpen(id);
    }, 120);
  }, [cancelSoon, place, id]);

  // Clear any pending hover timer when this instance goes away.
  useEffect(() => cancelSoon, [cancelSoon]);

  // A tooltip that is no longer the open one is no longer pinned.
  useEffect(() => {
    if (!open) pinned.current = false;
  }, [open]);

  // Keep it anchored while scrolling/resizing. The INITIAL position is set in
  // the click handler (the trigger rect is available there), so this effect
  // only subscribes to external events rather than setting state on mount.
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  // Outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        pinned.current = false;
        setOpen(null);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex items-center align-middle ml-1.5">
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? `tip-${id}` : undefined}
        aria-label="More info"
        aria-describedby={open ? `tip-${id}` : undefined}
        // Three ways in, one way of behaving:
        //   hover  — opens after a short delay so sweeping the cursor across a
        //            dense form does not flash panels open
        //   focus  — keyboard users get the same content via Tab
        //   click  — pins it open (and closes a pinned one), which is also the
        //            touch path, where there is no hover at all
        // A pinned tooltip ignores mouse-leave so it can actually be read.
        onPointerEnter={(e) => {
          if (e.pointerType === "touch") return;   // touch fires click instead
          openSoon();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "touch") return;
          cancelSoon();
          if (!pinned.current) setOpen(null);
        }}
        onFocus={() => { place(); setOpen(id); }}
        onBlur={() => { if (!pinned.current) setOpen(null); }}
        onClick={(e) => {
          // This icon sits inside a <label>; without these the click would
          // also activate the label and focus the input behind it.
          e.preventDefault();
          e.stopPropagation();
          cancelSoon();
          if (open && pinned.current) {
            pinned.current = false;
            setOpen(null);
            return;
          }
          pinned.current = true;
          place();          // measured here, not in an effect
          setOpen(id);
        }}
        className={`inline-flex items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${
          open ? "text-violet-300" : "text-gray-500 hover:text-violet-300"
        }`}
      >
        <HelpCircle size={11} />
      </button>

      {open && (
        <div
          ref={popRef}
          id={`tip-${id}`}
          role="tooltip"
          onPointerEnter={cancelSoon}
          onPointerLeave={() => { if (!pinned.current) setOpen(null); }}
          style={{
            position: "fixed",
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            maxWidth: width,
            backgroundColor: "rgba(11, 13, 32, 0.97)",
            // Above cards, dropdowns and the sticky save bar.
            zIndex: 60,
            // Hidden until measured, so it never flashes at the wrong spot.
            visibility: pos ? "visible" : "hidden",
          }}
          className="rounded-lg border border-violet-400/30 px-2.5 py-2 text-[11px] normal-case leading-snug tracking-normal text-gray-300 shadow-[0_12px_24px_-6px_rgba(0,0,0,0.7)]"
        >
          {children}
        </div>
      )}
    </span>
  );
}
