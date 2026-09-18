import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture as nativeFixture, OWNER, EMAIL, ARTIFACT, MODEL, digest } from "./native-stable-audio-proof-fixture.mjs";
import { SELECTED_OUTPUT_SHARE_SCHEMA } from "../../worker/selected-output-share-schema.ts";
import { SELECTED_OUTPUT_SHARE_AUDIO_POLICY } from "../../src/model/selected-output-share-audio.ts";
import { syntheticSnapshot } from "./selected-output-share-d1-qualification.mjs";

export * from "./native-stable-audio-proof-fixture.mjs";
export const PURPOSE = "selected-output-read-v1";
export const STEREO_MP3_SHA256 = "3cfa31bd59c5f8eb92b525b5f718d6e379824f8407b45ed5e793afe2fcf6ab8d";
export const STEREO_WAV_SHA256 = "eae13159a5b9273dee41f064db6cd44bb6e93ecf8138ebf424fbca2deb08b1a7";

// This parses only the terminal operation of observed production statements.
// It does not rewrite SQL, return canned rows, or replace a production reader.
function operation(sql) {
  let depth = 0, quote = null;
  for (let at = 0; at < sql.length;) {
    const char = sql[at];
    if (quote) {
      if (char === quote) { if (sql[at + 1] === quote) at++; else quote = null; }
      at++; continue;
    }
    if (sql.startsWith("--", at)) { const end = sql.indexOf("\n", at + 2); at = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith("/*", at)) { const end = sql.indexOf("*/", at + 2); assert.ok(end >= 0); at = end + 2; continue; }
    if (char === "'" || char === '"' || char === "`") { quote = char; at++; continue; }
    if (char === "[") { const end = sql.indexOf("]", at + 1); assert.ok(end >= 0); at = end + 1; continue; }
    if (char === "(") { depth++; at++; continue; }
    if (char === ")") { depth--; assert.ok(depth >= 0); at++; continue; }
    if (depth === 0 && /[A-Za-z_]/u.test(char)) {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(sql.slice(at))[0];
      if (["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "PRAGMA", "REPLACE"].includes(word.toUpperCase()))
        return { word: word.toUpperCase(), tail: sql.slice(at) };
      at += word.length; continue;
    }
    at++;
  }
  throw new Error("Unexpected synthetic sharing statement");
}

/** One canonical native donor and one local synthetic MP3. The proof fixture's
 * defaults remain media-free. This wrapper owns a separate private byte store;
 * every observed native SELECT still runs the unchanged SQLite/read-only guard.
 * Only dedicated selected_output_shares writes use the genuine base DB. */
export async function selectedOutputShareStableMp3Fixture(t, { repair = false, installShareSchema = true, trapNetwork = true } = {}) {
  let networkAttempts = 0;
  if (trapNetwork) t.mock.method(globalThis, "fetch", () => {
    networkAttempts++; throw new Error("No synthetic MP3 sharing network/provider requests");
  });
  const sourceBytes = new Uint8Array(await readFile(new URL("../fixtures/audio-share-mp3/stereo-20.mp3", import.meta.url)));
  const sourceSha256 = digest(sourceBytes);
  assert.equal(sourceSha256, STEREO_MP3_SHA256, "The checked-in stereo20 donor is immutable");
  const f = await nativeFixture(t, { repair, mediaSha256: sourceSha256 });
  if (installShareSchema) for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) f.sqlite.exec(sql);
  const nativeDB = f.env.DB, statements = [], writes = [], mediaReads = [], violations = [];
  let beforeStatement = null, afterStatement = null, beforeMediaGet = null, afterMediaObject = null, operationName = "unset";
  const reject = message => { violations.push(message); throw new Error(message); };
  const DB = { prepare(sql) {
    assert.ok(Buffer.byteLength(sql) <= 100_000, "D1 SQL byte limit");
    const parsed = operation(sql), writer = parsed.word !== "SELECT";
    if (writer && !/^INSERT INTO selected_output_shares\(/u.test(parsed.tail)
      && !/^UPDATE selected_output_shares SET (?:token_hash|revoked_at)=/u.test(parsed.tail))
      return reject("Unexpected non-sharing write: " + parsed.word);
    const prepared = (writer ? f.baseEnv.DB : nativeDB).prepare(sql);
    const statement = bindings => ({ sql, bindings,
      bind(...values) { assert.ok(values.length <= 100, "D1 binding limit"); return statement(values); },
      async invoke(mode) {
        if (writer !== (mode === "run")) return reject("Unexpected sharing statement execution mode");
        const observed = { operation: operationName, sql, bindings: [...bindings], mode };
        statements.push(observed); if (writer) writes.push(observed);
        if (beforeStatement) await beforeStatement(sql, bindings, mode);
        const result = await prepared.bind(...bindings)[mode]();
        if (afterStatement) await afterStatement(sql, bindings, mode, result);
        return result;
      },
      async first() { return this.invoke("first"); }, async all() { return this.invoke("all"); }, async run() { return this.invoke("run"); },
    });
    return statement([]);
  }, batch() { return reject("Sharing lifecycle may not batch or mutate unrelated state"); } };
  const media = new Map([[f.key, { bytes: sourceBytes.slice(), contentType: "audio/mpeg", metadata: {
    ownerId: OWNER, artifactId: ARTIFACT, source: "provider-generated-media", model: MODEL,
    sha256: sourceSha256, mimeType: "audio/mpeg",
  } }]]);
  const MEDIA = { async get(key) {
    mediaReads.push(key);
    if (key !== f.key) return reject("Synthetic MP3 sharing may read only its current source key");
    if (beforeMediaGet) await beforeMediaGet(key);
    const item = media.get(key); if (!item) return null;
    const metadata = structuredClone(item.metadata), contentType = item.contentType;
    const object = { body: new Blob([item.bytes.slice()]).stream(), size: item.bytes.byteLength,
      customMetadata: metadata, httpEtag: "synthetic-stereo20-etag",
      writeHttpMetadata(headers) { headers.set("content-type", contentType); },
    };
    return afterMediaObject ? await afterMediaObject(object, key) : object;
  }, head() { return reject("Synthetic MP3 sharing may not head media"); },
  put() { return reject("Synthetic MP3 sharing may not persist a derivative"); },
  delete() { return reject("Synthetic MP3 sharing may not delete media"); },
  list() { return reject("Synthetic MP3 sharing may not enumerate media"); } };
  const env = { ...f.env, DB, MEDIA, ASSETS: { fetch() { return reject("Synthetic MP3 sharing may not fetch assets"); } } };
  const selection = (revision = 0, overrides = {}) => ({ ...f.select(revision), policy: SELECTED_OUTPUT_SHARE_AUDIO_POLICY, ...overrides });
  const request = (body, headers = {}, method = "POST", signal, path = "/detached-selected-output-share") =>
    new Request(`https://forma.test${path}`, { method,
      headers: { "content-type": "application/json", "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
      ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  const snapshot = () => syntheticSnapshot(f.sqlite);
  const nativeSnapshot = () => JSON.stringify(snapshot().data.filter(row => !row.sql.startsWith('INSERT INTO "selected_output_shares"')));
  t.after(() => { assert.deepEqual(violations, [], "Caught forbidden synthetic sharing operations still fail"); assert.equal(networkAttempts, 0); });
  return { ...f, env, DB, nativeSelection: f.selection, selection, request,
    review: (patch = {}) => ({ title: "Reviewed instrumental audio", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), ...patch }),
    shares: () => f.sqlite.prepare("SELECT * FROM selected_output_shares ORDER BY share_id").all(),
    sourceBytes: sourceBytes.slice(), sourceSha256, expectedPublicSha256: STEREO_WAV_SHA256,
    currentBytes: sourceBytes.slice(), originalBytes: sourceBytes.slice(), originalUrl: f.url, originalKey: f.key,
    media, mediaReads, lifecycleForbidden: violations, statements, writes, snapshot, nativeSnapshot,
    setBeforeStatement(value) { beforeStatement = value; }, setAfterStatement(value) { afterStatement = value; },
    setBeforeMediaGet(value) { beforeMediaGet = value; }, setAfterMediaObject(value) { afterMediaObject = value; },
    operation(value) { operationName = value; },
    mediaSeed: () => ({ key: f.key, bytes: sourceBytes.slice(), metadata: structuredClone(media.get(f.key).metadata), contentType: "audio/mpeg" }),
  };
}
