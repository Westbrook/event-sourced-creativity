import test from "node:test";
import assert from "node:assert/strict";
import { model3dRecoveryFixture as fixture, model3dRecoverySnapshot as snapshot, model3dRecoveryBudgets as budgets } from "./helpers/output-model3d-recovery-fixture.mjs";
const originalFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = () => { fetches++; throw Error("lease test forbids network"); };
test.after(() => { globalThis.fetch = originalFetch; assert.equal(fetches, 0); });

async function observed(promise, maximumMs = 1500) {
  let timer;
  try { return await Promise.race([promise.then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ status: "hung" }), maximumMs); })]); }
  finally { clearTimeout(timer); }
}

test("hung exact-token release returns finitely; late SQL cannot expire a different original recovery token", { timeout: 5000 }, async () => {
  const f = await fixture();
  try {
    const lease = await f.claim(), baseline = snapshot(f), financial = budgets(f), prepare = f.DB.prepare.bind(f.DB);
    let late;
    f.DB.prepare = sql => {
      const statement = prepare(sql), bind = statement.bind;
      statement.bind = function (...bindings) {
        const bound = bind.apply(this, bindings);
        if (sql.startsWith("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputModel3dRecovery.expiresAt',?)")) {
          const run = bound.run.bind(bound);
          bound.run = () => new Promise(resolve => { late = async () => { const result = await run(); resolve(result); return result; }; });
        }
        return bound;
      };
      return statement;
    };
    const started = performance.now(), result = await observed(lease.release());
    assert.equal(result.status, "fulfilled"); assert(performance.now() - started < 1500); assert(late);
    assert.deepEqual(snapshot(f), baseline, "held SQL has not mutated the old token or budgets");
    f.DB.prepare = prepare;
    // Synthetic clock/lease-expiry transition only. The second capability is
    // still claimed by the actual original-only API, not installed by hand.
    f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputModel3dRecovery.expiresAt','2020-01-01T00:00:00.000Z')");
    const newer = await f.claim(); assert.notEqual(newer.token, lease.token); const beforeLate = snapshot(f);
    const lateResult = await late(); assert.equal(lateResult.meta.changes, 0); assert.deepEqual(snapshot(f), beforeLate); assert.deepEqual(budgets(f), financial);
    await newer.assertCurrent(); await newer.release();
  } finally { f.close(); }
});

test("release still retires its exact token after caller abort and absorbs rejected D1 without changing money", async () => {
  const f = await fixture(), controller = new AbortController();
  try {
    const lease = await f.claim({ signal: controller.signal }), before = budgets(f); controller.abort();
    await lease.release(); assert(Date.parse(JSON.parse(f.readJob().result_json).outputModel3dRecovery.expiresAt) <= Date.now()); assert.deepEqual(budgets(f), before);
    const prepare = f.DB.prepare.bind(f.DB), state = snapshot(f);
    f.DB.prepare = () => { throw Error("synthetic D1 unavailable"); };
    assert.equal((await observed(lease.release())).status, "fulfilled"); f.DB.prepare = prepare; assert.deepEqual(snapshot(f), state);
  } finally { f.close(); }
});

test("caller abort retires a held preclaim read and no late read can continue to a claim", { timeout: 5000 }, async () => {
  const f = await fixture(), controller = new AbortController();
  try {
    const originalBatch = f.DB.batch.bind(f.DB), before = snapshot(f); let held, entered;
    const entry = new Promise(resolve => { entered = resolve; }); let batches = 0;
    f.DB.batch = statements => {
      batches++;
      if (statements.some(statement => statement.sql.startsWith("SELECT scope_key,grant_id"))) return new Promise((resolve, reject) => {
        held = async () => { try { const result = await originalBatch(statements); resolve(result); return result; } catch (error) { reject(error); throw error; } }; entered();
      });
      return originalBatch(statements);
    };
    const pending = f.claim({ signal: controller.signal }); await entry; controller.abort(Error("test canceled"));
    const result = await observed(pending); assert.equal(result.status, "rejected"); assert.match(String(result.reason), /test canceled/);
    await held(); await Promise.resolve(); assert.equal(batches, 1); assert.deepEqual(snapshot(f), before);
  } finally { f.close(); }
});

test("one original entry deadline bounds held preclaim reads even without a caller abort", { timeout: 5000 }, async () => {
  const f = await fixture();
  try {
    f.assertions[0].deadlineMs = Date.now() + 80; const before = snapshot(f), originalBatch = f.DB.batch.bind(f.DB); let late;
    f.DB.batch = statements => statements.some(statement => statement.sql.startsWith("SELECT scope_key,grant_id"))
      ? new Promise((resolve, reject) => { late = async () => { try { resolve(await originalBatch(statements)); } catch (error) { reject(error); throw error; } }; })
      : originalBatch(statements);
    const result = await observed(f.claim()); assert.equal(result.status, "rejected"); assert.match(String(result.reason), /deadline/); assert(late);
    await assert.rejects(late()); assert.deepEqual(snapshot(f), before);
  } finally { f.close(); }
});

test("a late claim batch is fenced by its original SQL deadline and cannot install a usable lease", { timeout: 5000 }, async () => {
  const f = await fixture();
  try {
    f.assertions[0].deadlineMs = Date.now() + 100; const before = snapshot(f), originalBatch = f.DB.batch.bind(f.DB); let late;
    f.DB.batch = statements => statements.some(statement => statement.sql.includes("outputModel3dRecoveryHistory[#]"))
      ? new Promise((resolve, reject) => { late = async () => { try { resolve(await originalBatch(statements)); } catch (error) { reject(error); throw error; } }; })
      : originalBatch(statements);
    const result = await observed(f.claim()); assert.equal(result.status, "rejected"); assert(late);
    await assert.rejects(late()); assert.deepEqual(snapshot(f), before);
  } finally { f.close(); }
});
