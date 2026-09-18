import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
export { canonicalState, financialState, disclosureDbClock, pauseClaim } from "./authoring-disclosure-boundary.mjs";

// Load the complete existing native Worker/SQLite fixture, not a replacement API or receipt.
const file = new URL("../canvas-arrangements.test.mjs", import.meta.url), source = fs.readFileSync(file, "utf8");
assert.equal(createHash("sha256").update(source).digest("hex"), "a8cc75fc3b6962e40a02f238f4ab1a6e955a608423ef42b7f54594c4239a691e");
const marker = 'test("Canvas arrangement previews for free and applies only one complete geometric operation in every authoring scope"';
const at = source.indexOf(marker);
assert.ok(at > 0); assert.equal(source.indexOf(marker, at + 1), -1);
const virtual = new URL("../canvas-expired-disposition-native-fixture.mjs", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) { return specifier === virtual.href ? { url: virtual.href, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === virtual.href ? { format: "module", shortCircuit: true,
    source: source.slice(0, at) + "\nexport { fixture, intent, preview, apply, countEvents, assertFree, append, projections };\n" } : next(url, context); },
});
export const { fixture, intent, preview, apply, countEvents, assertFree, append, projections } = await import(virtual.href).finally(() => hook.deregister());
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export const changes = state => Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n);
export const retained = (state, previewId) => state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(previewId);
export const identity = input => ({ operationId: input.operationId, projectId: input.projectId, canvasId: input.canvasId });
export const retrieve = (state, input, extra = { includeDisposition: true }) => state.call({ action: "retrieve", ...identity(input), ...extra });
export const dismiss = (state, input, saved, extra = {}) => state.call({ action: "dismiss", ...identity(input),
  previewId: saved.previewId, approvalHash: saved.approvalHash, onlyIfUnapplied: true, ...extra });
export const actor = state => state.headers["oai-authenticated-user-id"] ?? state.ownerId;
export const guardedDiscardSql = sql => sql.startsWith("UPDATE private_content SET content=json_set(content,'$.state','dismissed')");

/** One actual SQL request boundary. The operation itself always executes on native SQLite. */
export function atSql(state, prefix, callback, { method = "first", after = false } = {}) {
  const prepare = state.env.DB.prepare.bind(state.env.DB); let hits = 0;
  state.env.DB.prepare = sql => {
    const statement = prepare(sql); if (!sql.startsWith(prefix)) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = bind(...values), execute = bound[method].bind(bound);
      bound[method] = async (...args) => {
        if (hits) return execute(...args);
        hits++;
        const result = after ? await execute(...args) : undefined;
        await callback({ sql, values, result });
        return after ? result : execute(...args);
      };
      return bound;
    };
    return statement;
  };
  return { hits: () => hits, restore() { state.env.DB.prepare = prepare; } };
}
export function pauseSql(state, prefix, options) {
  const entered = deferred(), proceed = deferred();
  const port = atSql(state, prefix, async () => { entered.resolve(); await proceed.promise; }, options);
  return { ...port, entered: entered.promise, release: proceed.resolve };
}

/** The gate is before BEGIN. Never models a second writer inside SQLite's transaction. */
export function atGuardedBatch(state, callback) {
  const batch = state.env.DB.batch.bind(state.env.DB); let hits = 0;
  state.env.DB.batch = async statements => {
    if (!hits && statements.length === 2 && guardedDiscardSql(statements[0].sql)
      && statements[1].sql.startsWith("SELECT receipt.result_json,receipt.approval_hash,")) {
      hits++; await callback(statements);
    }
    return batch(statements);
  };
  return { hits: () => hits, restore() { state.env.DB.batch = batch; } };
}
export function pauseGuardedBatch(state) {
  const entered = deferred(), proceed = deferred();
  const port = atGuardedBatch(state, async () => { entered.resolve(); await proceed.promise; });
  return { ...port, entered: entered.promise, release: proceed.resolve };
}

/** Passive statement tracing includes traffic housekeeping; it neither skips nor fabricates SQL. */
export function changedSql(state) {
  const prepare = state.env.DB.prepare.bind(state.env.DB), trace = [];
  state.env.DB.prepare = sql => {
    const statement = prepare(sql), bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = bind(...values), execute = bound.execute.bind(bound);
      bound.execute = kind => {
        const before = changes(state), result = execute(kind), delta = changes(state) - before;
        if (delta) trace.push({ sql, kind, delta });
        return result;
      };
      return bound;
    };
    return statement;
  };
  return { trace, restore() { state.env.DB.prepare = prepare; } };
}
