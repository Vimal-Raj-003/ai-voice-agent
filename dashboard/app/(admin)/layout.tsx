import Sidebar from "@/components/Sidebar";
import LiveLogsInstrumentation from "@/components/LiveLogsInstrumentation";

// Admin pages read from Postgres on every request — never prerender at build time.
export const dynamic = "force-dynamic";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen text-white flex">
      {/* Client-only: feeds navigation, frontend errors & API failures into the
          unified Live Logs stream. Renders nothing. */}
      <LiveLogsInstrumentation />
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">{children}</div>
      </main>
    </div>
  );
}
