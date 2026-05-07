import { HelpCircle } from "lucide-react";

// Tiny CSS-only tooltip. A small (?) icon next to a label that, on hover or
// keyboard focus, reveals a styled popover with the help text. No JS, no
// portal, no library — just `group-hover` + absolute positioning.

type Props = {
  children: React.ReactNode;
  /** Width of the tooltip body in px. Default 240. */
  width?: number;
};

export default function InfoTooltip({ children, width = 240 }: Props) {
  return (
    <span className="group relative inline-flex items-center align-middle ml-1.5">
      <HelpCircle
        size={11}
        className="text-gray-500 hover:text-violet-300 focus:text-violet-300 transition cursor-help"
        tabIndex={0}
        aria-label="More info"
      />
      {/* Tooltip body — styled like the other popovers (opaque dark card,
          violet ring) so it never bleeds through. */}
      <span
        role="tooltip"
        style={{ width, backgroundColor: "rgba(11, 13, 32, 0.97)" }}
        className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-50 rounded-lg border border-violet-400/30 px-2.5 py-2 text-[10px] leading-snug text-gray-300 shadow-[0_12px_24px_-6px_rgba(0,0,0,0.7)] transition pointer-events-none normal-case tracking-normal"
      >
        {children}
      </span>
    </span>
  );
}
