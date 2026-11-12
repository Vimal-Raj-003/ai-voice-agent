import { callIntelligenceReport, record } from "@/lib/call-intelligence";

const labels: Record<string, string> = {
  repeated_questions: "Repeated questions", address_policy_flags: "Address policy",
  unverified_booking_claims: "Booking claims without receipts", tool_errors: "Tool errors",
  terminal_errors: "Terminal provider errors",
  invalid_tool_arguments: "Invalid tool arguments",
};
function text(value: unknown, fallback = "Not recorded"): string {
  return typeof value === "string" ? value.replaceAll("_", " ") : fallback;
}
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export default function CallIntelligence({metadata}: {metadata: unknown}) {
  const report = callIntelligenceReport(metadata);
  if (!report) return <section className="glass rounded-2xl p-5 space-y-2" aria-labelledby="call-intelligence-heading">
    <h2 id="call-intelligence-heading" className="text-sm font-semibold uppercase tracking-widest text-gray-300">Conversation intelligence</h2>
    <p className="text-sm text-gray-400">No intelligence report was recorded for this call. New calls collect the checks enabled on the assistant.</p>
  </section>;
  const quality = record(report.quality), outcome = record(report.outcome);
  const emotion = record(report.emotion), recovery = record(report.recovery), memory = record(report.memory);
  const flags = Array.isArray(quality.flags) ? quality.flags.filter((f): f is string => typeof f === "string") : [];
  return <section className="glass rounded-2xl p-5 space-y-3" aria-labelledby="call-intelligence-heading">
    <h2 id="call-intelligence-heading" className="text-sm font-semibold uppercase tracking-widest text-gray-300">Conversation intelligence</h2>
    {report.mode === "read_only" && <p className="text-xs text-amber-200">Read-only call: external business actions were disabled.</p>}
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      {report.outcome != null && <>
        <div><dt className="text-xs text-gray-400">Booking receipt</dt><dd>{text(outcome.booking)}</dd></div>
        <div><dt className="text-xs text-gray-400">Email receipt</dt><dd>{text(outcome.email)}</dd></div>
        <div><dt className="text-xs text-gray-400">Human transfer</dt><dd>{text(outcome.transfer)}</dd></div>
      </>}
      {report.emotion != null && <div><dt className="text-xs text-gray-400">Latest tentative tone cue</dt><dd>{text(emotion.current)}</dd></div>}
      {report.memory != null && <div><dt className="text-xs text-gray-400">Retained call context</dt><dd>{count(memory.anchor_count)} anchors · {count(memory.recent_count)} recent items</dd></div>}
      {report.recovery != null && <div><dt className="text-xs text-gray-400">Call recovery</dt><dd>Output resumed {count(recovery.recovered)} / {count(recovery.attempts)} attempts</dd></div>}
      {report.quality != null && <>
        <div><dt className="text-xs text-gray-400">Room response p95</dt><dd>{typeof quality.room_response_p95_ms === "number" ? `${quality.room_response_p95_ms} ms` : "Not measured"} · {count(quality.response_samples)} samples</dd></div>
        <div><dt className="text-xs text-gray-400">Observed checks</dt><dd>{flags.length ? "Review needed" : "No flags observed"}</dd></div>
      </>}
    </dl>
    {flags.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-200">{flags.map(flag => <li key={flag}>{labels[flag] ?? text(flag)}</li>)}</ul>}
    <p className="text-xs text-gray-400">Outcomes use tool receipts. Timing uses SDK speech-end and room-playback events; handset latency, answer accuracy and human voice quality are not verified by this report.</p>
  </section>;
}
