import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

// Reuse the real native Worker fixture without registering its existing tests
// a second time. Every provider response and storage object is in-memory.
const originalUrl = new URL("./output-native-execution.test.mjs", import.meta.url);
const fixtureUrl = new URL("./output-native-retention-boundaries.fixture.mjs", import.meta.url).href;
const originalSource = readFileSync(originalUrl, "utf8");
assert.equal(originalSource.split("import test from 'node:test';").length, 2);
const fixtureSource = originalSource.replace("import test from 'node:test';", "const test = () => undefined;")
  + "\nexport { fixture, saveDeck, authorize, outputFor };\n";
const hook = registerHooks({
  resolve(specifier, context, next) { return specifier === fixtureUrl ? { url: fixtureUrl, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === fixtureUrl ? { format: "module", source: fixtureSource, shortCircuit: true } : next(url, context); },
});
const { fixture, saveDeck, authorize, outputFor } = await import(fixtureUrl);
hook.deregister();

const count = (state, table) => state.sqlite.prepare("SELECT COUNT(*) AS count FROM " + table).get().count;
const financialRows = state => ["budget_reservations", "cost_budget_reservations", "budget_counters", "cost_budget_counters",
  "project_budget_reservation_scopes", "output_provider_calls", "output_operation_slots", "output_execution_grants"]
  .map(table => ({ table, rows: state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all() }));

async function completedDeck(t, shared) {
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(request.method, "POST");
    providerCalls += 1;
    return Response.json({ id: "retained-original", model: "gpt-5.6-terra", output_text: JSON.stringify(outputFor()),
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  });
  const state = await fixture(undefined, { shared });
  t.after(() => state.sqlite.close());
  const plan = await saveDeck(state), grant = await authorize(state, plan.planId, [plan.targetId]);
  await state.ok(await state.startAndDrive({ action: "run", grantId: grant.grantId }));
  const job = state.sqlite.prepare("SELECT * FROM document_jobs").get();
  assert.equal(job.status, "completed");
  assert.equal(providerCalls, 1);
  const content = state.sqlite.prepare("SELECT * FROM private_content WHERE kind='document-artifact' ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(content);
  return { ...state, plan, job, content, providerCalls: () => providerCalls };
}

async function withdrawOrigin(state, mutation) {
  const contentId = state.content.content_id;
  if (mutation === "expiry") {
    // Real SQLite time advances; no Date or database clock is overridden.
    // The origin is current at the boundary, then expires during its await.
    const expiry = new Date(Date.now() + 80).toISOString();
    state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(expiry, contentId);
    assert.equal(state.sqlite.prepare("SELECT expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AS current FROM private_content WHERE content_id=?").get(contentId).current, 1);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expiry) - Date.now() + 30)));
    assert.equal(state.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS expired FROM private_content WHERE content_id=?").get(contentId).expired, 1);
  } else if (mutation === "redaction") {
    state.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), contentId);
  } else if (mutation === "bytes") {
    state.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(contentId);
  } else if (mutation === "owner") {
    state.sqlite.prepare("UPDATE private_content SET owner_id='another-retention-owner' WHERE content_id=?").run(contentId);
  } else if (mutation === "custody") {
    if (state.projectAccessId) {
      const changed = state.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE project_access_id=? AND resource_kind='content' AND resource_id=?")
        .run(state.projectAccessId, contentId);
      assert.equal(changed.changes, 1);
    } else {
      state.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'content',?,?,?,?, 'actor_private',NULL,?,?)")
        .run("retention-other-access", contentId, "retention-other-organization", "project-atmosphere", state.content.owner_id, state.content.owner_id, new Date().toISOString());
    }
  } else assert.fail("Unknown mutation " + mutation);
}

for (const shared of [false, true]) {
  for (const boundary of ["storage", "commit"]) {
    for (const mutation of ["current", "expiry", "redaction", "bytes", "owner", "custody"]) {
      test("native Slides retain exact live origin at " + boundary + ": " + mutation + " / " + (shared ? "shared" : "personal"), async t => {
        const state = await completedDeck(t, shared);
        const beforeFinance = financialRows(state), beforeJob = state.job;
        const depth = enforceD1ExpressionDepth(state);
        let crossed = false, puts = 0;
        const originalPut = state.env.MEDIA.put.bind(state.env.MEDIA), originalBatch = state.env.DB.batch.bind(state.env.DB);
        const cross = async () => { crossed = true; if (mutation !== "current") await withdrawOrigin(state, mutation); };
        state.env.MEDIA.put = async (...args) => {
          puts += 1;
          const result = await originalPut(...args);
          if (boundary === "storage") await cross();
          return result;
        };
        state.env.DB.batch = async statements => {
          if (boundary === "commit" && !crossed && statements.some(statement => /^INSERT INTO output_results\(/u.test(statement.sql))) await cross();
          return originalBatch(statements);
        };
        try {
          const response = await state.send({ action: "bind", planRevisionId: state.plan.planId, targetId: state.plan.targetId, nativeJobId: state.job.job_id });
          const body = await response.json();
          assert.equal(crossed, true, "the actual intended asynchronous boundary was reached");
          assert.equal(puts, 1);
          if (mutation === "current") {
            assert.equal(response.status, 200, JSON.stringify(body));
            assert.equal(count(state, "output_assets"), 1);
            assert.equal(count(state, "output_results"), 1);
            assert.equal(body.snapshot.results[0].checksStatus, "passed");
            assert.equal(body.snapshot.results[0].review, "pending", "matching is not human acceptance");
          } else {
            assert.ok(response.status >= 400, "withdrawn origin must not publish a new copy: " + JSON.stringify(body));
            assert.equal(count(state, "output_assets"), 0);
            assert.equal(count(state, "output_results"), 0);
            assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type IN ('OutputAssetAdopted','OutputResultBound')").get().count, 0);
            const write = state.sqlite.prepare("SELECT status,write_acknowledged,publication_event_id,storage_key FROM output_asset_storage_writes").get();
            assert.equal(write.write_acknowledged, 1, "only the known acknowledged temporary write is cleaned up");
            assert.equal(write.publication_event_id, null);
            assert.equal(write.status, "deleted");
            assert.equal(state.media.has(write.storage_key), false, "no adopted temporary bytes remain published");
          }
          assert.equal(count(state, "output_target_acceptances"), 0);
          assert.equal(state.providerCalls(), 1, "binding never contacts a provider again");
          assert.deepEqual(financialRows(state), beforeFinance);
          assert.deepEqual(state.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(state.job.job_id), beforeJob);
          depth.assertVerified();
        } finally { depth.restore(); }
      });
    }
  }
}
