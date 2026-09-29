import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function registerScalingSourceImports() {
  const here = dirname(fileURLToPath(import.meta.url));
  const artifact = resolve(here, ".."), contributions = resolve(artifact, "..");
  const source = process.env.FORMA_SOURCE_ROOT ?? resolve(artifact, "../.."), overlay = process.env.FORMA_SCALING_OVERLAY === "1";
  return registerHooks({ resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith(".") || !context.parentURL?.startsWith("file:")) return nextResolve(specifier, context);
    const parent = fileURLToPath(context.parentURL);
    if (parent.includes("/node_modules/")) return nextResolve(specifier, context);
    const normal = resolve(dirname(parent), /\.[a-z0-9]+$/iu.test(specifier) ? specifier : `${specifier}.ts`);
    if (existsSync(normal)) return nextResolve(pathToFileURL(normal).href, context);
    const worker = normal.includes("/worker/"), name = basename(normal);
    const sourceRelative = normal.includes("/src/") ? normal.slice(normal.lastIndexOf("/src/") + 1) : worker ? `worker/${name}` : `tests/${name}`;
    const candidates = [
      ...(overlay && worker ? [resolve(artifact, "worker", name), resolve(contributions, "server/worker", name)] : []),
      ...(overlay && !worker ? [resolve(contributions, "assets/cycle-2/src/model", name), resolve(contributions, "server/src/model", name)] : []),
      resolve(source, sourceRelative),
      ...(overlay && worker ? [resolve(contributions, "execution/worker", name)] : []),
    ];
    const found = candidates.find(existsSync);
    return nextResolve(found ? pathToFileURL(found).href : specifier, context);
  } });
}

export function measureOutputBindings(state, options = {}) {
  const counters = { db: 0, r2List: 0, r2Head: 0, r2Get: 0, total: 0, reset() { this.db = this.r2List = this.r2Head = this.r2Get = this.total = 0; this.trace.length = 0; } };
  Object.defineProperty(counters, "trace", { value: [], enumerable: false });
  const trace = (kind, statements) => { if (options.trace) counters.trace.push({ kind, statements: statements.map((statement) => String(statement.sql ?? "").trim().replace(/\s+/gu, " ")) }); };
  const db = state.env.DB;
  const statement = (original) => ({
    bind(...values) { return statement(original.bind(...values)); },
    async first(...args) { counters.db++; counters.total++; trace("first", [original]); return original.first(...args); },
    async all(...args) { counters.db++; counters.total++; trace("all", [original]); return original.all(...args); },
    async run(...args) { counters.db++; counters.total++; trace("run", [original]); return original.run(...args); },
    original,
  });
  state.env.DB = { prepare(sql) { return statement(db.prepare(sql)); }, async batch(statements) { counters.db++; counters.total++; const prepared = statements.map((value) => value.original ?? value); trace("batch", prepared); return db.batch(prepared); } };
  const media = state.env.MEDIA;
  state.env.MEDIA = {
    ...media,
    async get(...args) { counters.r2Get++; counters.total++; return media.get(...args); },
    async head(...args) { counters.r2Head++; counters.total++; return media.head(...args); },
    async list(input = {}) {
      counters.r2List++; counters.total++;
      assert.deepEqual(input.include, ["customMetadata", "httpMetadata"]);
      assert.equal(input.limit, 1_000);
      const pageSize = options.pageSize ?? 250, offset = Number(input.cursor ?? 0);
      const keys = [...state.media.keys()].filter((key) => key.startsWith(input.prefix ?? "")).sort();
      const selected = keys.slice(offset, offset + Math.min(pageSize, input.limit));
      return { objects: selected.map((key) => {
        const row = state.media.get(key);
        return { key, size: row.bytes.length, customMetadata: structuredClone(row.metadata), httpMetadata: { contentType: row.contentType } };
      }), truncated: offset + selected.length < keys.length, ...(offset + selected.length < keys.length ? { cursor: String(offset + selected.length) } : {}) };
    },
  };
  return counters;
}
