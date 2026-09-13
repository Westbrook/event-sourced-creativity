import test from "node:test";
import assert from "node:assert/strict";
import { definitions, contextCatalog } from "../src/experiences/catalog.ts";
import { EXPERIENCE_AUDIO_INTENT } from "../src/experiences/contracts.ts";
import { compileExperience } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceDocumentRoute, initialValues, intakeValueIssues, registeredExperience, validateIntakeRequest } from "../src/experiences/intake.ts";
import { experienceOutputSettings } from "../src/experiences/native-host.ts";
import { ExperienceIntakeRuntime } from "../src/experiences/intake-runtime.ts";

const previous = [
  ["image", "fa586999b2f7f311b6da26f81d831a7ef36da31fd579466b261c77e612614fc8", "72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f"],
  ["slides", "545ae81a4e2e9315c912be873bd4d16394280f6684c741335aabb44fda69d740", "9c7847a372e3ec9f98ae8d870e030e940ebf55f465e4dfa6d0d97769d909432c"],
  ["short-story", "bb96af6abbd494678612219845b3470b8fcf8d938fed9416dfc8fcd39300f285", "8fa5bde0564550eb8f3d1f1dc25637c778d2fa47e04b90947a2a9bbcfe2d1021"],
  ["scene", "2e9225db5a15e351287b1e39800b70f5072f87f63f3fb0bc3af20eae56cd9c0f", "4e45539677493899545f3e1132ed7934d846cd417c51357d2aeee87c1cf8f7eb"],
  ["model3d", "42a7cd49b1115e11cd4ef0b37901edb836f126cfe858e5c99ed8d1f348dabc13", "f53f5cbc05d9bf0889148742149fbd3c6558de4adf606ea757f4a9ab9667d1a6"],
  ["storyboard", "afa16a06eb55f342d2c527c76e212b13122d9e03969ab7bd7b0eaad4c41dfe73", "3ada8d245aefa89afee9f4aa031325429d930921c2af9519937bc9c4ef4828ff"],
];
const release = await registeredExperience("audio");
const direction = "  A rising motif, then a quiet finish.\n水 — موسيقى <script>literal</script>  ";
const intentId = "00000000-0000-4000-8000-000000000020";
const request = (detail = "") => ({
  intentId, experienceId: "audio", releaseHash: release.releaseHash,
  values: { direction: { value: direction, provenance: "authored" }, detail: { value: detail, provenance: detail ? "authored" : "default" } },
});

test("Audio appends after six exact recipes and binds planned instrumental timing into its release", async () => {
  assert.deepEqual(definitions.map(value => value.id), [...previous.map(value => value[0]), "audio"]);
  for (const [id, definitionHash, releaseHash] of previous) {
    const original = await registeredExperience(id);
    assert.equal(original.definitionHash, "sha256:" + definitionHash);
    assert.equal(original.releaseHash, "sha256:" + releaseHash);
  }
  assert.equal(release.qualification, "context-authoring");
  assert.equal(release.output.output, "audio");
  assert.equal(release.output.viewerRef, "audio.read-only@1");
  assert.equal(release.output.result, "1 instrumental track · about 20 seconds");
  assert.deepEqual(release.output.audioIntent, {
    role: "score", goal: "timed_music", destination: "standalone", durationSeconds: 20, requireInstrumental: true,
  });
  assert.ok(Object.isFrozen(release.output.audioIntent));
  assert.deepEqual(initialValues(release), {
    direction: { value: "", provenance: "default" }, detail: { value: "", provenance: "default" },
  });
  assert.deepEqual(release.output.bindings.map(b => [b.slot, b.role, b.target]), [["direction", "direction", "audio"], ["detail", "direction", "audio"]]);
});

test("Audio requires literal musical direction and bounds optional development without invented style defaults", async () => {
  assert.deepEqual(intakeValueIssues(release, initialValues(release)), [{ code: "required", path: "direction" }]);
  assert.ok(await validateIntakeRequest(request()));
  for (const [key, length] of [["direction", 600], ["detail", 300]]) {
    const input = request(); input.values[key] = { value: "水".repeat(length), provenance: "authored" };
    assert.ok(await validateIntakeRequest(input));
    input.values[key].value += "a";
    assert.equal(await validateIntakeRequest(input), null);
  }
  for (const value of [" \n\t", { url: "https://example.test/music.mp3" }, ["notes"], null]) {
    const input = request(); input.values.direction.value = value;
    assert.equal(await validateIntakeRequest(input), null);
  }
  const defaultSpoof = request(); defaultSpoof.values.direction.provenance = "default";
  assert.equal(await validateIntakeRequest(defaultSpoof), null);
  for (const extra of ["lyrics", "audioProfile", "durationSeconds", "providerJobId"]) {
    const input = request(); input.values[extra] = { value: "supplied", provenance: "authored" };
    assert.equal(await validateIntakeRequest(input), null);
  }
  let reads = 0; const accessor = request();
  Object.defineProperty(accessor.values.direction, "value", { enumerable: true, get() { reads++; return "music"; } });
  assert.equal(await validateIntakeRequest(accessor), null); assert.equal(reads, 0);
});

