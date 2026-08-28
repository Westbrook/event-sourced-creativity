import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Uses changed source directly, never dist. Artifact-only fallback is removed by normal repo resolution. */
export function registerOutputSourceImports() {
  const sourceRoot = process.env.FORMA_SOURCE_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const contributionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  return registerHooks({ resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith(".") || !context.parentURL?.startsWith("file:")) return nextResolve(specifier, context);
    const parent = fileURLToPath(context.parentURL);
    if (parent.includes("/node_modules/")) return nextResolve(specifier, context);
    const normal = resolve(dirname(parent), /\.[a-z0-9]+$/iu.test(specifier) ? specifier : `${specifier}.ts`);
    if (existsSync(normal)) return nextResolve(pathToFileURL(normal).href, context);
    const candidates = [
      resolve(contributionRoot, "assets/tests", basename(normal)),
      ...["domain", "assets"].map((part) => resolve(contributionRoot, part, "src/model", basename(normal))),
      resolve(sourceRoot, normal.includes("/worker/") ? "worker" : "src/model", basename(normal)),
    ];
    const found = candidates.find(existsSync);
    return nextResolve(found ? pathToFileURL(found).href : specifier, context);
  } });
}

export function outputTestDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  class Statement {
    constructor(sql, bindings = []) { this.sql = sql; this.bindings = bindings; }
    bind(...bindings) { return new Statement(this.sql, bindings); }
    execute(kind) {
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.bindings) ?? null;
      if (kind === "all") return { results: statement.all(...this.bindings), success: true, meta: { changes: 0 } };
      const result = statement.run(...this.bindings);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }
  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/iu.test(statement.sql) ? "all" : "run"));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const media = new Map();
  const MEDIA = {
    async put(key, value, options = {}) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value); media.set(key, { bytes: bytes.slice(), metadata: structuredClone(options.customMetadata ?? {}), contentType: options.httpMetadata?.contentType }); return {key,httpEtag:"test-etag"}; },
    async get(key) { const item = media.get(key); return item ? { body: new Blob([item.bytes]).stream(), size: item.bytes.length, customMetadata: structuredClone(item.metadata), httpEtag: "test-etag", writeHttpMetadata(headers) { headers.set("content-type", item.contentType ?? "application/octet-stream"); } } : null; },
    async head(key) { return this.get(key); },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) media.delete(key); },
    async list(options={}) {
      const keys=[...media.keys()].filter(key=>!options.prefix||key.startsWith(options.prefix)).sort();
      const start=Number(options.cursor??0),limit=Math.min(1000,Math.max(1,Number(options.limit??1000))),selected=keys.slice(start,start+limit);
      return {objects:selected.map(key=>{const value=media.get(key);return{key,size:value.bytes.length,customMetadata:structuredClone(value.metadata),httpMetadata:{contentType:value.contentType}};}),truncated:start+limit<keys.length,...(start+limit<keys.length?{cursor:String(start+limit)}:{})};
    },
  };
  return { sqlite, DB, media, env: { DB, MEDIA, ASSETS: { fetch() { throw new Error("network_sentinel"); } } } };
}
