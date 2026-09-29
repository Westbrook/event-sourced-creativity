import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";

// Reuse the complete existing full Canvas/component/model fixture, with only an
// export on its declaration prefix. No original test or production method is
// replaced. Its Store, read transport, scheduling and native DOM are finite
// deterministic ports, not Worker authorization or browser/AT evidence.
const original = fs.readFileSync(new URL("../canvas-calm-controls-host.test.mjs", import.meta.url), "utf8");
const boundary = '\ntest("actual empty Canvas resting';
assert.equal(original.split(boundary).length, 2, "one exact first-test boundary");
const source = original.slice(0, original.indexOf(boundary))
  + "\nexport {fixture,documentPort,windowPort,loadActual,ElementPort};\n";
const fixtureURL = new URL("../_canvas-focus-repair-host-fixture.mjs", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === fixtureURL) return { url: fixtureURL, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === fixtureURL) return { format: "module", source, shortCircuit: true };
    return next(url, context);
  },
});
const actual = await import(fixtureURL).finally(() => hooks.deregister());
export const { fixture, documentPort, windowPort, loadActual, ElementPort } = actual;