test("Compiler refuses widened or missing Audio intent, edited viewers, and Audio intent on another recipe", async () => {
  for (const change of [
    value => { delete value.audioIntent; },
    value => { value.audioIntent.durationSeconds = 30; },
    value => { value.audioIntent.requireInstrumental = false; },
    value => { value.audioIntent.goal = "narration"; },
    value => { value.audioIntent.transcript = "lyrics"; },
  ]) {
    const catalog = structuredClone(contextCatalog);
    change(catalog.outputs["audio.single@1"]);
    const compiled = await compileExperience(release.definition, catalog);
    assert.equal(compiled.ok, false);
    assert.ok(compiled.issues.some(issue => issue.code === "audio_intent_unavailable"));
  }
  const edited = structuredClone(release.definition); edited.viewerRef = "audio.edit@1";
  assert.equal((await compileExperience(edited, contextCatalog)).ok, false);
  const catalog = structuredClone(contextCatalog); catalog.outputs["image.single@2"].audioIntent = EXPERIENCE_AUDIO_INTENT;
  assert.equal((await compileExperience(definitions[0], catalog)).ok, false);
});

test("Audio saves exact authored context and planned format, with no generated audio, measured duration, or native grant", async () => {
  const input = request("  Begin sparse; bring the motif back at the end.  "), expected = structuredClone(input);
  const pending = buildExperiencePlan("audio-intake-owner", input, release);
  input.values.direction.value = "changed while hashing";
  const plan = await pending;
  assert.deepEqual(plan, await buildExperiencePlan("audio-intake-owner", expected, release));
  assert.deepEqual(plan.events.map(e => e.type), ["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen", "BlockCreated", "BlockCreated", "BlockCreated"]);
  assert.deepEqual(plan.events.slice(3).map(e => e.payload.type), ["direction", "direction", "format"]);
  assert.equal(plan.events[3].payload.properties.text, direction.trim());
  assert.equal(plan.events[3].payload.properties.experience_value, direction);
  assert.equal(plan.events[4].payload.properties.text, expected.values.detail.value.trim());
  const format = plan.events[5].payload.properties;
  assert.deepEqual(format.experience_audio_intent, EXPERIENCE_AUDIO_INTENT);
  assert.match(format.text, /no lyrics or spoken voice/);
  assert.match(format.text, /target; duration is not measured/);
  assert.equal(format.authority, "inferred");
  assert.equal(format.experience_origin, "default");
  assert.ok(Object.isFrozen(format.experience_audio_intent));
  assert.equal(experienceDocumentRoute(plan), "/document/" + plan.documentId + "/audio");
  assert.throws(() => experienceOutputSettings(plan), /experience_output_unsupported/);
  assert.equal(new Set(plan.events.map(e => e.payload.client_event_id)).size, 6);
  for (const word of ['"media_url"', '"GenerationCompleted"', '"DocumentRenderCompleted"', '"grantId"', '"providerJobId"', '"measured_duration_seconds"']) {
    assert.equal(JSON.stringify(plan.events).includes(word), false);
  }
  const optional = await buildExperiencePlan("audio-intake-owner", request(), release);
  assert.equal(optional.events.length, 5);
  assert.equal(optional.events.filter(e => e.payload.type === "direction").length, 1);
});

test("Audio context runtime performs explicit save/commit and retained GET only; synthetic receipt is not audio completion", async () => {
  const calls = []; let plan, receipt;
  const requestPort = async (path, init = {}) => {
    calls.push([path, init.method ?? "GET"]);
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error");
    if (path === "/api/experiences/drafts" && init.method === "POST") {
      const checked = await validateIntakeRequest(JSON.parse(init.body)); assert.ok(checked);
      plan = await buildExperiencePlan("audio-intake-owner", checked.request, checked.release);
      return Response.json({ status: "prepared", plan });
    }
    if (path === "/api/experiences/drafts/" + plan?.draftId + "/commit" && init.method === "POST") {
      receipt = { status: "complete", generation: "unavailable", projectId: plan.projectId, documentId: plan.documentId,
        draftId: plan.draftId, draftHash: plan.draftHash, documentRoute: experienceDocumentRoute(plan), head: plan.events.length, rejected: [],
        appended: plan.events.map((event, i) => ({ ...event,
          eventId: "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"), sequence: i + 1,
          actor: "user", streamId: plan.streamId, clientId: "web:experience-intake",
          correlationId: "experience-intake:" + plan.projectId, schemaVersion: 1, compensatesEventId: null })) };
      return Response.json(receipt);
    }
    if (path === "/api/experiences/drafts/" + plan?.draftId) return Response.json({ status: "prepared", plan });
    if (path === "/api/experiences/drafts/" + plan?.draftId + "/receipt") return Response.json(receipt);
    throw Error("Unexpected Audio context request: " + path);
  };
  const runtime = new ExperienceIntakeRuntime(release, requestPort);
  await runtime.prepare(); assert.equal(calls.length, 0);
  runtime.change("direction", direction); await runtime.prepare();
  assert.equal(runtime.state.phase, "review"); await runtime.submit();
  assert.equal(runtime.state.phase, "complete"); assert.equal(runtime.receipt.generation, "unavailable");
  const resumed = new ExperienceIntakeRuntime(release, requestPort); await resumed.resume(plan.draftId);
  assert.equal(resumed.state.phase, "complete");
  assert.equal(resumed.documentRoute, runtime.documentRoute);
  assert.deepEqual(calls.map(([, method]) => method), ["POST", "POST", "GET", "GET"]);
  assert.ok(calls.every(([path]) => !path.includes("/output") && !path.includes("/document-jobs")));
  runtime.dispose(); resumed.dispose();
});
