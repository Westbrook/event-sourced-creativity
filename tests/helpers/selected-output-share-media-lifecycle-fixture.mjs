import assert from "node:assert/strict";
import { selectedOutputShareMediaFixture, OWNER, EMAIL } from "./selected-output-share-media-fixture.mjs";
import { SELECTED_OUTPUT_SHARE_SCHEMA } from "../../worker/selected-output-share-schema.ts";
import { SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY } from "../../src/model/selected-output-share.ts";
export * from "./selected-output-share-media-fixture.mjs";
export { CONTENT, digest, retainAuthoredMedia, retainOriginalMediaRestore } from "./native-media-custody-fixture.mjs";
export const PURPOSE = "selected-output-read-v1";

export function forbidSelectedOutputShareNetwork(t) {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", () => { attempts++; throw new Error("No synthetic sharing network/provider call"); });
  t.after(() => assert.equal(attempts, 0, "Caught network/provider attempts still fail"));
}

// Find the statement outside CTE bodies and quoted literals. Only the exact
// dedicated share writes below may bypass the native fixture's SELECT guard.
function operation(sql) {
  let depth = 0, quote = null;
  for (let at = 0; at < sql.length;) {
    const char = sql[at];
    if (quote) { if (char === quote) { if (sql[at + 1] === quote) at++; else quote = null; } at++; continue; }
    if (char === "'" || char === '"') { quote = char; at++; continue; }
    if (char === "(") { depth++; at++; continue; }
    if (char === ")") { depth--; at++; continue; }
    if (depth === 0 && /[A-Za-z_]/u.test(char)) {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(sql.slice(at))[0];
      if (["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "PRAGMA", "REPLACE"].includes(word.toUpperCase())) return { word: word.toUpperCase(), tail: sql.slice(at) };
      at += word.length; continue;
    }
    at++;
  }
  throw new Error("Unexpected sharing test statement");
}
export const finalShareRead = sql => sql.startsWith("WITH selected_share_proof_") && sql.includes(" SELECT 1 AS permitted WHERE") && sql.includes("selected_output_shares");
export const shareTokenWrite = sql => sql.startsWith("WITH selected_share_proof_") && sql.includes(" UPDATE selected_output_shares SET token_hash=");
export const sharePreparationWrite = sql => sql.startsWith("WITH selected_share_proof_") && sql.includes(" INSERT INTO selected_output_shares(");

/** Actual native custody, actor-paid provenance and reviewed DDL in synthetic
 * SQLite only. Original native SELECT guard remains active. Dedicated share
 * writes alone use the actual base DB; no reader or authority is substituted. */
export async function selectedOutputShareMediaLifecycleFixture(t, output = "audio", options = {}) {
  forbidSelectedOutputShareNetwork(t);
  const f = await selectedOutputShareMediaFixture(t, output, options);
  if (options.installShareSchema !== false) for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) f.sqlite.exec(sql);
  const nativeDB = f.env.DB, statements = [], writes = [], forbidden = [];
  let beforeStatement = null, afterStatement = null;
  const reject = message => { forbidden.push(message); throw new Error(message); };
  f.env.DB = { prepare(sql) {
    assert.ok(Buffer.byteLength(sql) <= 100_000, "D1 SQL byte limit");
    const parsed = operation(sql), writer = parsed.word !== "SELECT";
    if (writer && !/^INSERT INTO selected_output_shares\(/u.test(parsed.tail)
      && !/^UPDATE selected_output_shares SET (?:token_hash|revoked_at)=/u.test(parsed.tail)) return reject("Unexpected non-sharing write: " + parsed.word);
    const prepared = (writer ? f.baseEnv.DB : nativeDB).prepare(sql);
    const statement = bindings => ({ sql, bind(...values) { assert.ok(values.length <= 100, "D1 binding limit"); return statement(values); },
      async invoke(mode) {
        if (writer !== (mode === "run")) return reject("Unexpected sharing statement execution mode");
        const observed = { sql, bindings: [...bindings], mode }; statements.push(observed); if (writer) writes.push(observed);
        if (beforeStatement) await beforeStatement(sql, bindings, mode);
        const result = await prepared.bind(...bindings)[mode]();
        if (afterStatement) await afterStatement(sql, bindings, mode, result);
        return result;
      }, async first() { return this.invoke("first"); }, async all() { return this.invoke("all"); }, async run() { return this.invoke("run"); } });
    return statement([]);
  }, batch() { return reject("Sharing lifecycle may not batch or write unrelated state"); } };
  const selection = (revision = f.currentRevision, overrides = {}) => ({ ...f.select(revision, { mediaSha256: options.currentHash ?? digestBytes(f.currentBytes), ...overrides }),
    projectionPolicy: SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY });
  const request = (body, headers = {}, method = "POST", signal) => new Request("https://forma.test/detached-selected-output-share", {
    method, headers: { "content-type": "application/json", "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
    ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  t.after(() => assert.deepEqual(forbidden, [], "Caught forbidden sharing fixture operations still fail"));
  return Object.assign(f, { selection, request,
    review: (patch = {}) => ({ title: "Reviewed media output", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), ...patch }),
    statements, writes, lifecycleForbidden: forbidden,
    shares: () => f.sqlite.prepare("SELECT * FROM selected_output_shares ORDER BY share_id").all(),
    setBeforeStatement(value) { beforeStatement = value; }, setAfterStatement(value) { afterStatement = value; } });
}
import { createHash } from "node:crypto";
const digestBytes = value => createHash("sha256").update(value).digest("hex");
