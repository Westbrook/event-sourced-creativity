import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { definitions, contextCatalog } from "../src/experiences/catalog.ts";
import { compileExperience } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceDocumentRoute, initialValues, intakeValueIssues, isExperienceContextOutput, parseExperienceEntryRoute, registeredExperience, validateIntakeRequest } from "../src/experiences/intake.ts";
import { experienceOutputSettings } from "../src/experiences/native-host.ts";
import { isStandaloneExperienceRoute, parseExperienceHostRoute } from "../src/experiences/host-route.ts";
import { ExperienceIntakeRuntime } from "../src/experiences/intake-runtime.ts";

const accepted = [
  ["image", "fa586999b2f7f311b6da26f81d831a7ef36da31fd579466b261c77e612614fc8", "72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f"],
  ["slides", "545ae81a4e2e9315c912be873bd4d16394280f6684c741335aabb44fda69d740", "9c7847a372e3ec9f98ae8d870e030e940ebf55f465e4dfa6d0d97769d909432c"],
  ["short-story", "bb96af6abbd494678612219845b3470b8fcf8d938fed9416dfc8fcd39300f285", "8fa5bde0564550eb8f3d1f1dc25637c778d2fa47e04b90947a2a9bbcfe2d1021"],
  ["scene", "2e9225db5a15e351287b1e39800b70f5072f87f63f3fb0bc3af20eae56cd9c0f", "4e45539677493899545f3e1132ed7934d846cd417c51357d2aeee87c1cf8f7eb"],
  ["model3d", "42a7cd49b1115e11cd4ef0b37901edb836f126cfe858e5c99ed8d1f348dabc13", "f53f5cbc05d9bf0889148742149fbd3c6558de4adf606ea757f4a9ab9667d1a6"],
];
const story = "  A lantern is found.\n灯笼 — فانوس\n<svg>It is lifted, then carried home.</svg>  ";
const composition = "  Preserve screen direction; a wide opening and closer final view.\nBlue dusk, warm light.  ";
const intentId = "00000000-0000-4000-8000-000000000031";
async function request() {
  const release = await registeredExperience("storyboard"); assert(release);
  return { release, request: { intentId, experienceId: "storyboard", releaseHash: release.releaseHash,
    values: { story: { value: story, provenance: "authored" }, composition: { value: composition, provenance: "authored" } } } };
}

test("Storyboard appends a four-frame recipe without changing five accepted releases", async () => {
  assert.deepEqual(definitions.map(value => value.id), [...accepted.map(value => value[0]), "storyboard", "audio", "video"]);
  for (const [id, definitionHash, releaseHash] of accepted) {
    const release = await registeredExperience(id);
    assert.equal(release.definitionHash, "sha256:" + definitionHash);
    assert.equal(release.releaseHash, "sha256:" + releaseHash);
  }
  const { release } = await request();
  assert.equal(release.qualification, "context-authoring");
  assert.equal(release.output.output, "storyboard");
  assert.equal(release.output.result, "4 storyboard frames");
  assert.equal(release.output.viewerRef, "storyboard.read-only@1");
  assert.equal(release.output.essentialInteractionRef, "storyboard-story@1");
  assert.deepEqual(release.definition.decisions.map(value => value.id), ["story", "composition"]);
  assert.deepEqual(release.output.bindings.map(value => value.role), ["evidence", "direction"]);
  for (const interaction of Object.values(release.interactions)) {
    assert.equal(interaction.kind, "source"); assert.equal(interaction.required, true);
    assert.equal(interaction.maxLength, 600); assert.equal(interaction.defaultValue, "");
  }
  assert.equal(isExperienceContextOutput("storyboard"), true);
  assert.equal(isExperienceContextOutput("Storyboard"), false);
  assert(Object.isFrozen(release.output));
});

test("Both source fields are required and retain bounded Unicode/literal input", async () => {
  const { release, request: input } = await request();
  assert.deepEqual(intakeValueIssues(release, initialValues(release)).map(value => value.path), ["story", "composition"]);
  assert.deepEqual(intakeValueIssues(release, input.values), []);
  assert.equal((await validateIntakeRequest(input)).request.values.story.value, story);
  for (const id of ["story", "composition"]) {
    const blank = structuredClone(input); blank.values[id].value = " \n\t ";
    assert.equal(await validateIntakeRequest(blank), null);
    const boundary = structuredClone(input); boundary.values[id].value = "a".repeat(600);
    assert(await validateIntakeRequest(boundary));
    boundary.values[id].value += "a"; assert.equal(await validateIntakeRequest(boundary), null);
    boundary.values[id].value = "灯".repeat(600); assert(await validateIntakeRequest(boundary));
    boundary.values[id].value = "🎞".repeat(301); // 602 UTF-16 units, not a grapheme limit.
    assert.equal(await validateIntakeRequest(boundary), null);
  }
});

