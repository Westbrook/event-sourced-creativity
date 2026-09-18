import assert from "node:assert/strict";
import test from "node:test";
import { storageFixture, identityFor, savedWinner, expiredCleanupWitness, snapshot, row,
  traceStatements, statementSummary, policy, digest } from "./helpers/private-identity-admission-fixture.mjs";

const observations = [];
try {
  for (const domain of ["canvas", "copy"]) for (const mode of ["personal", "scoped"]) for (const guarded of [false, true]) {
    await test("healthy identity admission keeps exact bytes and custody / " + [domain, mode, guarded].join("/"), { timeout: 30000 }, async t => {
      const f = await storageFixture(t, mode), identity = await identityFor(domain, f.owner, "storage-healthy-operation-0001");
      const witness = await expiredCleanupWitness(f), content = "Original exact UTF-8\n日本語 {\"saved\":true}";
      const saved = await policy.storePrivateContent(f.state.env, f.owner, "authoring-preview", content, f.scope,
        guarded ? { sql: "1", bindings: [] } : undefined, undefined, identity);
      assert.equal(saved.contentId, identity.contentId); const stored = row(f.state, saved.contentId);
      assert.equal(stored.content, content); assert.equal(stored.kind, "authoring-preview"); assert.equal(stored.owner_id, f.owner);
      assert.equal(stored.expires_at, saved.expiresAt); assert.equal(stored.redacted_at, null);
      assert.equal(row(f.state, witness.contentId).content, "", "Admitted storage retains existing maintenance behavior");
      const resource = f.state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(saved.contentId);
      const retention = f.state.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(saved.contentId);
      if (f.scope) {
        assert.equal(resource.project_access_id, f.scope.projectAccessId); assert.equal(resource.actor_user_id, f.owner); assert.equal(resource.visibility, "actor_private");
        assert.equal(retention.project_access_id, f.scope.projectAccessId); assert.equal(retention.actor_user_id, f.owner);
        assert.equal(retention.classification, "governed-evidence"); assert.equal(retention.assigned_expires_at, stored.expires_at);
      } else { assert.equal(resource, undefined); assert.equal(retention, undefined); }
      observations.push({ domain, mode, guarded, case: "healthy", maximumBindings: f.state.controls.maxBindings });
    });
  }
  for (const domain of ["canvas", "copy"]) for (const mode of ["personal", "scoped"]) for (const lifecycle of ["retained", "erased"]) {
    await test("occupied identity retains insert-only original winner / " + [domain, mode, lifecycle].join("/"), { timeout: 30000 }, async t => {
      const f = await storageFixture(t, mode), identity = await identityFor(domain, f.owner, "storage-winner-operation-0001");
      await savedWinner(f, identity, f.scope, lifecycle); await expiredCleanupWitness(f);
      const before = snapshot(f.state), trace = traceStatements(f.state);
      try {
        await assert.rejects(() => policy.storePrivateContent(f.state.env, f.owner, "authoring-preview", "Never replace or resurrect",
          f.scope, { sql: "1", bindings: [] }, undefined, identity), /UNIQUE constraint/u);
      } finally { trace.restore(); }
      assert.deepEqual(snapshot(f.state), before);
      const statements = statementSummary(trace); assert.equal(statements.resourceStatements, 0); assert.equal(statements.retentionStatements, 0); assert.equal(statements.cleanupStatements, 0);
      observations.push({ domain, mode, lifecycle, case: "occupied-pk", statements });
    });
  }
  for (const mode of ["personal", "scoped"]) await test("all default private kinds and prepared SQL remain ordinary / " + mode, { timeout: 30000 }, async t => {
    const f = await storageFixture(t, mode), ids = [], sql = [];
    const kinds = ["prompt", "provider-output", "provider-response", "intent", "condition", "critique", "adaptive-intent", "adaptive-structure", "chat-user", "chat-assistant", "ideation-prompt", "document-artifact", "document-artifact-input", "activity-issue-note", "execution-consent", "context-proposal", "authoring-preview"];
    for (const kind of kinds) for (const guarded of [false, true]) {
      const prepared = await policy.preparePrivateContent(f.state.env, f.owner, kind, "Ordinary default content", f.scope,
        undefined, guarded ? { sql: "1", bindings: [] } : undefined);
      assert.match(prepared.contentId, /^[a-f0-9-]{36}$/u); ids.push(prepared.contentId);
      assert.equal(prepared.requiredInserts, f.scope ? 3 : 1);
      sql.push({ kind, guarded, sha256: prepared.statements.map(statement => digest(statement.sql)) });
      const results = await f.state.env.DB.batch(prepared.statements);
      assert.ok(results.slice(0, prepared.requiredInserts).every(result => Number(result.meta.changes) === 1));
      assert.equal(row(f.state, prepared.contentId).content, "Ordinary default content");
    }
    assert.equal(new Set(ids).size, 34);
    const before = snapshot(f.state), denied = await policy.preparePrivateContent(f.state.env, f.owner, "prompt", "Prepared but not dispatched", f.scope, undefined, { sql: "0", bindings: [] });
    sql.push({ kind: "prompt", guarded: "denied-not-dispatched", sha256: denied.statements.map(statement => digest(statement.sql)) });
    assert.deepEqual(snapshot(f.state), before);
    observations.push({ mode, case: "defaults", kinds: 17, randomIds: ids.length, sql });
  });
  for (const mode of ["personal", "scoped"]) await test("denied identity never executes publication statements / " + mode, { timeout: 30000 }, async t => {
    const f = await storageFixture(t, mode), identity = await identityFor("canvas", f.owner, "storage-publication-operation-0001");
    const witness = await policy.storePrivateContent(f.state.env, f.owner, "prompt", "Original publication witness", f.scope), before = snapshot(f.state);
    let construction = 0; const trace = traceStatements(f.state);
    try {
      await assert.rejects(() => policy.storePrivateContent(f.state.env, f.owner, "authoring-preview", "Denied private body", f.scope,
        { sql: "0", bindings: [] }, () => {
          construction++; return [f.state.env.DB.prepare("UPDATE private_content SET content=? WHERE content_id=?").bind("Publication must not execute", witness.contentId)];
        }, identity), /project_private_content_access_revoked/u);
    } finally { trace.restore(); }
    assert.equal(construction, 1, "The unchanged callback still constructs statements before batch dispatch");
    assert.equal(trace.entries.some(entry => entry.sql === "UPDATE private_content SET content=? WHERE content_id=?"), false);
    assert.deepEqual(snapshot(f.state), before); observations.push({ mode, case: "denied-publication", constructed: 1, executed: 0 });
  });
  await test("identity denial normalization is narrow and preserves UNIQUE and unrelated errors", { timeout: 30000 }, async t => {
    const f = await storageFixture(t, "personal"), identity = await identityFor("canvas", f.owner, "storage-error-operation-0001"), batch = f.state.env.DB.batch;
    const contentDenial = "NOT NULL constraint failed: private_content.content";
    const normalize = [new Error(contentDenial), new Error("D1_ERROR: " + contentDenial + ": SQLITE_CONSTRAINT"),
      new Error("D1_ERROR", { cause: new Error(contentDenial) })];
    const preserve = [new Error("UNIQUE constraint failed: private_content.content_id"), new Error("NOT NULL constraint failed: private_content.owner_id"),
      new Error(contentDenial + "_other"), new Error("Unrelated storage failure"), contentDenial];
    try {
      for (const error of [...normalize, ...preserve]) {
        f.state.env.DB.batch = async () => { throw error; };
        try { await policy.storePrivateContent(f.state.env, f.owner, "authoring-preview", "Original", undefined, { sql: "0", bindings: [] }, undefined, identity); assert.fail("Must reject"); }
        catch (actual) {
          if (normalize.includes(error)) { assert.equal(actual.message, "project_private_content_access_revoked"); assert.equal(actual.cause, error); }
          else assert.equal(actual, error);
        }
      }
      const error = normalize[0]; f.state.env.DB.batch = async () => { throw error; };
      await assert.rejects(() => policy.storePrivateContent(f.state.env, f.owner, "prompt", "Ordinary caller", undefined, { sql: "0", bindings: [] }), actual => actual === error);
    } finally { f.state.env.DB.batch = batch; }
    observations.push({ case: "error-normalization", expected: normalize.length, preserved: preserve.length, ordinaryErrorPreserved: true });
  });
} finally { console.log("PRIVATE_IDENTITY_CONTROLS " + JSON.stringify({ observations })); }
