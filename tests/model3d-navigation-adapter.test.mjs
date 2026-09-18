import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { experienceNavigationAdapter } from "../src/experiences/navigation-adapter.ts";
import { experienceOutputSettings } from "../src/experiences/native-host.ts";
import { parseExperienceHostRoute } from "../src/experiences/host-route.ts";
const draftId = "experience-draft-" + "a".repeat(64);
function context(output = "model3d", documentRoute = "/document/synthetic-model3d") {
  // Only the fields this navigation-only adapter consumes. Not an admission grant,
  // private original, stored receipt or real authoring/HTTP claim.
  const plan = Object.freeze({ draftId, release: Object.freeze({ output: Object.freeze({ output }) }) });
  return Object.freeze({ plan, receipt: Object.freeze({ generation: "unavailable", documentRoute }),
    settings: output === "unsupported" || output === "video" ? null : experienceOutputSettings(plan) });
}
function target() {
  return {
    children: [],
    ownerDocument: { createElement(tag) { assert.equal(tag, "a"); return { tagName: "A" }; } },
    replaceChildren(...children) { this.children = children; },
  };
}

test("actual Model3D navigation adapter mounts Continue while Save remains non-generating", async () => {
  const element = target(), abort = new AbortController(), input = context(), before = JSON.stringify(input);
  let calls = 0; const fetch = globalThis.fetch;
  globalThis.fetch = () => { calls++; throw Error("No transport is permitted in navigation"); };
  try {
    const adapter = experienceNavigationAdapter("/experiences/model3d?progress-report=");
    const session = await adapter.mount(element, input, abort.signal);
    assert.equal(element.children.length, 1);
    const link = element.children[0];
    assert.equal(link.textContent, "Continue");
    assert.equal(link.className, "experience-button primary");
    assert.equal(link.href, "/document/synthetic-model3d?progress-report=&experience=model3d&experience-draft=" + draftId);
    assert.deepEqual(parseExperienceHostRoute(link.href), { output: "model3d", documentId: "synthetic-model3d", draftId,
      documentRoute: "/document/synthetic-model3d?progress-report=" });
    assert.equal(JSON.stringify(input), before);
    assert.equal(input.receipt.generation, "unavailable");
    assert.equal(calls, 0);
    session.dispose(); assert.deepEqual(element.children, []);
  } finally { globalThis.fetch = fetch; }
});

test("existing navigation outputs remain admitted, without adding Video or unknown outputs", async () => {
  for (const output of ["image", "slides", "short_story", "scene", "storyboard", "audio"]) {
    const element = target(), session = await experienceNavigationAdapter("/experiences/" + output)
      .mount(element, context(output), new AbortController().signal);
    assert.equal(parseExperienceHostRoute(element.children[0].href).output, output);
    session.dispose();
  }
  for (const output of ["video", "unsupported"]) {
    const element = target();
    await assert.rejects(() => experienceNavigationAdapter("/experiences/model3d").mount(element, context(output), new AbortController().signal), /experience_output_unsupported/u);
    assert.deepEqual(element.children, []);
  }
});

test("actual Model3D adapter retains strict route checks and abort/dispose cleanup", async () => {
  const adapter = experienceNavigationAdapter("/experiences/model3d");
  for (const route of ["/document/x?experience=image", "/document/x?experience-draft=" + draftId, "/document/x?unknown=1"]) {
    const element = target();
    await assert.rejects(() => adapter.mount(element, context("model3d", route), new AbortController().signal), /experience_route_invalid/u);
    assert.deepEqual(element.children, []);
  }
  await assert.rejects(() => experienceNavigationAdapter("/experiences/model3d?progress-report=&progress-report=")
    .mount(target(), context(), new AbortController().signal), /experience_route_invalid/u);
  const normalized = target();
  const normalizedSession = await adapter.mount(normalized, context("model3d", "/document/x#main-content"), new AbortController().signal);
  assert.equal(parseExperienceHostRoute(normalized.children[0].href).documentRoute, "/document/x");
  assert.ok(!normalized.children[0].href.includes("#"));
  normalizedSession.dispose();
  const element = target(), controller = new AbortController();
  const session = await adapter.mount(element, context(), controller.signal);
  controller.abort(); assert.deepEqual(element.children, []);
  session.dispose(); assert.deepEqual(element.children, []);
  const retired = new AbortController(); retired.abort();
  await adapter.mount(element, context(), retired.signal); assert.deepEqual(element.children, []);
});

test("Model3D authored preview describes separate continuation, never automatic generation", () => {
  const source = fs.readFileSync(new URL(import.meta.resolve("../src/experiences/view.ts")), "utf8");
  const branch = source.slice(source.indexOf('el("h2", "One static GLB object")'), source.indexOf('} else if (this.runtime.release.output.output === "short_story")'));
  assert.ok(branch.includes("Saving creates Document context, not a 3D file. A selected reference is rechecked before Save; it does not authorize generation. After saving, Continue to review cost and source transfer. Creation requires separate approval."));
  assert.ok(!branch.includes("Generation unavailable"));
  assert.ok(source.includes('if (!this.#adapter || !["image", "slides", "short_story", "scene", "storyboard", "audio", "model3d"].includes'));
});
