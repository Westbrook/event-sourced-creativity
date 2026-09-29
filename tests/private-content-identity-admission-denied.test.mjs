import assert from "node:assert/strict";
import test from "node:test";
import { storageFixture, identityFor, savedWinner, expiredCleanupWitness, snapshot, personalCustody,
  traceStatements, statementSummary, policy } from "./helpers/private-identity-admission-fixture.mjs";

// Exact desired assertions run unchanged on current storage and prospective
// storage. Deterministic admission denial, not a route or concurrency claim.
const observations = [];
try {
  for (const domain of ["canvas", "copy"]) for (const mode of ["personal", "scoped"])
    for (const prior of ["absent", "retained", "erased"]) for (const call of ["store", "prepared"]) {
    await test("identity admission rejects atomically / " + [domain, mode, prior, call].join("/"), { timeout: 30000 }, async t => {
      const f = await storageFixture(t, mode), identity = await identityFor(domain, f.owner, "storage-denial-operation-0001");
      // An existing personal original can share the deterministic actor/op key
      // with a later scoped candidate. No Canvas endpoint or lookup is invoked.
      if (prior !== "absent") await savedWinner(f, identity, undefined, prior);
      await expiredCleanupWitness(f);
      const before = snapshot(f.state), custodyBefore = personalCustody(f.state, f.owner, identity.contentId), trace = traceStatements(f.state);
      let error;
      try {
        if (call === "store") await policy.storePrivateContent(f.state.env, f.owner, "authoring-preview", "Denied replacement",
          f.scope, { sql: "0", bindings: [] }, undefined, identity);
        else {
          const prepared = await policy.preparePrivateContent(f.state.env, f.owner, "authoring-preview", "Denied replacement",
            f.scope, undefined, { sql: "0", bindings: [] }, identity);
          await f.state.env.DB.batch(prepared.statements);
        }
      } catch (value) { error = value; }
      finally { trace.restore(); }
      const after = snapshot(f.state), statements = statementSummary(trace);
      const observation = { domain, mode, prior, call, error: error instanceof Error ? error.message : null,
        personalCustodyBefore: custodyBefore, personalCustodyAfter: personalCustody(f.state, f.owner, identity.contentId),
        storageUnchanged: JSON.stringify(after) === JSON.stringify(before), statements,
        maximumBindings: f.state.controls.maxBindings };
      observations.push(observation);
      assert.ok(error, "Denied identity admission must abort the batch, not finish with a zero-row insert");
      assert.match(error.message, call === "store" ? /project_private_content_access_revoked/u : /NOT NULL constraint failed: private_content\.content/u);
      assert.deepEqual(after, before, "Denied identity cannot change original bytes, custody, retention, receipts, or cleanup witnesses");
      assert.equal(observation.personalCustodyAfter, custodyBefore);
      assert.equal(statements.resourceStatements, 0, "No insertion-dependent custody SQL after denial");
      assert.equal(statements.retentionStatements, 0, "No insertion-dependent retention SQL after denial");
      assert.equal(statements.cleanupStatements, 0, "No insertion-dependent cleanup SQL after denial");
    });
  }
} finally { console.log("PRIVATE_IDENTITY_DENIED " + JSON.stringify({ observations })); }
