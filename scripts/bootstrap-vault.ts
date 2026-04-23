/**
 * Bootstraps the council-vault GitHub repo from the seed in `vault-template/`.
 *
 * Requires:
 *   - `gh` CLI installed and authenticated (`gh auth login`)
 *   - git installed
 *
 * Usage:
 *   pnpm bootstrap-vault            # creates CraigCo7/council-vault (private)
 *   REPO=owner/name pnpm bootstrap-vault
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TEMPLATE = path.join(ROOT, "vault-template");
const STAGING = path.join(ROOT, ".vault-bootstrap");

const REPO = process.env.REPO ?? "CraigCo7/council-vault";
const BRANCH = process.env.BRANCH ?? "main";
const VISIBILITY = process.env.VISIBILITY ?? "private";

function run(cmd: string, cwd: string = ROOT): string {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8" });
}

function ensureTool(name: string, hint: string): void {
  try {
    execSync(`which ${name}`, { stdio: "ignore" });
  } catch {
    console.error(`Missing tool: ${name}\n  ${hint}`);
    process.exit(1);
  }
}

function main(): void {
  ensureTool("git", "install git");
  ensureTool("gh", "install with: brew install gh  (then: gh auth login)");

  try {
    execSync("gh auth status", { stdio: "ignore" });
  } catch {
    console.error("gh is not authenticated. Run: gh auth login");
    process.exit(1);
  }

  // Create GitHub repo (idempotent-ish: gh errors if it already exists).
  try {
    run(`gh repo create ${REPO} --${VISIBILITY} --description "Council vault — personal EA source of truth"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Name already exists/i.test(msg) && !/already exists/i.test(msg)) {
      console.error("gh repo create failed:");
      console.error(msg);
      process.exit(1);
    }
    console.log(`repo ${REPO} already exists — continuing`);
  }

  // Fresh staging copy.
  if (fs.existsSync(STAGING)) fs.rmSync(STAGING, { recursive: true, force: true });
  fs.mkdirSync(STAGING, { recursive: true });

  // Copy vault-template into staging.
  run(`cp -R "${TEMPLATE}/." "${STAGING}/"`);

  run("git init", STAGING);
  run(`git checkout -b ${BRANCH}`, STAGING);
  run("git add .", STAGING);
  run(`git commit -m "seed: initial vault structure"`, STAGING);
  run(`git remote add origin https://github.com/${REPO}.git`, STAGING);

  try {
    run(`git push -u origin ${BRANCH}`, STAGING);
  } catch (err) {
    console.error("push failed — if the repo already has commits, pull + rebase manually.");
    throw err;
  }

  console.log(`\n✅ Vault repo ready: https://github.com/${REPO}`);
  console.log(`Set VAULT_REMOTE in apps/backend/.env to:`);
  console.log(`  git@github.com:${REPO}.git   (SSH)`);
  console.log(`  or https://github.com/${REPO}.git   (HTTPS)`);

  fs.rmSync(STAGING, { recursive: true, force: true });
}

main();