test("Reference-shaped values, extra fields and getters cannot become source transfer", async () => {
  const { request: input } = await request();
  for (const value of [{ url: "https://example.test/frame.png" }, [{ id: "frame1", text: "One" }], null, 4]) {
    const next = structuredClone(input); next.values.story.value = value;
    assert.equal(await validateIntakeRequest(next), null);
  }
  const extra = structuredClone(input); extra.values.reference = { value: "saved-view", provenance: "authored" };
  assert.equal(await validateIntakeRequest(extra), null);
  const spoofed = structuredClone(input); spoofed.values.story.provenance = "default";
  assert.equal(await validateIntakeRequest(spoofed), null);
  let getterReads = 0; const getter = structuredClone(input);
  Object.defineProperty(getter.values.story, "value", { enumerable: true, get() { getterReads++; return story; } });
  assert.equal(await validateIntakeRequest(getter), null); assert.equal(getterReads, 0);
  const literal = structuredClone(input); literal.values.story.value = "The sign says https://example.test/frame.png";
  const checked = await validateIntakeRequest(literal); assert(checked);
  const plan = await buildExperiencePlan("storyboard-intake-owner", checked.request, checked.release);
  assert.equal(plan.events[3].payload.properties.text, literal.values.story.value);
  assert.equal(plan.events.filter(value => value.type === "ReferenceIngested").length, 0);
});

test("Plan saves exactly six deterministic context events without inventing four frames", async () => {
  const { release, request: input } = await request(); const expected = structuredClone(input);
  const pending = buildExperiencePlan("storyboard-intake-owner", input, release);
  input.values.story.value = "Changed while resource identities are hashed";
  const plan = await pending;
  assert.deepEqual(plan, await buildExperiencePlan("storyboard-intake-owner", expected, release));
  assert.deepEqual(plan.events.map(value => value.type), ["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen", "BlockCreated", "BlockCreated", "BlockCreated"]);
  assert.deepEqual(plan.events.slice(3).map(value => value.payload.type), ["message", "composition", "format"]);
  assert.equal(plan.events[3].payload.properties.subtype, "Narrative beat");
  assert.equal(plan.events[3].payload.properties.text, story.trim());
  assert.equal(plan.events[3].payload.properties.experience_value, story);
  assert.equal(plan.events[4].payload.properties.subtype, "Focal hierarchy");
  assert.equal(plan.events[4].payload.properties.text, composition.trim());
  assert.equal(plan.events[4].payload.properties.experience_value, composition);
  assert.equal(plan.events[5].payload.properties.text, "4 storyboard frames");
  assert.equal(plan.events[5].payload.properties.subtype, "Channel");
  assert.equal(plan.events[5].payload.properties.authority, "inferred");
  assert.equal(plan.events[5].payload.properties.experience_origin, "default");
  assert.equal(new Set(plan.events.map(value => value.payload.client_event_id)).size, 6);
  assert(plan.events.every(value => value.payload.project_id === plan.projectId));
  assert(plan.events.slice(1).every(value => value.payload.document_id === plan.documentId));
  assert.equal(experienceDocumentRoute(plan), "/document/" + plan.documentId + "/storyboard");
  assert(Object.isFrozen(plan.request.values.story)); assert(Object.isFrozen(plan.events[3].payload.properties));
  assert.equal(JSON.stringify(plan.events).includes('"media_url"'), false);
  assert.equal(JSON.stringify(plan.events).includes('"frames"'), false);
});

test("Storyboard admits a retained-result host selector and fixed settings, not generation authority", async () => {
  const { release, request: input } = await request();
  const plan = await buildExperiencePlan("storyboard-intake-owner", input, release);
  assert.deepEqual(parseExperienceEntryRoute(new URL("https://forma.test/experiences/storyboard")), { output: "storyboard" });
  assert.deepEqual(parseExperienceEntryRoute(new URL("https://forma.test/experiences/storyboard?draft=" + plan.draftId)), { output: "storyboard", draftId: plan.draftId });
  assert.equal(isStandaloneExperienceRoute("/experiences/storyboard?progress-report"), true);
  for (const suffix of ["?draft=bad", "?draft=" + plan.draftId + "&intent=" + intentId, "?frames=4", "#generated"]) {
    assert.equal(parseExperienceEntryRoute(new URL("https://forma.test/experiences/storyboard" + suffix)), null);
  }
  assert.equal(isStandaloneExperienceRoute("/experiences/storyboard#generated"), false);
  assert.deepEqual(parseExperienceHostRoute(experienceDocumentRoute(plan) + "?experience=storyboard&experience-draft=" + plan.draftId),
    { output:"storyboard",draftId:plan.draftId,documentId:plan.documentId,documentRoute:experienceDocumentRoute(plan) });
  assert.deepEqual(experienceOutputSettings(plan), {output:"storyboard",kind:"render_document",productionMode:"manual",artifactKind:"storyboard",itemCount:4});
  const changed = structuredClone(release.definition); changed.viewerRef = "storyboard.edit@1";
  assert.equal((await compileExperience(changed, contextCatalog)).ok, false);
});

