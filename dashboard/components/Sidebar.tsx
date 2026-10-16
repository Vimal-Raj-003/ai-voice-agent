// Sidebar is a server component so it can read the NextAuth session and pass
// the admin's email to SignOutButton. Nav links live in a client child
// (SidebarNav) because they need usePathname for the active-route highlight.
//
// The shell (width, collapse control, which pieces show per mode) lives in the
// client component SidebarFrame; the session-dependent parts are rendered here
// and handed to it, so no server data has to move into the client.
import { auth } from "@/lib/auth";
import QuickDispatch from "./QuickDispatch";
import SidebarNav from "./SidebarNav";
import SidebarFrame from "./SidebarFrame";
import SidebarFooter from "./SidebarFooter";
import SignOutButton from "./SignOutButton";

export default async function Sidebar() {
  const session = await auth();
  return (
    <SidebarFrame
      quickDispatch={<QuickDispatch />}
      nav={<SidebarNav />}
      footer={<SidebarFooter signOut={<SignOutButton email={session?.user?.email} />} />}
    />
  );
}
