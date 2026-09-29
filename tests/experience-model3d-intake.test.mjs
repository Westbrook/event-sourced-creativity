import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

// Optional isolated-donor suppliers. Integrated runs use ordinary relative imports.
// Only these named application modules can be resolved; no existing test is loaded.
const supplierPath = process.env.FORMA_MODEL3D_INTAKE_SUPPLIER_ROOT;
const root = new URL("../", import.meta.url);
if (supplierPath) {
  assert.ok(isAbsolute(supplierPath), "supplier root must be an explicit absolute path");
  const supplier = pathToFileURL(supplierPath.replace(/\/?$/u, "/"));
  const owned = new Set(["contracts.ts", "catalog.ts", "compiler.ts", "intake.ts", "view.ts"]);
  const allowed = new Set([...owned, "image-ratio.ts", "scene-context.ts", "intake-runtime.ts", "native-host.ts", "host-route.ts"]);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(".") && context.parentURL
        && [root.href, supplier.href].some(prefix => context.parentURL.startsWith(prefix))) {
        const target = new URL(specifier, context.parentURL);
        const name = target.pathname.split("/").at(-1);
        if (target.pathname.includes("/src/experiences/") && allowed.has(name)) {
          return nextResolve(new URL("src/experiences/" + name, owned.has(name) ? root : supplier).href, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

const { definitions, contextCatalog } = await import("../src/experiences/catalog.ts");
const { compileExperience, canonicalJson } = await import("../src/experiences/compiler.ts");
const {
  registeredExperience, initialValues, intakeValueIssues, validateIntakeRequest,
  buildExperiencePlan, isExperienceContextOutput, parseExperienceEntryRoute,
} = await import("../src/experiences/intake.ts");
const { experienceOutputSettings } = await import("../src/experiences/native-host.ts");
const { parseExperienceHostRoute } = await import("../src/experiences/host-route.ts");
const release = await registeredExperience("model3d");
const intentId = "d8a19d41-3f8c-40ea-8b99-397097d71099";
const values = () => ({
  subject: { value: "A single ceramic desk lamp", provenance: "authored" },
  direction: { value: "Matte blue glaze; rounded base", provenance: "authored" },
});
const request = (v = values()) => ({
  intentId, experienceId: "model3d", releaseHash: release.releaseHash, values: v,
});

test("registered Model3D context is one static GLB object, with bounded text only", async () => {
  assert.ok(release);
  assert.equal(release.qualification, "context-authoring");
  assert.equal(release.output.id, "model3d.single@1");
  assert.equal(release.output.bindingPackRef, "model3d.direction@1");
  assert.equal(release.output.viewerRef, "model3d.read-only@1");
  assert.equal(release.output.result, "1 static GLB object");
  assert.equal(release.output.output, "model3d");
  assert.equal(isExperienceContextOutput("model3d"), true);
  assert.deepEqual(release.output.bindings.map(({ slot, role, target }) => ({ slot, role, target })), [
    { slot: "subject", role: "subject", target: "model3d" },
    { slot: "direction", role: "direction", target: "model3d" },
  ]);
  assert.deepEqual(Object.keys(release.interactions), ["subject", "direction"]);
  for (const interaction of Object.values(release.interactions)) {
    assert.equal(interaction.kind, "source");
    assert.equal(interaction.renderer, "role-source@1");
    assert.ok(Object.isFrozen(interaction));
  }
  assert.equal(release.interactions.subject.maxLength, 600);
  assert.equal(release.interactions.direction.maxLength, 300);
  assert.equal(release.interactions.direction.required, false);
  assert.equal(release.definition.copySetRef, "functional.en@1");
  assert.equal(Object.isFrozen(release), true);
  const compiled = await compileExperience(definitions.find(d => d.id === "model3d"), contextCatalog);
  assert.equal(compiled.ok, true);
  assert.equal(canonicalJson(compiled.release), canonicalJson(release));
  assert.equal(await registeredExperience("model3d-upload"), null);
});

test("the four original registrations retain exact release hashes and order within the expanded catalog", async () => {
  const prior = {
  "image": {
    "definitionHash": "sha256:fa586999b2f7f311b6da26f81d831a7ef36da31fd579466b261c77e612614fc8",
    "releaseHash": "sha256:72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f"
  },
  "slides": {
    "definitionHash": "sha256:545ae81a4e2e9315c912be873bd4d16394280f6684c741335aabb44fda69d740",
    "releaseHash": "sha256:9c7847a372e3ec9f98ae8d870e030e940ebf55f465e4dfa6d0d97769d909432c"
  },
  "short-story": {
    "definitionHash": "sha256:bb96af6abbd494678612219845b3470b8fcf8d938fed9416dfc8fcd39300f285",
    "releaseHash": "sha256:8fa5bde0564550eb8f3d1f1dc25637c778d2fa47e04b90947a2a9bbcfe2d1021"
  },
  "scene": {
    "definitionHash": "sha256:2e9225db5a15e351287b1e39800b70f5072f87f63f3fb0bc3af20eae56cd9c0f",
    "releaseHash": "sha256:4e45539677493899545f3e1132ed7934d846cd417c51357d2aeee87c1cf8f7eb"
  }
};
  assert.deepEqual(definitions.map(d => d.id), [...Object.keys(prior), "model3d", "storyboard", "audio", "video"]);
  for (const [id, expected] of Object.entries(prior)) {
    const current = await registeredExperience(id);
    assert.deepEqual({ definitionHash: current.definitionHash, releaseHash: current.releaseHash }, expected);
  }
});

test("complete intake requires literal bounded subject, preserves optional/Unicode text and provenance", async () => {
  const defaults = initialValues(release);
  assert.deepEqual(intakeValueIssues(release, defaults), [{ code: "required", path: "subject" }]);
  const limit = values();
  limit.subject.value = "🪔".repeat(300); // Existing textarea/compiler policy counts UTF-16 units.
  limit.direction.value = "水".repeat(300);
  assert.deepEqual(intakeValueIssues(release, limit), []);
  limit.subject.value += "a";
  assert.equal(intakeValueIssues(release, limit)[0].code, "text_limit");
  limit.subject.value = "Lamp";
  limit.direction.value += "a";
  assert.equal(intakeValueIssues(release, limit)[0].code, "text_limit");
  const optional = values();
  optional.direction = defaults.direction;
  assert.deepEqual(intakeValueIssues(release, optional), []);
  const whitespace = values();
  whitespace.subject.value = "\n \t";
  assert.equal(intakeValueIssues(release, whitespace)[0].code, "required");
  const inventedDefault = values();
  inventedDefault.subject.provenance = "default";
  assert.equal(intakeValueIssues(release, inventedDefault)[0].code, "provenance_invalid");
  const exact = request();
  const validated = await validateIntakeRequest(exact);
  assert.ok(validated);
  exact.values.subject.value = "changed after validation";
  assert.equal(validated.request.values.subject.value, "A single ceramic desk lamp");
  assert.ok(Object.isFrozen(validated.request.values.subject));
  assert.equal(await validateIntakeRequest({ ...request(), releaseHash: "sha256:" + "0".repeat(64) }), null);
  assert.equal(await validateIntakeRequest({ ...request(), experienceId: "image" }), null);
});

test("plan is deterministic authoring only, with no reference, job, execution or grant event", async () => {
  const exact = request();
  exact.values.subject.value = "  A single 灯笼\n<script>literal</script>  ";
  const plan = await buildExperiencePlan("synthetic-model3d-author", exact, release);
  const again = await buildExperiencePlan("synthetic-model3d-author", exact, release);
  assert.equal(canonicalJson(plan), canonicalJson(again));
  assert.deepEqual(plan.events.map(e => e.type), [
    "ProjectCreated", "DocumentCreated", "EmptyCanvasChosen", "BlockCreated", "BlockCreated", "BlockCreated",
  ]);
  const [subject, direction, format] = plan.events.slice(3).map(e => e.payload);
  assert.equal(subject.type, "subject");
  assert.equal(subject.properties.text, exact.values.subject.value.trim());
  assert.equal(subject.properties.experience_value, exact.values.subject.value);
  assert.equal(subject.properties.authority, "authored");
  assert.equal(direction.type, "direction");
  assert.equal(direction.properties.text, exact.values.direction.value);
  assert.equal(format.type, "format");
  assert.equal(format.properties.text, "1 static GLB object");
  assert.equal(format.properties.authority, "inferred");
  assert.equal(plan.title, "3D object");
  assert.equal(plan.streamId, "creative:synthetic-model3d-author");
  assert.equal(new Set(plan.events.map(e => e.payload.client_event_id)).size, plan.events.length);
  assert.ok(Object.isFrozen(plan.events[3].payload.properties));
  assert.equal("receipt" in plan, false);
  assert.equal("grant" in plan, false);
  const optional = values();
  optional.direction = initialValues(release).direction;
  const optionalPlan = await buildExperiencePlan("synthetic-model3d-author", request(optional), release);
  assert.equal(optionalPlan.events.length, 5);
  assert.equal(optionalPlan.events.some(e => e.payload.handle === "direction/experience-direction"), false);
});

test("reference-shaped, getter and extra inputs fail closed; a URL in prose never becomes a reference", async () => {
  for (const attempted of [
    { ownedImageId: "image", source_ref: "/api/media/private.png" },
    { url: "https://example.invalid/image.png" },
    { mesh: "model.glb" },
    ["image"],
    new Uint8Array([1, 2, 3]),
  ]) {
    const v = values();
    v.subject.value = attempted;
    assert.equal(await validateIntakeRequest(request(v)), null);
  }
  assert.equal(await validateIntakeRequest({ ...request(), referenceBlockIds: ["owned"] }), null);
  const extra = values();
  extra.reference = { value: "/api/media/example.png", provenance: "authored" };
  assert.equal(await validateIntakeRequest(request(extra)), null);
  let getterCalls = 0;
  const getter = values();
  Object.defineProperty(getter.subject, "value", { enumerable: true, get() { getterCalls++; return "Lamp"; } });
  assert.equal(await validateIntakeRequest(request(getter)), null);
  assert.equal(getterCalls, 0);
  const prose = values();
  prose.subject.value = "A plaque engraved with https://example.invalid/model.glb";
  const plan = await buildExperiencePlan("synthetic-model3d-author", request(prose), release);
  assert.equal(plan.events[3].payload.properties.experience_value, prose.subject.value);
  assert.ok(plan.events.every(e => !("source_ref" in e.payload) && !("media_url" in e.payload)));
  assert.ok(plan.events.filter(e => e.type === "BlockCreated").every(e => !["reference", "model3d"].includes(e.payload.type)));
});

test("entry and native selectors admit bounded Model3D identity without issuing execution authority", async () => {
  assert.deepEqual(parseExperienceEntryRoute(new URL("https://forma.invalid/experiences/model3d")), { output: "model3d" });
  assert.deepEqual(parseExperienceEntryRoute(new URL("https://forma.invalid/experiences/model3d?intent=" + intentId)), { output: "model3d", intentId });
  for (const suffix of ["#main", "?ref=https://example.invalid/x.png", "?intent=x", "?intent=" + intentId + "&intent=" + intentId, "/mesh"]) {
    assert.equal(parseExperienceEntryRoute(new URL("https://forma.invalid/experiences/model3d" + suffix)), null);
  }
  const plan = await buildExperiencePlan("synthetic-model3d-author", request(), release);
  const settings = experienceOutputSettings(plan);
  assert.deepEqual(settings, { output: "model3d", kind: "render_document", productionMode: "manual", artifactKind: "model3d", itemCount: 1 });
  assert.equal(Object.isFrozen(settings), true);
  assert.equal("grantId" in settings, false); assert.equal("paidMediaConfirmed" in settings, false);
  const documentRoute = "/document/" + plan.documentId + "/3d-object";
  assert.deepEqual(parseExperienceHostRoute(documentRoute + "?experience=model3d&experience-draft=" + plan.draftId),
    { output: "model3d", draftId: plan.draftId, documentId: plan.documentId, documentRoute });
  for (const suffix of ["&grantId=forged", "&paidMediaConfirmed=true", "&experience=model3d", "#mesh"]) {
    assert.equal(parseExperienceHostRoute(documentRoute + "?experience=model3d&experience-draft=" + plan.draftId + suffix), null);
  }
});

test("view separates checked reference context from adapter-gated generation and renders plain direction text", () => {
  // Source policy only: this is not browser, layout, focus or assistive-technology evidence.
  const source = readFileSync(fileURLToPath(new URL("src/experiences/view.ts", root)), "utf8");
  assert.ok(source.includes("new Model3dReferencePicker((selection, ready) => this.runtime.changeReference(selection, ready), readModel3dReferenceIntent(this.runtime.state.draft.reference) ?? undefined)"));
  assert.ok(source.includes("Saving creates Document context, not a 3D file."));
  assert.ok(source.includes("A selected reference is rechecked before Save; it does not authorize generation."));
  const reference = readFileSync(fileURLToPath(new URL("src/experiences/model3d-reference.ts", root)), "utf8");
  assert.ok(reference.includes("URLs, files, owner claims and inferred permission are not inputs."));
  const branch = source.slice(source.indexOf('} else if (this.runtime.release.output.output === "model3d")'), source.indexOf('} else if (this.runtime.release.output.output === "short_story")'));
  assert.match(branch, /this\.#summary\(\)/u);
  assert.doesNotMatch(branch, /innerHTML|createObjectURL|<img|fetch|iframe|canvas/u);
  const native = source.slice(source.indexOf("async #native()"));
  assert.match(native, /if \(!this\.#adapter \|\| !\[[^\]]*"model3d"\]\.includes\(this\.runtime\.release\.output\.output\)\)/u);
  assert.match(native, /this\.#adapter\.mount\(target, Object\.freeze\(\{ plan, receipt, settings: experienceOutputSettings\(plan\) \}\), this\.#abort\.signal\)/u);
});
