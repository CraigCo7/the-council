import fs from "node:fs";
import path from "node:path";
import { simpleGit, SimpleGit } from "simple-git";
import { config } from "../config.js";
import { logger } from "../logger.js";

let _git: SimpleGit | null = null;
let _initialized = false;

export function vaultPath(): string {
  return path.resolve(config.vault.path);
}

/**
 * Lazy git client against the vault working tree.
 * On first use, clones the vault repo if it's not present locally.
 */
export async function git(): Promise<SimpleGit> {
  if (_git && _initialized) return _git;

  const dir = vaultPath();
  fs.mkdirSync(path.dirname(dir), { recursive: true });

  if (!fs.existsSync(path.join(dir, ".git"))) {
    logger.info({ dir, remote: config.vault.remote }, "cloning vault repo");
    const topLevel = simpleGit();
    await topLevel.clone(config.vault.remote, dir, ["--branch", config.vault.branch]);
  }

  _git = simpleGit(dir);
  await _git.addConfig("user.name", config.vault.gitUserName);
  await _git.addConfig("user.email", config.vault.gitUserEmail);
  _initialized = true;
  return _git;
}

/**
 * Pull latest from remote before any write, to minimize conflicts
 * with user edits from Obsidian on other devices.
 */
export async function syncPull(): Promise<void> {
  const g = await git();
  try {
    await g.pull("origin", config.vault.branch, { "--rebase": "true" });
  } catch (err) {
    logger.warn({ err }, "vault pull failed — continuing with local state");
  }
}

/**
 * Stage specific paths, commit, and push. Never `git add -A`.
 */
export async function commitAndPush(
  paths: string[],
  message: string,
): Promise<{ committed: boolean; hash?: string }> {
  const g = await git();
  const relativePaths = paths.map((p) => path.relative(vaultPath(), path.resolve(p)));

  await g.add(relativePaths);
  const status = await g.status();
  if (status.staged.length === 0) {
    return { committed: false };
  }

  const commit = await g.commit(message);
  try {
    await g.push("origin", config.vault.branch);
  } catch (err) {
    logger.error({ err }, "vault push failed — commit is local only");
  }
  return { committed: true, hash: commit.commit };
}
