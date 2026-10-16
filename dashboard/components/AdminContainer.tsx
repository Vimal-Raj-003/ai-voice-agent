"use client";

// The admin content container.
//
// Every page used to sit in `max-w-6xl mx-auto` (1152px), centered. On a 1920px
// display that leaves roughly 220px of dead gutter on each side of the content
// — which is the unused right-hand space on the Assistant configuration page.
// That page is a dense multi-column settings dashboard and is the one route
// that genuinely needs the full width.
//
// Widening the shared container for everything would change every other page's
// composition, so the wide width is opt-in by route: /assistants keeps the full
// content area, and every other route renders exactly as before.
import { usePathname } from "next/navigation";
import { useSidebar } from "@/lib/sidebar-context";

/** Routes that render a wide, multi-column dashboard. */
const WIDE_ROUTES = ["/assistants"];

export default function AdminContainer({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const { collapsed } = useSidebar();
  const wide = WIDE_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );
  // Collapsing the sidebar frees ~190px; the content takes it rather than
  // leaving new whitespace on the right. Wide routes simply stop being capped.
  const maxWidth = wide
    ? collapsed
      ? "max-w-none"
      : "max-w-[1700px]"
    : collapsed
      ? "max-w-[1400px]"
      : "max-w-6xl";
  return (
    <div className={`mx-auto px-8 py-10 ${maxWidth}`}>{children}</div>
  );
}
