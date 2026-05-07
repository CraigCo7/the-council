import { config } from "../config.js";
import { logger } from "../logger.js";
import { linearClient, linearEnabled } from "./client.js";

/**
 * Linear's mutations want UUIDs (teamId, projectId, labelIds, stateId)
 * but we operate on human-readable names. Resolve names → UUIDs once at
 * first use and cache for the process lifetime. Fly machines restart
 * frequently enough that staleness from operator-side Linear edits is
 * usually minor; the cache invalidates implicitly on redeploy.
 *
 * If you ever add a new project / label / workflow state in Linear's UI
 * and want the bot to see it without redeploying, add a refresh hook —
 * for now, the simpler model is good enough.
 */

type LookupCache = {
  teamId: string;
  projectIdsByName: Map<string, string>;
  labelIdsByName: Map<string, string>;
  workflowStateIdsByName: Map<string, string>;
};

let _cache: LookupCache | null = null;
let _loadInflight: Promise<LookupCache | null> | null = null;

/**
 * Get the lookup cache, fetching from Linear if not already loaded.
 * Returns null when Linear isn't enabled or when the API errors. Callers
 * should treat null as "Linear unreachable" and continue without it.
 */
export async function getLookups(): Promise<LookupCache | null> {
  if (_cache) return _cache;
  if (!linearEnabled()) return null;
  if (_loadInflight) return _loadInflight;
  _loadInflight = loadLookups()
    .then((c) => {
      _cache = c;
      return c;
    })
    .catch((err) => {
      logger.warn({ err }, "linear lookup load failed");
      return null;
    })
    .finally(() => {
      _loadInflight = null;
    });
  return _loadInflight;
}

async function loadLookups(): Promise<LookupCache> {
  const client = linearClient();
  if (!client) throw new Error("linear client unavailable");

  // Find the team by key
  const teams = await client.teams({ filter: { key: { eq: config.linear.teamKey } } });
  const team = teams.nodes[0];
  if (!team) {
    throw new Error(`linear team not found for key '${config.linear.teamKey}'`);
  }

  // Fetch the team's projects, labels (workspace + team-scoped both visible
  // through the issueLabels relation), and workflow states. All can run in
  // parallel.
  const [projects, labels, states] = await Promise.all([
    team.projects(),
    team.labels(),
    team.states(),
  ]);

  const projectIdsByName = new Map<string, string>();
  for (const p of projects.nodes) projectIdsByName.set(p.name, p.id);

  const labelIdsByName = new Map<string, string>();
  for (const l of labels.nodes) labelIdsByName.set(l.name.toLowerCase(), l.id);

  const workflowStateIdsByName = new Map<string, string>();
  for (const s of states.nodes) workflowStateIdsByName.set(s.name.toLowerCase(), s.id);

  logger.info(
    {
      team: team.key,
      teamId: team.id,
      projects: projects.nodes.length,
      labels: labels.nodes.length,
      states: states.nodes.length,
    },
    "linear lookups loaded",
  );

  return {
    teamId: team.id,
    projectIdsByName,
    labelIdsByName,
    workflowStateIdsByName,
  };
}

/** Force a refresh on next access. Used by tests + future admin endpoints. */
export function clearLookups(): void {
  _cache = null;
}
