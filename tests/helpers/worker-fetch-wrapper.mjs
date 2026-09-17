import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function readWorkerFetchWrapper(indexFile = new URL("../../worker/index.ts", import.meta.url)) {
  const indexUrl = indexFile instanceof URL ? indexFile : pathToFileURL(resolve(indexFile));
  // Keep all real dependencies beside the selected index, including an explicit
  // proposal override. Missing sibling sources must not mix two checkouts.
  const indexText = await readFile(indexUrl, "utf8");
  const { isSelectedOutputShareApiPath } = await import(new URL("./selected-output-share-api.ts", indexUrl).href);
  // Read the immutable path without loading the unrelated native handler graph.
  // A changed declaration must be reviewed rather than silently guessed.
  const preflightText = await readFile(new URL("./output-schema-preflight.ts", indexUrl), "utf8");
  const pathDeclarations = [...preflightText.matchAll(/^export const OUTPUT_SCHEMA_PREFLIGHT_PATH = ("[^"\r\n]+");$/gmu)];
  assert.equal(pathDeclarations.length, 1, "The actual immutable preflight path must be located exactly once");
  const preflightPath = JSON.parse(pathDeclarations[0][1]);
  const signature = "async fetch(request: Request, env: WorkerEnv, context: WorkerExecutionContext): Promise<Response>";
  const exportStart = indexText.indexOf("export default {");
  const start = indexText.indexOf("  " + signature, exportStart);
  const end = indexText.indexOf("\n  async scheduled(", start);
  assert.ok(exportStart >= 0 && start >= exportStart && end > start, "The actual outer worker fetch wrapper must be located");
  const wrapperText = indexText.slice(start, end).trim().replace(/,\s*$/u, "")
    .replace(signature, "async function fetch(request, env, context)");

  function wrapper(status) {
    let retentionCalls = 0, routes = 0;
    // Only observe the surrounding dispatch effects. Retention decisions execute
    // the complete production wrapper and its real selected-share classifier.
    const fetch = new Function("routeRequest", "schedulePrivateContentRetention", "OUTPUT_SCHEMA_PREFLIGHT_PATH", "isSelectedOutputShareApiPath", `return (${wrapperText});`)(
      async () => { routes++; return Response.json({ status }, { status }); },
      () => { retentionCalls++; }, preflightPath, isSelectedOutputShareApiPath);
    return { fetch, counts: () => ({ retentionCalls, routes }) };
  }
  return { indexText, preflightPath, wrapper };
}
