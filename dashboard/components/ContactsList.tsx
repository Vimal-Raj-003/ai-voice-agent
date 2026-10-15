"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Users, Eye, Pencil, Trash2, Loader2, Check, AlertCircle } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { deleteContact } from "@/app/(admin)/contacts/actions";

export type ContactLite = {
  phoneNumber: string;
  name: string | null;
  email: string | null;
  tags: string[];
  isBooked: boolean;
};

function Toast({ kind, message }: { kind: "success" | "error"; message: string }) {
  const ok = kind === "success";
  return (
    <div
      className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
          : "border-red-500/30 bg-red-500/15 text-red-200"
      }`}
    >
      {ok ? <Check size={16} /> : <AlertCircle size={16} />} {message}
    </div>
  );
}

export default function ContactsList({ contacts }: { contacts: ContactLite[] }) {
  const [items, setItems] = useState(contacts);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [, start] = useTransition();

  const flash = (kind: "success" | "error", message: string) => {
    setToast({ kind, message });
    setTimeout(() => setToast(null), 2600);
  };

  const onRemove = (c: ContactLite) => {
    if (deleting) return;
    const label = c.name || c.phoneNumber;
    if (!confirm(`Remove ${label}? This cannot be undone.`)) return;
    setDeleting(c.phoneNumber);
    start(async () => {
      const r = await deleteContact(c.phoneNumber);
      setDeleting(null);
      if (r.ok) {
        setItems((prev) => prev.filter((x) => x.phoneNumber !== c.phoneNumber));
        flash("success", "Contact removed successfully");
      } else {
        flash("error", r.error || "Failed to remove contact.");
      }
    });
  };

  if (items.length === 0) {
    return (
      <>
        <EmptyState
          icon={Users}
          title="No contacts yet"
          description="Add a contact with “New contact”, or bulk-load your address book with “Import CSV”. Contacts also appear automatically after calls."
        />
        {toast && <Toast {...toast} />}
      </>
    );
  }

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="hidden grid-cols-[1.4fr_1fr_1.4fr_1fr_auto] gap-4 border-b border-white/10 px-4 py-2 text-[10px] uppercase tracking-widest text-gray-500 md:grid">
        <span>Name</span><span>Phone</span><span>Email</span><span>Tags</span><span className="text-right">Actions</span>
      </div>
      <div className="divide-y divide-white/5">
        {items.map((c) => {
          const href = `/contacts/${encodeURIComponent(c.phoneNumber)}`;
          const isDel = deleting === c.phoneNumber;
          return (
            <div
              key={c.phoneNumber}
              className={`grid grid-cols-1 items-center gap-2 p-4 transition hover:bg-white/[0.02] md:grid-cols-[1.4fr_1fr_1.4fr_1fr_auto] md:gap-4 ${isDel ? "opacity-50" : ""}`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name || <span className="text-gray-400">Unnamed</span>}</div>
                {c.isBooked && (
                  <span className="mt-0.5 inline-block rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">Booked</span>
                )}
              </div>
              <div className="truncate font-mono text-xs text-gray-400">{c.phoneNumber}</div>
              <div className="truncate text-sm text-gray-400">{c.email || <span className="text-gray-600">—</span>}</div>
              <div className="flex flex-wrap gap-1">
                {c.tags.length ? c.tags.slice(0, 4).map((t, i) => (
                  <span key={i} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-300">{t}</span>
                )) : <span className="text-gray-600">—</span>}
              </div>
              <div className="flex shrink-0 items-center justify-start gap-2 md:justify-end">
                <Link
                  href={href}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs text-gray-200 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <Eye size={14} /> View
                </Link>
                <Link
                  href={`${href}#edit`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-400/50 bg-violet-500/20 px-3 text-xs font-medium text-violet-100 transition hover:bg-violet-500/30 hover:text-white"
                >
                  <Pencil size={14} /> Edit
                </Link>
                <button
                  type="button"
                  onClick={() => onRemove(c)}
                  disabled={isDel}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/15 px-3 text-xs font-medium text-red-200 transition hover:bg-red-500/30 hover:text-white active:scale-95 disabled:opacity-50"
                >
                  {isDel ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {toast && <Toast {...toast} />}
    </div>
  );
}
