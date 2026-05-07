"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, NotebookPen } from "lucide-react";
import { saveCallNotes } from "@/app/(admin)/calls/actions";

export default function CallNotesEditor({
  callId,
  initial,
}: {
  callId: string;
  initial: string | null;
}) {
  const [notes, setNotes] = useState(initial ?? "");
  const [pending, start] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    start(async () => {
      const fd = new FormData();
      fd.set("notes", notes);
      await saveCallNotes(callId, fd);
      setSavedAt(Date.now());
    });
  };

  const justSaved = savedAt && Date.now() - savedAt < 4000;

  return (
    <form onSubmit={onSubmit} className="glass rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <NotebookPen size={16} className="text-violet-300" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Notes
          </h2>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Saving
            </>
          ) : justSaved ? (
            <>
              <Check size={12} /> Saved
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Add your notes about this call — they appear in the contact's CRM history too."
        rows={4}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-y"
      />
    </form>
  );
}
