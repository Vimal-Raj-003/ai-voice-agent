"use client";
import { useState, useTransition } from "react";

export default function TargetsUploader({
  action,
}: {
  action: (fd: FormData) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("csv", text);
        start(() => action(fd).then(() => setText("")));
      }}
      className="space-y-3"
    >
      <textarea
        rows={6}
        placeholder={"phone,lead_name\n+919876543210,Ravi"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 font-mono text-xs"
      />
      <button
        disabled={pending || !text.trim()}
        className="rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload targets"}
      </button>
    </form>
  );
}
