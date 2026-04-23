import { config } from "../config.js";

/**
 * Format a Date in the operator's timezone.
 * We use Intl.DateTimeFormat — no extra deps.
 */
export function toLocalISODate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.operator.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${day}`;
}

export function toLocalISODateTime(d: Date = new Date()): string {
  const date = toLocalISODate(d);
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.operator.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hh = timeParts.find((p) => p.type === "hour")!.value;
  const mm = timeParts.find((p) => p.type === "minute")!.value;
  const ss = timeParts.find((p) => p.type === "second")!.value;
  const offset = timezoneOffset(d);
  return `${date}T${hh}:${mm}:${ss}${offset}`;
}

/**
 * ISO week number in the operator timezone. Returns "YYYY-Www".
 */
export function toLocalISOWeek(d: Date = new Date()): string {
  // Shift to operator TZ via en-CA date, then compute ISO week.
  const local = new Date(toLocalISODate(d) + "T00:00:00Z");
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function compactDate(d: Date = new Date()): string {
  return toLocalISODate(d).replace(/-/g, "");
}

function timezoneOffset(d: Date): string {
  // Compute offset between local TZ and UTC.
  const tzFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.operator.timezone,
    timeZoneName: "longOffset",
  });
  const tzParts = tzFormatter.formatToParts(d);
  const offset = tzParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  // Normalize "GMT+08:00" -> "+08:00", "GMT" -> "+00:00"
  const match = offset.match(/GMT([+-]\d{2}):?(\d{2})?/);
  if (!match) return "+00:00";
  return `${match[1]}:${match[2] ?? "00"}`;
}
