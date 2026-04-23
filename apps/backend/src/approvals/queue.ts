import { db } from "../db/sqlite.js";
import { toLocalISODateTime } from "../vault/time.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type Approval = {
  id: number;
  created_at: string;
  status: ApprovalStatus;
  summary: string;
  operation: string;
  payload: unknown;
  diff_preview: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
};

export function enqueue(input: {
  operation: string;
  summary: string;
  payload: unknown;
  diff_preview?: string;
}): number {
  const stmt = db().prepare(
    `INSERT INTO approvals (created_at, status, summary, operation, payload_json, diff_preview)
     VALUES (?, 'pending', ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    toLocalISODateTime(),
    input.summary,
    input.operation,
    JSON.stringify(input.payload),
    input.diff_preview ?? null,
  );
  return Number(info.lastInsertRowid);
}

export function listPending(): Approval[] {
  const rows = db()
    .prepare(`SELECT * FROM approvals WHERE status = 'pending' ORDER BY id ASC`)
    .all() as Array<Omit<Approval, "payload"> & { payload_json: string }>;
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    status: r.status,
    summary: r.summary,
    operation: r.operation,
    payload: JSON.parse(r.payload_json),
    diff_preview: r.diff_preview,
    resolved_at: r.resolved_at,
    resolved_by: r.resolved_by,
  }));
}

export function resolve(id: number, status: "approved" | "rejected", by = "user"): void {
  db()
    .prepare(
      `UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(status, toLocalISODateTime(), by, id);
}

export function get(id: number): Approval | null {
  const r = db()
    .prepare(`SELECT * FROM approvals WHERE id = ?`)
    .get(id) as (Omit<Approval, "payload"> & { payload_json: string }) | undefined;
  if (!r) return null;
  return {
    id: r.id,
    created_at: r.created_at,
    status: r.status,
    summary: r.summary,
    operation: r.operation,
    payload: JSON.parse(r.payload_json),
    diff_preview: r.diff_preview,
    resolved_at: r.resolved_at,
    resolved_by: r.resolved_by,
  };
}
