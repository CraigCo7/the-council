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

const cache = new Map<AgentRole, string>();

export function loadPrompt(role: AgentRole): string {
  const cached = cache.get(role);
  if (cached) return cached;

  const raw = fs.readFileSync(path.join(PROMPT_DIR, `${role}.md`), "utf8");
  const rendered = raw
    .replaceAll("{{operator_name}}", config.operator.name)
    .replaceAll("{{operator_timezone}}", config.operator.timezone)
    .replaceAll("{{projects}}", config.operator.projects.join(", "));

  cache.set(role, rendered);
  return rendered;
}
