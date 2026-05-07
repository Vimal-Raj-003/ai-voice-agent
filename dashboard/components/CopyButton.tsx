"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

// Tiny button used by code blocks in the docs page. Click → writes to
// clipboard, swaps icon for ~2s, reverts. Uses navigator.clipboard which
// requires a secure context (https/localhost) — degrades silently if not
// available.
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — clipboard API blocked
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      className="absolute top-2 right-2 inline-flex items-center gap-1 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-white hover:bg-black/50 transition"
    >
      {copied ? (
        <>
          <Check size={10} className="text-emerald-400" /> Copied
        </>
      ) : (
        <>
          <Copy size={10} /> Copy
        </>
      )}
    </button>
  );
}
