import Sidebar from "@/components/Sidebar";
import AdminContainer from "@/components/AdminContainer";
import { SidebarProvider } from "@/lib/sidebar-context";
import LiveLogsInstrumentation from "@/components/LiveLogsInstrumentation";
import AdminToolbar from "@/components/AdminToolbar";
import { CurrencyProvider } from "@/lib/currency-context";
import { getUsdInrRate } from "@/lib/currency";

// Admin pages read from Postgres on every request — never prerender at build time.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CurrencyProvider fx={await getUsdInrRate()}><SidebarProvider>
    <div className="min-h-screen text-white flex">
      {/* Client-only: feeds navigation, frontend errors & API failures into the
          unified Live Logs stream. Renders nothing. */}
      <LiveLogsInstrumentation />
      <Sidebar />
      {/* `overflow-y-auto` was removed from <main>. MEASURED: it never
          scrolled (scrollTop stayed 0 while window.scrollY reached 653) —
          the outer div is min-h-screen, so main grows and the DOCUMENT
          scrolls. But an overflow-y-auto ancestor becomes the scroll
          container for `position: sticky`, so the header below was anchored
          to an element that never moved and scrolled away with the page.
          Dropping it makes the viewport the scroll container, which is what
          the sidebar's own `sticky top-3` already assumed. */}
      {/* min-w-0: a flex item defaults to min-width:auto and refuses to shrink
          below its content. overflow-y-auto used to impose that constraint as
          a side effect; without it main grew to 262px at a 390px viewport and
          pushed the document to 530px wide. min-w-0 restores the shrink
          without reintroducing a scroll container that breaks sticky. */}
      {/* Mobile reserves the compact navigation rail. Expanding navigation
          overlays the content instead of reducing it to a narrow column. */}
      <main className="min-w-0 flex-1 max-md:pl-[84px]">
        {/* Sticky top bar — the single instance of the theme control.
            Sticks to the viewport and stays visible for the whole length of
            <main>, i.e. the entire page.

            z-30 is deliberate: above page content, but BELOW every dialog and
            popover in the app (modals use z-50 / z-[70]), so it can never
            cover an open prompt editor, import dialog or tooltip panel.

            The background is the theme token, not a literal colour, so
            scrolling content cannot show through in either theme. */}
        <AdminToolbar />
        {/* Width is route-scoped: /assistants gets the full content area,
            every other page keeps the original centered max-w-6xl. */}
        <AdminContainer>{children}</AdminContainer>
      </main>
    </div>
    </SidebarProvider></CurrencyProvider>
  );
}
