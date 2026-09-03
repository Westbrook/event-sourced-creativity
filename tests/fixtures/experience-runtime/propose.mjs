import { open } from "node:fs/promises";
import { definitions, fixtureCatalog } from "./catalog.ts";
import { compileExperience } from "./compiler.ts";
import { proposePatch } from "./patches.ts";

// This command evaluates supplied JSON. It has no model, network, publish or spending authority.
const [recipeId, patchFile] = process.argv.slice(2);
const definition = definitions.find(item => item.id === recipeId);
try {
  if (!definition || process.argv.length > 4) throw new Error("Use: propose.mjs <recipe-id> [patch.json]");
  const base = await compileExperience(definition, fixtureCatalog);
  if (!base.ok) throw new Error("base_definition_invalid");
  if (!patchFile) {
    process.stdout.write(`${JSON.stringify({ qualification: "fixture", releaseHash: base.release.releaseHash, definition: base.release.definition }, null, 2)}\n`);
  } else {
    const file = await open(patchFile, "r");
    let raw;
    try {
      if (!(await file.stat()).isFile()) throw new Error("patch_file_required");
      const buffer = Buffer.alloc(16385);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 16384) throw new Error("patch_limit");
      raw = buffer.subarray(0, bytesRead);
    } finally { await file.close(); }
    const result = await proposePatch(base.release, JSON.parse(raw.toString("utf8")), fixtureCatalog);
    if (!result.ok) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = 1; }
    else process.stdout.write(`${JSON.stringify({ qualification: "fixture", published: false, baseReleaseHash: base.release.releaseHash, diff: result.diff, candidate: result.candidate }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof SyntaxError ? "invalid_json" : error instanceof Error ? error.message : "proposal_failed"}\n`);
  process.exitCode = 1;
}
