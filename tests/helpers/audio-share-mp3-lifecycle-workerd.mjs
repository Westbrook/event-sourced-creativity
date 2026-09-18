import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);
const requireRoot = createRequire(join(root, "package.json"));
const requireWrangler = createRequire(requireRoot.resolve("wrangler"));
const decoderSha256 = "f0e9e8848367320ccb757e4092f0d6809668cfe38f43139d47b447151d7dff6b";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const identifier = name => `"${name.replaceAll('"', '""')}"`;
// quote(TEXT) truncates at NUL, so it cannot witness exact retained content.
// Hex preserves all text/blob bytes; 26 significant digits distinguish REALs.
const exactCell = column => {
  const value = identifier(column);
  return `CASE typeof(${value}) WHEN 'text' THEN 'text:'||hex(CAST(${value} AS BLOB))
    WHEN 'blob' THEN 'blob:'||hex(${value}) WHEN 'real' THEN 'real:'||printf('%!.26g',${value})
    ELSE typeof(${value})||':'||quote(${value}) END`;
};
const origin = "https://synthetic.forma.invalid";
const compiled = new WeakMap();

async function finite(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("synthetic_mp3_runtime_timeout:" + label)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(join(directory, entry.name)) : join(directory, entry.name)))).flat();
}
async function sourcePins() {
  const { preProcessFile } = requireRoot("typescript"), pins = {}, pending = [
    "tests/audio-share-mp3-lifecycle-vite/entry.ts", "tests/audio-share-mp3-lifecycle-vite/vite.config.mjs",
    "tests/audio-share-mp3-lifecycle-vite/wrangler.json", "tests/audio-share-mp3-lifecycle-vite/index.html",
    "tests/audio-share-mp3-lifecycle-vite/client.js", "tests/helpers/audio-share-mp3-lifecycle-workerd.mjs",
    "tests/selected-output-share-stable-mp3-workerd.test.mjs",
    "tests/fixtures/audio-share-mp3/stereo-20.mp3", "package.json", "pnpm-lock.yaml",
  ];
  while (pending.length) {
    const requested = pending.pop(); if (Object.hasOwn(pins, requested)) continue;
    let path, content;
    const candidates = [requested, ...(requested.endsWith(".js") ? [requested.slice(0, -3) + ".ts"] : []),
      ...[".ts", ".mjs", ".js", ".json", "/index.ts", "/index.mjs", "/index.js"].map(suffix => requested + suffix)];
    for (const candidate of candidates) {
      try { content = await readFile(join(root, candidate)); path = candidate; break; }
      catch (error) { if (!["ENOENT", "EISDIR", "ENOTDIR"].includes(error.code)) throw error; }
    }
    assert.ok(path && content, "Resolvable local source import: " + requested);
    if (Object.hasOwn(pins, path)) continue;
    pins[path] = hash(content);
    if (!/\.(?:[cm]?js|tsx?)$/u.test(path)) continue;
    for (const imported of preProcessFile(content.toString("utf8"), true, true).importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const target = relative(root, resolve(dirname(join(root, path)), imported.fileName)).replaceAll("\\", "/");
      assert.ok(!target.startsWith("../") && !isAbsolute(target), "Source pins stay within the repository");
      pending.push(target);
    }
  }
  return Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b)));
}
async function assertSourcePins(pins) {
  const observed = Object.fromEntries(await Promise.all(Object.keys(pins).map(async path => [path, hash(await readFile(join(root, path)))])));
  assert.deepEqual(observed, pins, "Qualified local import graph and fixture source remain unchanged");
}
async function nativeState(db) {
  // workerd owns reserved _cf_ metadata that D1 forbids reading. It is not
  // part of the supplied canonical fixture or this application-state witness.
  const schema = (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all()).results
    .filter(row => !/^_cf_/iu.test(row.name) && !/^_cf_/iu.test(row.tbl_name));
  const tables = schema.filter(row => row.type === "table" && !/^sqlite_/iu.test(row.name) && row.name !== "selected_output_shares");
  const rows = {};
  for (const { name, sql } of tables) {
    const info = (await db.prepare(`PRAGMA table_info(${identifier(name)})`).all()).results;
    const columns = info.map(row => row.name), withoutRowid = /\bWITHOUT\s+ROWID\b/iu.test(sql ?? "");
    const primary = info.filter(row => row.pk > 0).sort((a, b) => a.pk - b.pk).map(row => identifier(row.name));
    const projection = columns.map((column, index) => `${exactCell(column)} AS c${index}`);
    if (!withoutRowid) projection.unshift("CAST(rowid AS TEXT) AS original_rowid");
    const order = withoutRowid ? (primary.length ? primary : columns.map(identifier)).join(",") : "rowid";
    rows[name] = (await db.prepare(`SELECT ${projection.join(",")} FROM ${identifier(name)} ORDER BY ${order}`).all()).results;
  }
  return { schema, rows };
}
async function mediaState(bucket) {
  const listing = await bucket.list({ include: ["httpMetadata", "customMetadata"] });
  assert.equal(listing.truncated, false, "Synthetic bucket must contain only the supplied source");
  const rows = [];
  for (const listed of listing.objects) {
    const object = await bucket.get(listed.key);
    assert.ok(object);
    const bytes = new Uint8Array(await object.arrayBuffer());
    rows.push({ key: object.key, version: object.version, size: object.size, etag: object.etag,
      uploaded: object.uploaded.toISOString(), httpMetadata: object.httpMetadata, customMetadata: object.customMetadata,
      sha256: hash(bytes) });
    bytes.fill(0);
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/** Build unchanged production modules using Cloudflare's normal static-WASM
 * rule. This fixture entry is not the application router or a release build. */
export async function buildSyntheticMp3LifecycleWorker(t) {
  const temporary = await mkdtemp(join(tmpdir(), "forma-mp3-lifecycle-vite-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const sources = await sourcePins();
  t.after(() => assertSourcePins(sources));
  const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "SYSTEMROOT"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(environment, { CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", FORMA_MP3_LIFECYCLE_BUILD_ROOT: temporary });
  const build = await execute(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--config",
    "tests/audio-share-mp3-lifecycle-vite/vite.config.mjs"], { cwd: root, env: environment, timeout: 60_000, maxBuffer: 2_000_000 });
  assert.match(build.stdout, /building server environment for production/u);
  assert.match(build.stdout, /building client environment for production/u);
  const output = join(temporary, "build"), server = join(output, "server"), client = join(output, "client");
  const serverFiles = await files(server), clientFiles = await files(client);
  const config = JSON.parse(await readFile(join(server, "wrangler.json"), "utf8"));
  assert.equal(config.main, "index.js"); assert.equal(config.no_bundle, true);
  assert.equal(config.compatibility_date, "2026-05-22"); assert.deepEqual(config.vars, {});
  for (const field of ["r2_buckets", "d1_databases", "services", "kv_namespaces", "send_email", "secrets_store_secrets"])
    assert.deepEqual(config[field], []);
  assert.deepEqual(config.durable_objects.bindings, []); assert.equal(config.assets.binding, undefined);
  const wasmFiles = serverFiles.filter(path => path.endsWith(".wasm"));
  assert.equal(wasmFiles.length, 1, "Exactly one static decoder must reach the production lifecycle graph");
  const wasm = await readFile(wasmFiles[0]);
  assert.equal(hash(wasm), decoderSha256);
  assert.deepEqual(wasm, await readFile(join(root, "worker/vendor/mpg123/decoder.wasm")));
  const modules = [];
  let staticImport = false, staticInstance = false;
  for (const path of serverFiles.filter(path => path.endsWith(".js"))) {
    const contents = await readFile(path, "utf8");
    staticImport ||= /import\s+\w+\s+from\s+["'][^"']+\.wasm["']/u.test(contents);
    staticInstance ||= /new WebAssembly\.Instance\(/u.test(contents);
    assert.doesNotMatch(contents, /WebAssembly\.(?:compile|compileStreaming|instantiate|instantiateStreaming)\s*\(/u);
    assert.doesNotMatch(contents, /fetch\s*\([^)]*\.wasm/u);
    modules.push({ type: "ESModule", path, contents });
  }
  assert.equal(staticImport, true); assert.equal(staticInstance, true);
  modules.sort((a, b) => Number(b.path === join(server, "index.js")) - Number(a.path === join(server, "index.js")));
  modules.push({ type: "CompiledWasm", path: wasmFiles[0], contents: wasm });
  for (const path of clientFiles) {
    assert.ok(!path.endsWith(".wasm"));
    assert.doesNotMatch(await readFile(path, "utf8"), /decoder|mpg123|WebAssembly|f0e9e8848367320c/u);
  }
  const artifacts = Object.fromEntries(await Promise.all([...serverFiles, ...clientFiles].map(async path =>
    [relative(output, path).replaceAll("\\", "/"), hash(await readFile(path))])));
  await assertSourcePins(sources);
  const result = Object.freeze({ outputDirectory: output, log: build.stdout + build.stderr,
    evidence: Object.freeze({ decoderSha256, staticWorkerModule: true, clientDecoderAbsent: true, sources, artifacts,
      applicationRouter: false, releaseBuild: false, productionSourceRewritten: false }) });
  if (process.env.FORMA_MP3_LIFECYCLE_EVIDENCE_DIR) {
    const destination = process.env.FORMA_MP3_LIFECYCLE_EVIDENCE_DIR;
    assert.ok(isAbsolute(destination), "Evidence destination must be explicit and absolute");
    // Reserve a fresh directory atomically; do not merge a partial rerun into
    // historical evidence even if its existing files have different names.
    await mkdir(destination);
    await cp(output, join(destination, "built-artifacts"), { recursive: true, errorOnExist: true, force: false });
    await writeFile(join(destination, "build.log"), result.log, { flag: "wx" });
    await writeFile(join(destination, "build-qualification.json"), JSON.stringify({ version: 1, status: "build-passed",
      runtimeQualification: "separate lifecycle test result required", ...result.evidence }, null, 2) + "\n", { flag: "wx" });
  }
  compiled.set(result, { server, modules, config });
  return result;
}

/** Real disposable D1/R2 bindings and unchanged compiled implementations. Seed
 * data and the single MP3 are supplied by a synthetic-only caller. No assets
 * binding, remote service, credential or production storage is available.
 * Final snapshots establish unchanged state, not absence of transient writes
 * or read counts. Instrumented supplier tests must establish those separately. */
export async function localCompiledMp3Lifecycle(t, { snapshot, source, bindings = {}, build }) {
  assert.deepEqual(Object.keys(snapshot).sort(), ["data", "schema"]);
  assert.ok(Array.isArray(snapshot.schema) && snapshot.schema.length <= 512);
  assert.ok(Array.isArray(snapshot.data) && snapshot.data.length <= 2048);
  // syntheticSnapshot emits only explicit application objects and canonical
  // INSERT targets. Never accept a caller-supplied reserved runtime object.
  for (const sql of snapshot.schema) {
    const name = /^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/iu.exec(sql);
    assert.ok(name && !/^(?:_cf_|sqlite_)/iu.test(name[1] ?? name[2]), "Only explicit application schema objects may be seeded");
  }
  for (const row of snapshot.data) {
    const name = /^INSERT INTO "([^"]+)"\(/u.exec(row.sql);
    assert.ok(name && !/^(?:_cf_|sqlite_)/iu.test(name[1]), "Only canonical application rows may be seeded");
  }
  assert.ok(source && typeof source.key === "string" && source.key.endsWith(".mp3"));
  assert.ok(source.bytes instanceof Uint8Array && source.bytes.byteLength > 0 && source.bytes.byteLength <= 1_000_000);
  assert.ok(Object.keys(bindings).every(key => ["FORMA_PILOT_COHORT_ID", "FORMA_ADMIN_EMAILS"].includes(key)));
  assert.ok(Object.values(bindings).every(value => typeof value === "string"));
  const artifact = build ?? await buildSyntheticMp3LifecycleWorker(t), built = compiled.get(artifact);
  assert.ok(built, "Only a helper-built compiled artifact may be used");
  const { Miniflare, Log, LogLevel } = requireWrangler("miniflare"), egress = [], requests = [];
  const mf = new Miniflare({ modulesRoot: built.server, modules: built.modules,
    compatibilityDate: built.config.compatibility_date, compatibilityFlags: built.config.compatibility_flags,
    host: "127.0.0.1", port: 0, log: new Log(LogLevel.NONE), d1Databases: ["DB"], r2Buckets: ["MEDIA"], bindings,
    outboundService(request) { egress.push({ method: request.method, url: request.url }); throw new Error("network_forbidden"); } });
  let nativeBefore, mediaBefore, DB, MEDIA;
  const assertUnchangedNative = async () => assert.deepEqual(await finite(nativeState(DB), 35_000, "native-audit"), nativeBefore,
    "All canonical tables and schema outside selected_output_shares remain unchanged");
  const assertUnchangedMedia = async () => assert.deepEqual(await finite(mediaState(MEDIA), 10_000, "media-audit"), mediaBefore,
    "No retained object, object version, metadata or bytes may change; no public derivative may persist");
  t.after(async () => {
    try { if (nativeBefore) await assertUnchangedNative(); if (mediaBefore) await assertUnchangedMedia(); assert.deepEqual(egress, []); }
    finally { await finite(mf.dispose(), 10_000, "dispose"); }
  });
  DB = await finite(mf.getD1Database("DB"), 10_000, "db");
  MEDIA = await finite(mf.getR2Bucket("MEDIA"), 10_000, "media");
  for (const sql of snapshot.schema) await finite(DB.prepare(sql).run(), 10_000, "schema");
  if (snapshot.data.length) await finite(DB.batch([DB.prepare("PRAGMA defer_foreign_keys=ON"),
    ...snapshot.data.map(row => DB.prepare(row.sql).bind(...row.bindings)), DB.prepare("PRAGMA defer_foreign_keys=OFF")]), 35_000, "seed");
  assert.deepEqual((await DB.prepare("PRAGMA foreign_key_check").all()).results, []);
  assert.equal((await MEDIA.list()).objects.length, 0);
  await finite(MEDIA.put(source.key, source.bytes, {
    httpMetadata: source.httpMetadata ?? { contentType: source.contentType },
    customMetadata: source.customMetadata ?? source.metadata,
  }), 10_000, "source-seed");
  nativeBefore = await finite(nativeState(DB), 35_000, "native-before");
  mediaBefore = await finite(mediaState(MEDIA), 10_000, "media-before");
  assert.equal(mediaBefore.length, 1); assert.equal(mediaBefore[0].sha256, hash(source.bytes));
  return {
    build: artifact, DB, MEDIA, egress, requests, origin, assertUnchangedNative, assertUnchangedMedia,
    // No principal or same-origin header is supplied implicitly. Tests record
    // positive and negative browser-origin policy inputs exactly as dispatched.
    async dispatch(path, init = {}) {
      assert.ok(typeof path === "string" && path.startsWith("/") && !path.startsWith("//"));
      const url = new URL(path, origin); assert.equal(url.origin, origin);
      const headers = new Headers(init.headers);
      requests.push({ path: url.pathname + url.search, method: init.method ?? "GET",
        secFetchSite: headers.get("sec-fetch-site"), origin: headers.get("origin"),
        authenticated: headers.has("oai-authenticated-user-id") && headers.has("oai-authenticated-user-email") });
      return finite(mf.dispatchFetch(url, init), 40_000, "dispatch:" + url.pathname);
    },
  };
}
