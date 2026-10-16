import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { UserPlus, Ban, Hash, PhoneCall, Users } from "lucide-react";
import ContactImport from "@/components/ContactImport";
import SavedToast from "@/components/SavedToast";
import ContactsList, { type ContactLite } from "@/components/ContactsList";
import DncSection from "@/components/DncSection";
import PhoneNumbersSection from "@/components/PhoneNumbersSection";
import CallsSection from "@/components/CallsSection";

// Contacts / Phone numbers / Calls / Do-Not-Call are sections of this one page,
// selected by ?section=. A search param (not client state) because every
// section except Contacts is a SERVER component that reads with prisma and
// submits server actions — the same code that ran at /phone-numbers, /calls and
// /dnd, reused rather than reimplemented. It also keeps deep links and browser
// back/forward working, and <Link> navigation is a soft transition (no reload).
type Section = "contacts" | "numbers" | "calls" | "dnc";

// The sections read rows whose server actions revalidate their OLD paths
// ("/dnd", "/phone-numbers"), not "/contacts". Rendering dynamically keeps
// those lists fresh here without editing any action.
export const dynamic = "force-dynamic";

// One source of truth for the primary nav, so all four buttons are guaranteed
// to share height, padding, radius, typography and spacing.
const NAV: { id: Section; label: string; icon: typeof Users }[] = [
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "numbers", label: "Phone Numbers", icon: Hash },
  { id: "calls", label: "Calls", icon: PhoneCall },
  { id: "dnc", label: "Do Not Call", icon: Ban },
];

// The cyan→violet→pink gradient from the existing design system (it previously
// styled New contact / Import CSV, which are now neutral so the primary nav is
// the only gradient on the page). `text-black` on this light gradient reads
// in BOTH themes (the gradient itself is not theme-remapped). The selected item
// KEEPS the gradient and is distinguished by a ring + stronger glow, while
// unselected items are dimmed — so the active state never loses the gradient.
const NAV_BASE =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-black " +
  "bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 transition " +
  "hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80";
const NAV_ACTIVE = "ring-2 ring-white/70 shadow-[0_0_20px_rgba(167,139,250,0.45)]";
const NAV_IDLE = "opacity-60 hover:opacity-100";

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  // Opening the page normally defaults to Contacts.
  const section: Section =
    sp.section === "dnc"
      ? "dnc"
      : sp.section === "numbers"
        ? "numbers"
        : sp.section === "calls"
          ? "calls"
          : "contacts";

  // Only the Contacts section needs the address book, so this query is skipped
  // entirely for the other three sections — no redundant fetching.
  let contacts: ContactLite[] = [];
  if (section === "contacts") {
    const rows = await prisma.contact.findMany({
      orderBy: [{ lastCallAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    contacts = rows.map((c) => ({
      phoneNumber: c.phoneNumber,
      name: c.name,
      email: c.email,
      tags: parseTags(c.tags),
      isBooked: c.isBooked,
    }));
  }

  return (
    <div className="space-y-6">
      <SavedToast />

      <div>
        <h1 className="text-3xl font-bold">Contacts</h1>
        <p className="mt-1 text-sm text-gray-400">
          Your customer address book, business phone numbers, call history and
          the Do-Not-Call list — all in one place.
        </p>
      </div>

      {/* Primary navigation — four options, Calls third, Do Not Call last. */}
      <nav
        aria-label="Contacts sections"
        className="flex flex-wrap items-center gap-2"
      >
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = section === id;
          return (
            <Link
              key={id}
              href={id === "contacts" ? "/contacts" : `/contacts?section=${id}`}
              aria-current={active ? "page" : undefined}
              className={`${NAV_BASE} ${active ? NAV_ACTIVE : NAV_IDLE}`}
            >
              <Icon size={15} /> {label}
            </Link>
          );
        })}
      </nav>

      {section === "contacts" ? (
        <div className="space-y-4">
          {/* Contact actions live INSIDE the Contacts section, not in the
              primary nav. Same handlers and endpoints as before. */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/contacts/new"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-gray-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
            >
              <UserPlus size={15} /> New contact
            </Link>
            <ContactImport />
          </div>
          <ContactsList contacts={contacts} />
        </div>
      ) : section === "numbers" ? (
        <PhoneNumbersSection />
      ) : section === "calls" ? (
        <CallsSection searchParams={sp} />
      ) : (
        <DncSection />
      )}
    </div>
  );
}
