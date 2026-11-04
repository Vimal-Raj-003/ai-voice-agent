export type RangeKey = "24h" | "7d" | "14d" | "30d" | "overall";

export const RANGE_OPTIONS: { value: RangeKey; label: string; daysBack: number | null }[] = [
  { value: "24h", label: "Last 24 hours", daysBack: 1 },
  { value: "7d", label: "Last 7 days", daysBack: 7 },
  { value: "14d", label: "Last 14 days", daysBack: 14 },
  { value: "30d", label: "Last 30 days", daysBack: 30 },
  { value: "overall", label: "Overall", daysBack: null },
];

export function overviewRange(raw?: string, now = new Date()) {
  const option = RANGE_OPTIONS.find((item) => item.value === raw?.toLowerCase()) ?? RANGE_OPTIONS[2];
  const is24h = option.value === "24h";
  return {
    ...option,
    is24h,
    badge: option.daysBack === null ? "Overall" : is24h ? "24 hours" : `${option.daysBack} days`,
    since: option.daysBack === null ? null : new Date(now.getTime() - option.daysBack * 86400000),
  };
}

export function overallDaysBack(earliest: Date | undefined, now = new Date()): number {
  if (!earliest) return 1;
  const utcDay = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  return Math.max(1, Math.floor((utcDay(now) - utcDay(earliest)) / 86400000) + 1);
}
