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
  const supportsSponsorResponseIdentity = /\bsponsoredImageResponses\b/u.test(wrapperText);
  let sponsorSetup = "const routeRequest = routeResponse;";
  if (supportsSponsorResponseIdentity) {
    const declarations = [...indexText.matchAll(/^const sponsoredImageResponses = new WeakSet<Response>\(\);$/gmu)];
    const markers = [...indexText.matchAll(/if\(sponsored\)\{sponsoredImageResponses\.add\(sponsored\);return sponsored;\}/gu)];
    assert.equal(declarations.length, 1, "The actual private response WeakSet must be located exactly once");
    assert.equal(markers.length, 1, "The actual handled-response marker must be located exactly once");
    // Keep the native declaration, marker and complete wrapper in one closure.
    // The route port supplies only a response identity; it cannot certify the
    // upstream sponsor handler's authorization, which has separate native tests.
    sponsorSetup = `${declarations[0][0].replace("<Response>", "")}
      const recordSponsoredResponse = sponsored => { ${markers[0][0]} };
      const routeRequest = async (...args) => {
        const response = await routeResponse(...args);
        recordSponsoredResponse(sponsorResponseIdentity === "returned" ? response
          : sponsorResponseIdentity === "different" ? response.clone() : null);
        return response;
      };`;
  }

  let memoryRepairPath = null;
  if (/\bMEMORY_SCHEMA_REPAIR_PATH\b/u.test(wrapperText)) {
    const source = await readFile(new URL("./memory-schema-repair-api.ts", indexUrl), "utf8");
    const declarations = [...source.matchAll(/^export const MEMORY_SCHEMA_REPAIR_PATH='([^'\r\n]+)';$/gmu)];
    assert.equal(declarations.length, 1, "The actual immutable Memory repair path must be located exactly once");
    memoryRepairPath = declarations[0][1];
  }

  function wrapper(status, sponsorResponseIdentity = "unhandled") {
    assert.ok(["unhandled", "returned", "different"].includes(sponsorResponseIdentity));
    assert.ok(supportsSponsorResponseIdentity || sponsorResponseIdentity === "unhandled", "This source has no sponsor response marker");
    let retentionCalls = 0, routes = 0;
    // Only observe the surrounding dispatch effects. Retention decisions execute
    // the complete production wrapper and its real selected-share classifier.
    const fetch = new Function("routeResponse", "schedulePrivateContentRetention", "OUTPUT_SCHEMA_PREFLIGHT_PATH", "isSelectedOutputShareApiPath", "sponsorResponseIdentity", "MEMORY_SCHEMA_REPAIR_PATH", `${sponsorSetup}\nreturn (${wrapperText});`)(
      async () => { routes++; return Response.json({ status }, { status }); },
      () => { retentionCalls++; }, preflightPath, isSelectedOutputShareApiPath, sponsorResponseIdentity, memoryRepairPath);
    return { fetch, counts: () => ({ retentionCalls, routes }) };
  }
  return { indexText, preflightPath, supportsSponsorResponseIdentity, wrapper };
}
