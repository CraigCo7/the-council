import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { vaultPath } from "./client.js";

/**
 * Resolve a path inside the vault, rejecting any attempt to escape.
 */
export function vaultResolve(...segments: string[]): string {
  const root = vaultPath();
  const resolved = path.resolve(root, ...segments);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`path escapes vault: ${segments.join("/")}`);
  }
  return resolved;
}

export function exists(relPath: string): boolean {
  return fs.existsSync(vaultResolve(relPath));
}

export function readText(relPath: string): string {
  return fs.readFileSync(vaultResolve(relPath), "utf8");
}

export function writeText(relPath: string, content: string): void {
  const full = vaultResolve(relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

export function readMarkdown<T extends Record<string, unknown> = Record<string, unknown>>(
  relPath: string,
): { frontmatter: T; body: string } {
  const parsed = matter(readText(relPath));
  return { frontmatter: parsed.data as T, body: parsed.content };
}

export function writeMarkdown(
  relPath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): void {
  const file = matter.stringify(body, frontmatter);
  writeText(relPath, file);
}

/**
 * Delete a file from the vault. No-op if the file doesn't exist.
 * Used by the delete_task path; commitAndPush picks up the removal as a
 * normal git operation.
 */
export function deleteFile(relPath: string): void {
  const full = vaultResolve(relPath);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

export function listMarkdown(relDir: string): string[] {
  const full = vaultResolve(relDir);
  if (!fs.existsSync(full)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...listMarkdown(path.join(relDir, entry.name)));
    } else if (entry.name.endsWith(".md")) {
      out.push(path.join(relDir, entry.name));
    }
  }
  return out;
}

/**
 * Simple slug: lowercase, alphanumeric + hyphens, max 48 chars.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
