import { LinearClient } from "@linear/sdk";
import { config } from "../config.js";

let _client: LinearClient | null = null;

/**
 * Lazy-initialized Linear SDK client. Returns null when LINEAR_API_KEY
 * is empty — that's the disabled state, and callers should treat Linear
 * as not present (vault-only behavior).
 *
 * The SDK keeps an internal request pool, so reusing a single client
 * across the process is correct.
 */
export function linearClient(): LinearClient | null {
  if (!config.linear.apiKey) return null;
  if (_client) return _client;
  _client = new LinearClient({ apiKey: config.linear.apiKey });
  return _client;
}

/** True when both the API key and team key are configured. */
export function linearEnabled(): boolean {
  return Boolean(config.linear.apiKey && config.linear.teamKey);
}

/** Build the canonical Linear URL for an issue identifier (e.g. "CNCL-42"). */
export function linearIssueUrl(identifier: string): string | null {
  if (!config.linear.workspaceSlug) return null;
  return `https://linear.app/${config.linear.workspaceSlug}/issue/${identifier}`;
}
