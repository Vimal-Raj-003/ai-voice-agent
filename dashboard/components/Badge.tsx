// Shared status-style chip used across Calls / Contacts / Campaigns lists.
// Centralising the color mapping here keeps every list consistent and means
// adding a new outcome only requires touching this file.

type Tone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-white/10 text-white/80 border-white/15",
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  danger: "bg-red-500/15 text-red-300 border-red-500/30",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  muted: "bg-white/5 text-gray-400 border-white/10",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

export function outcomeTone(o?: string | null): Tone {
  switch (o) {
    case "BOOKED":
      return "success";
    case "NOT_INTERESTED":
    case "WRONG_NUMBER":
      return "warning";
    case "VOICEMAIL":
    case "NO_ANSWER":
    case "CALLBACK_REQUESTED":
      return "info";
    case "TRANSFERRED":
      return "info";
    case "COMPLETED":
      return "neutral";
    case "FAILED":
      return "danger";
    default:
      return "muted";
  }
}

export function statusTone(s?: string | null): Tone {
  switch (s) {
    case "COMPLETED":
      return "success";
    case "IN_PROGRESS":
    case "RINGING":
      return "info";
    case "QUEUED":
      return "neutral";
    case "FAILED":
    case "CANCELED":
    case "BUSY":
      return "danger";
    case "NO_ANSWER":
      return "warning";
    default:
      return "muted";
  }
}

export function sentimentTone(s?: string | null): Tone {
  switch ((s || "").toLowerCase()) {
    case "positive":
      return "success";
    case "neutral":
      return "neutral";
    case "negative":
    case "frustrated":
      return "danger";
    default:
      return "muted";
  }
}

export function campaignStatusTone(s?: string | null): Tone {
  switch (s) {
    case "RUNNING":
      return "success";
    case "PAUSED":
      return "warning";
    case "COMPLETED":
      return "info";
    case "FAILED":
      return "danger";
    case "DRAFT":
    default:
      return "muted";
  }
}

export function directionTone(d?: string | null): Tone {
  return d === "INBOUND" ? "info" : "neutral";
}