test("New Storyboard runtime uses explicit draft/commit and GET-only retained recovery", async () => {
  const { release } = await request(); const calls = []; let plan, receipt;
  const fetcher = async (path, init) => {
    calls.push({ path, method: init.method ?? "GET" });
    assert.equal(init.credentials, "same-origin"); assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store"); assert(init.signal instanceof AbortSignal);
    if (path === "/api/experiences/drafts" && init.method === "POST") {
      const checked = await validateIntakeRequest(JSON.parse(init.body)); assert(checked);
      plan = await buildExperiencePlan("storyboard-intake-owner", checked.request, checked.release);
      return Response.json({ status: "prepared", plan });
    }
    if (path === "/api/experiences/drafts/" + plan.draftId + "/commit" && init.method === "POST") {
      assert.deepEqual(JSON.parse(init.body), { draftHash: plan.draftHash });
      receipt = { status: "complete", generation: "unavailable", projectId: plan.projectId,
        documentId: plan.documentId, draftId: plan.draftId, draftHash: plan.draftHash,
        documentRoute: experienceDocumentRoute(plan), head: 6, rejected: [],
        appended: plan.events.map((event, index) => ({ ...event,
          eventId: "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
          actor: "user", streamId: plan.streamId, clientId: "web:experience-intake",
          correlationId: "experience-intake:" + plan.projectId, schemaVersion: 1,
          compensatesEventId: null, sequence: index + 1 })),
      };
      return Response.json(receipt);
    }
    if (path === "/api/experiences/drafts/" + plan.draftId && !init.method) return Response.json({ status: "prepared", plan });
    if (path === "/api/experiences/drafts/" + plan.draftId + "/receipt" && !init.method) return Response.json(receipt);
    throw Error("Unselected Storyboard fixture request");
  };
  const runtime = new ExperienceIntakeRuntime(release, fetcher); assert.equal(calls.length, 0);
  await runtime.prepare(); assert.equal(calls.length, 0);
  assert(runtime.change("story", story)); assert(runtime.change("composition", composition)); assert.equal(calls.length, 0);
  await runtime.prepare(); assert.equal(runtime.state.phase, "review"); assert.equal(calls.length, 1);
  await runtime.submit(); assert.equal(runtime.state.phase, "complete"); assert.equal(calls.length, 2);
  assert.equal(runtime.committedPlan.events.length, 6); assert.equal(runtime.receipt.generation, "unavailable");
  runtime.dispose();
  const resumed = new ExperienceIntakeRuntime(release, fetcher); await resumed.resume(plan.draftId);
  assert.equal(resumed.state.phase, "complete"); assert.equal(resumed.documentRoute, receipt.documentRoute);
  assert.deepEqual(resumed.state.draft.values, plan.request.values);
  assert.deepEqual(calls.map(value => value.method), ["POST", "POST", "GET", "GET"]); resumed.dispose();
});

test("Storyboard copy exposes planned output and retained native reading without paid activation", async () => {
  const source = await readFile(new URL("../src/experiences/view.ts", import.meta.url), "utf8");
  assert(source.includes('runtime.release.output.output === "storyboard" ?'));
  assert(source.includes("Planned output: "));
  assert(source.includes("Describe the key moments in order and the framing and composition to carry across four frames."));
  assert(source.includes("These are authored directions, not generated frames. Saving creates Document context for a four-frame storyboard; it does not authorize generation. After saving, Continue to review cost and source transfer. Creation requires separate approval."));
  assert(source.includes('!["image", "slides", "short_story", "scene", "storyboard", "audio", "model3d"].includes(this.runtime.release.output.output)'));
  const terms = await readFile(new URL("../src/experiences/output-terms.ts", import.meta.url), "utf8");
  assert(terms.includes('if(options.output==="storyboard"){'));
  assert(terms.includes("readStoryboardExecutionOffer(target)"));
  assert(source.includes("item.textContent = text"));
});
