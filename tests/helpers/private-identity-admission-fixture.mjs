import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture, actor, financialState, assertFree } from "./canvas-expired-disposition-fixture.mjs";
import * as policy from "../../worker/pilot-policy.ts";
import { canvasArrangementPreviewId, documentCopyPreviewId } from "../../worker/authoring-commits.ts";
import { executionContentCustodyGuard } from "../../worker/consequential-consent.ts";

export { policy };
export const digest = value => createHash("sha256").update(value).digest("hex");
export async function storageFixture(t, mode) {
  const blocked = t.mock.method(globalThis, "fetch", async () => assert.fail("No external/provider request"));
  const state = await fixture(mode === "scoped" ? "selected" : "personal");
  const owner = actor(state), scope = mode === "scoped" ? { organizationId: state.organizationId,
    projectAccessId: state.projectAccessId, projectId: state.projectId, ownerUserId: state.ownerId, actorUserId: owner } : undefined;
  const financial = financialState(state);
  t.after(() => {
    try { assert.deepEqual(financialState(state), financial); assertFree(state); assert.ok(state.controls.maxBindings <= 100); assert.equal(blocked.mock.callCount(), 0); }
    finally { state.sqlite.close(); }
  });
  return { state, owner, scope };
}
export const identityFor = async (domain, owner, operation) => ({ contentId: domain === "canvas"
  ? await canvasArrangementPreviewId(owner, operation) : await documentCopyPreviewId(owner, operation) });
export const snapshot = state => Object.fromEntries(["private_content", "project_resource_scopes",
  "private_content_retention_scopes", "authoring_commits", "events"].map(table =>
  [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
export const row = (state, id) => state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(id);
export function personalCustody(state, owner, contentId) {
  // The real custody predicate, with its storage-only binding inputs. This does
  // not construct an authoring plan or claim that any opaque body is applicable.
  const guard = executionContentCustodyGuard({ actorUserId: owner, scope: undefined });
  return Boolean(state.sqlite.prepare("SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND (" + guard.sql + ")")
    .get(contentId, owner, ...guard.bindings));
}
export async function savedWinner(f, identity, custody, lifecycle = "retained") {
  const saved = await policy.storePrivateContent(f.state.env, f.owner, "authoring-preview",
    '{"state":"review","opaque":"saved original fixture bytes 日本語"}', custody, undefined, undefined, identity);
  if (lifecycle === "erased") f.state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?")
    .run("2000-01-01T00:00:00.000Z", saved.contentId);
  return saved;
}
export async function expiredCleanupWitness(f) {
  const saved = await policy.storePrivateContent(f.state.env, f.owner, "prompt", "Expired original fixture content", f.scope);
  f.state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z", saved.contentId);
  return saved;
}
export function traceStatements(state) {
  const prepare = state.env.DB.prepare.bind(state.env.DB), entries = [];
  state.env.DB.prepare = sql => {
    const statement = prepare(sql), bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = bind(...values), execute = bound.execute.bind(bound);
      bound.execute = kind => {
        const entry = { sql, kind, changes: null, error: null }; entries.push(entry);
        try { const result = execute(kind); entry.changes = Number(result?.meta?.changes ?? 0); return result; }
        catch (error) { entry.error = error instanceof Error ? error.message : String(error); throw error; }
      };
      return bound;
    };
    return statement;
  };
  return { entries, restore() { state.env.DB.prepare = prepare; } };
}
export const statementSummary = trace => ({
  inserts: trace.entries.filter(entry => /^INSERT INTO private_content(?:\s|\()/u.test(entry.sql)).map(entry => ({ changes: entry.changes, error: entry.error })),
  resourceStatements: trace.entries.filter(entry => entry.sql.startsWith("INSERT INTO project_resource_scopes")).length,
  retentionStatements: trace.entries.filter(entry => entry.sql.startsWith("INSERT INTO private_content_retention_scopes")).length,
  cleanupStatements: trace.entries.filter(entry => entry.sql.startsWith("UPDATE private_content SET content='',redacted_at=")).length,
});
