import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Uses changed source directly, never dist. Artifact-only fallback is removed by normal repo resolution. */
export function registerOutputSourceImports() {
  const localRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const sourceRoot = process.env.FORMA_SOURCE_ROOT ?? localRoot;
  const contributionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  return registerHooks({ resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith(".") || !context.parentURL?.startsWith("file:")) return nextResolve(specifier, context);
    const parent = fileURLToPath(context.parentURL);
    if (parent.includes("/node_modules/")) return nextResolve(specifier, context);
    const normal = resolve(dirname(parent), /\.[a-z0-9]+$/iu.test(specifier) ? specifier : `${specifier}.ts`);
    // Proposal overlays must have one ledger/error identity, including imports
    // made by a separately proposed governance or execution dependency.
    const ownedWorkers = ["output-requirements-api.ts", "output-requirements-ledger.ts", "output-requirements-schema.ts", "output-requirements-read-model.ts", "output-asset-storage-control.ts", "output-asset-storage-identity.ts", "output-source-evidence-capacity.ts"];
    const owned = resolve(localRoot, "worker", basename(normal));
    const canonicalWitness = resolve(sourceRoot, "worker/output-governance-witness.ts");
    if (basename(normal) === "output-governance-witness.ts" && existsSync(canonicalWitness)) return nextResolve(pathToFileURL(canonicalWitness).href, context);
    if (normal.includes("/worker/") && ownedWorkers.includes(basename(normal)) && existsSync(owned)) return nextResolve(pathToFileURL(owned).href, context);
    if (existsSync(normal)) return nextResolve(pathToFileURL(normal).href, context);
    const candidates = [
      resolve(contributionRoot, "assets/tests", basename(normal)),
      resolve(contributionRoot, "domain/cycle-2/src/model", basename(normal)),
      resolve(contributionRoot, "domain/cycle-1/src/model", basename(normal)),
      resolve(contributionRoot, "assets/cycle-2/src/model", basename(normal)),
      resolve(contributionRoot, "assets/cycle-1/src/model", basename(normal)),
      ...(basename(normal) === "project-access.ts" ? [resolve(contributionRoot, "governance/cycle2/worker", basename(normal))] : []),
      resolve(contributionRoot, "governance/worker", basename(normal)),
      resolve(contributionRoot, "governance/cycle1-proposed/worker", basename(normal)),
      ...(basename(normal) === "output-schema-state.ts" ? [resolve(contributionRoot, "execution/worker", basename(normal))] : []),
      ...(basename(normal) === "output-governance-witness.ts" ? [resolve(contributionRoot, "execution/followups/governance-admission/worker", basename(normal))] : []),
      ...["domain", "assets"].map((part) => resolve(contributionRoot, part, "src/model", basename(normal))),
      ...(normal.includes("/src/") ? [resolve(sourceRoot, "src", normal.split("/src/").at(-1))] : normal.includes("/worker/") ? [resolve(sourceRoot, "worker", normal.split("/worker/").at(-1))] : []),
      resolve(sourceRoot, normal.includes("/worker/") ? "worker" : "src/model", basename(normal)),
    ];
    const found = candidates.find(existsSync);
    return nextResolve(found ? pathToFileURL(found).href : specifier, context);
  } });
}

export function outputTestDatabase(databasePath = ":memory:") {
  const sqlite = new DatabaseSync(databasePath);
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
    async put(key, value, options = {}) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value); media.set(key, { bytes: bytes.slice(), metadata: structuredClone(options.customMetadata ?? {}), contentType: options.httpMetadata?.contentType }); return { key, httpEtag: "test-etag" }; },
    async get(key) { const item = media.get(key); return item ? { body: new Blob([item.bytes]).stream(), size: item.bytes.length, customMetadata: structuredClone(item.metadata), httpEtag: "test-etag", writeHttpMetadata(headers) { headers.set("content-type", item.contentType ?? "application/octet-stream"); } } : null; },
    async head(key) { return this.get(key); },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) media.delete(key); },
    async list(options = {}) {
      const keys = [...media.keys()].filter((key) => !options.prefix || key.startsWith(options.prefix)).sort();
      const start = Number(options.cursor ?? 0), limit = Math.min(1000, Math.max(1, Number(options.limit ?? 1000))), selected = keys.slice(start, start + limit);
      return { objects: selected.map((key) => { const value = media.get(key); return { key, size: value.bytes.length, customMetadata: structuredClone(value.metadata), httpMetadata: { contentType: value.contentType } }; }), truncated: start + limit < keys.length, ...(start + limit < keys.length ? { cursor: String(start + limit) } : {}) };
    },
  };
  return { sqlite, DB, media, env: { DB, MEDIA, ASSETS: { fetch() { throw new Error("network_sentinel"); } } } };
}
