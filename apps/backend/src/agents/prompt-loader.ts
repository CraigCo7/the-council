import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(__dirname, "prompts");

export type AgentRole =
  | "chief-of-staff"
  | "task-operator"
  | "strategic-analyst"
  | "intelligence-monitor"
  | "vault-manager";

// Raw (pre-render) cache — keyed by role. Rendered output depends on today's
// date, so we re-render on each call and let prompt-caching on the API side
// handle the hot path.
const rawCache = new Map<AgentRole, string>();

function readRaw(role: AgentRole): string {
  const hit = rawCache.get(role);
  if (hit) return hit;
  const raw = fs.readFileSync(path.join(PROMPT_DIR, `${role}.md`), "utf8");
  rawCache.set(role, raw);
  return raw;
}

/**
 * ISO date (YYYY-MM-DD) and weekday in the operator's timezone. Injected into
 * every agent prompt so the model never guesses the year from its training
 * cutoff. Deliberately stable within a calendar day — the API-side prompt
 * cache invalidates once at local midnight, which is the correct behavior.
 */
export function operatorToday(): { iso: string; weekday: string } {
  const now = new Date();
  const tz = config.operator.timezone;
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
  }).format(now);
  return { iso, weekday };
}

export function loadPrompt(role: AgentRole): string {
  const raw = readRaw(role);
  const today = operatorToday();
  return raw
    .replaceAll("{{operator_name}}", config.operator.name)
    .replaceAll("{{operator_timezone}}", config.operator.timezone)
    .replaceAll("{{projects}}", config.operator.projects.join(", "))
    .replaceAll("{{today_iso}}", today.iso)
    .replaceAll("{{today_weekday}}", today.weekday);
}
