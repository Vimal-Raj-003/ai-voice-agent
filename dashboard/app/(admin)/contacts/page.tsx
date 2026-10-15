import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { UserPlus } from "lucide-react";
import ContactImport from "@/components/ContactImport";
import SavedToast from "@/components/SavedToast";
import ContactsList, { type ContactLite } from "@/components/ContactsList";

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

export default async function ContactsPage() {
  const rows = await prisma.contact.findMany({
    orderBy: [{ lastCallAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  const contacts: ContactLite[] = rows.map((c) => ({
    phoneNumber: c.phoneNumber,
    name: c.name,
    email: c.email,
    tags: parseTags(c.tags),
    isBooked: c.isBooked,
  }));

  return (
    <div className="space-y-6">
      <SavedToast />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Contacts</h1>
          <p className="mt-1 text-sm text-gray-400">
            Your customer / person address book — separate from Phone Numbers
            (business telephony lines). Add one manually or import a CSV.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/contacts/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-3 py-1.5 text-sm font-semibold text-black shadow-[0_0_20px_rgba(167,139,250,0.25)] transition hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200"
          >
            <UserPlus size={15} /> New contact
          </Link>
          <ContactImport />
        </div>
      </div>

      <ContactsList contacts={contacts} />
    </div>
  );
}
