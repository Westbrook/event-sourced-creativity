import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

/** Supplementary Node-only import support. It maps exactly the committed WASM
 * bytes to a genuine compiled module so unchanged Worker implementations can
 * execute against the mutation-observing SQLite test fixture. Actual Worker
 * deployment packaging is qualified separately by Vite/CompiledWasm/workerd. */
export function registerAudioShareNodeWasm() {
  const expected = new URL("../../worker/vendor/mpg123/decoder.wasm", import.meta.url).href;
  const bytes = readFileSync(new URL(expected));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "f0e9e8848367320ccb757e4092f0d6809668cfe38f43139d47b447151d7dff6b");
  return registerHooks({ load(url, context, nextLoad) {
    if (!/\.wasm(?:[?#]|$)/u.test(url)) return nextLoad(url, context);
    assert.equal(url, expected, "The Node test harness may import only the exact pinned decoder");
    return { format: "module", shortCircuit: true,
      source: `export default new WebAssembly.Module(Uint8Array.from(Buffer.from(${JSON.stringify(bytes.toString("base64"))},"base64")));` };
  } });
}
