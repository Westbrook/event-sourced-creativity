import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { documentGenerationRevision } from "../src/model/document-jobs.ts";
import { createSceneConfiguration, isSceneMedium } from "../src/model/scene-configuration.ts";
import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { captureDocumentRenderSettings } from "../src/model/document-render-request.ts";
import { readOutputAudioPayload } from "../worker/output-audio-execution.ts";

const jobsApiSource = await readFile(new URL("../worker/document-jobs-api.ts", import.meta.url), "utf8");

function sourceFunction(name) {
  const start = jobsApiSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must remain available to job admission`);
  const end = jobsApiSource.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${name} must have a complete implementation`);
  return jobsApiSource.slice(start, end + 2);
}

function requestIdempotencyKey() {
  const helpers = stripTypeScriptTypes([
    sourceFunction("sceneConfigurationFromRequest"),
    sourceFunction("renderRequestIdempotencyKey"),
  ].join("\n"));
  return new Function(
    "createSceneConfiguration",
    "isSceneMedium",
    "documentGenerationRevision",
    "generationRevisionFromRequest",
    "productionWorkflowSourceIdentity",
    `${helpers}\nreturn renderRequestIdempotencyKey;`,
  )(
    createSceneConfiguration,
    isSceneMedium,
    documentGenerationRevision,
    (request) => String(request.documentRevision ?? "document-revision"),
    (sources) => sources,
  );
}

test("scene render admission separates visual and audio variants without changing unrelated artifact identities", () => {
  const idempotencyKey = requestIdempotencyKey();
  const shared = {
    artifactKind: "scene",
    documentRevision: "document-revision",
    requestKey: "render:scene:shared-context",
    snapshot: { facts: [{ block_id: "source-1", text: "rain on the roof" }] },
  };
  const visual = { ...shared, sceneMedium: "visual", sceneConfiguration: createSceneConfiguration("visual") };
  const audio = { ...shared, sceneMedium: "audio", sceneConfiguration: createSceneConfiguration("audio") };

  assert.notEqual(idempotencyKey(visual, "doc-1"), idempotencyKey(audio, "doc-1"));
  assert.equal(idempotencyKey(shared, "doc-1"), idempotencyKey(visual, "doc-1"), "legacy scenes remain equivalent to the visual default");

  const audioPath = {
    ...audio,
    sceneConfiguration: createSceneConfiguration("audio", {
      source: "production-path",
      targetFormat: "audio",
      downstreamFormats: ["audio"],
    }),
  };
  const alternatePath = {
    ...audio,
    sceneConfiguration: createSceneConfiguration("audio", {
      source: "production-path",
      targetFormat: "video",
      downstreamFormats: ["video"],
    }),
  };
  assert.notEqual(idempotencyKey(audioPath, "doc-1"), idempotencyKey(alternatePath, "doc-1"), "different downstream goals must retain separate identities");

  const unrelated = { ...shared, artifactKind: "short_story" };
  assert.equal(
    idempotencyKey({ ...unrelated, sceneMedium: "visual" }, "doc-1"),
    idempotencyKey({ ...unrelated, sceneMedium: "audio" }, "doc-1"),
    "scene-only settings cannot change non-scene deduplication",
  );
});

test("personal and project job summaries preserve canonical scene configuration as a JSON object", () => {
  assert.match(jobsApiSource, /'sceneConfiguration',json\(json_extract\(job\.request_json,'\$\.sceneConfiguration'\)\)/);
  assert.match(jobsApiSource, /'sceneConfiguration',json\(json_extract\(request_json,'\$\.sceneConfiguration'\)\)/);

  const configuration = createSceneConfiguration("audio", {
    source: "production-path",
    targetFormat: "audio",
    downstreamFormats: ["audio"],
  });
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE document_jobs (request_json TEXT NOT NULL)");
  sqlite.prepare("INSERT INTO document_jobs VALUES (?)").run(JSON.stringify({
    artifactKind: "scene",
    sceneMedium: "audio",
    sceneConfiguration: configuration,
  }));
  const compact = sqlite.prepare(
    "SELECT json_object('artifactKind',json_extract(request_json,'$.artifactKind'),'sceneMedium',json_extract(request_json,'$.sceneMedium'),'sceneConfiguration',json(json_extract(request_json,'$.sceneConfiguration'))) AS request_json FROM document_jobs",
  ).get();

  assert.deepEqual(JSON.parse(compact.request_json), {
    artifactKind: "scene",
    sceneMedium: "audio",
    sceneConfiguration: configuration,
  });
});

test("workflow scene admission overwrites client medium and records private continuity metadata", () => {
  assert.match(jobsApiSource, /payload\.sceneMedium=resolved\.sceneConfiguration\.medium;/);
  assert.match(jobsApiSource, /payload\.sceneConfiguration=resolved\.sceneConfiguration;/);
  assert.match(jobsApiSource, /error:"scene_medium_invalid"/);
  assert.match(jobsApiSource, /createSceneConfiguration\(isSceneMedium\(payload\.sceneMedium\)\?payload\.sceneMedium:"visual"\)/);
  assert.match(jobsApiSource, /source_snapshot_sha256:effectiveSnapshot\?await sourceSnapshotSha256\(effectiveSnapshot\):sourceHash/);
  assert.match(jobsApiSource, /authored_snapshot_sha256:sourceHash/);
  assert.match(jobsApiSource, /alternate_medium:sceneConfiguration\.alternateMedium/);
  assert.ok(
    (jobsApiSource.match(/scene_medium:sceneConfiguration\.medium,scene_configuration:sceneConfiguration,context_continuity:sceneContext/g) ?? []).length >= 3,
    "request settings, the private receipt, and the generation receipt must preserve the exact configuration and context lineage",
  );
});

function receiptBuilder(privateReceipts) {
  const helpers = stripTypeScriptTypes([
    sourceFunction("sceneConfigurationFromRequest"),
    sourceFunction("generationRevisionFromRequest"),
    `async ${sourceFunction("sourceSnapshotSha256")}`,
    `async ${sourceFunction("acceptedGenerationReceipt")}`,
  ].join("\n"));
  return new Function(
    "createSceneConfiguration", "isSceneMedium", "documentGenerationRevision", "readOutputAudioPayload", "captureDocumentRenderSettings", "storePrivateContent",
    `${helpers}\nreturn acceptedGenerationReceipt;`,
  )(
    createSceneConfiguration, isSceneMedium, documentGenerationRevision, readOutputAudioPayload, captureDocumentRenderSettings,
    async (_env, ownerId, kind, content) => {
      privateReceipts.push({ ownerId, kind, value: JSON.parse(content) });
      return { contentId: `private-scene-receipt-${privateReceipts.length}`, expiresAt: "2099-01-01T00:00:00Z" };
    },
  );
}

test("new Scene receipts report the existing complete application cap and exact manual or managed call limits", async () => {
  const privateReceipts = [];
  const receipt = receiptBuilder(privateReceipts);
  const snapshot = { facts: [{ block_id: "PRIVATE_TEST_SCENE_SOURCE", type: "direction", properties: { text: "The keeper hears a harbor bell." } }] };
  for (const medium of ["visual", "audio"]) {
    for (const count of [null, 1, 8, 9, 17]) {
      const production = count === null ? null : buildManagedProductionPlan("scene", snapshot, { requestedItemCount: count, sceneMedium: medium });
      const batches = count === null ? 1 : Math.ceil(count / 8);
      const ceiling = batches * 1_000_000;
      const result = await receipt(
        { OPENAI_MODEL: "configured-scene-text-model" }, { userId: "authorized-test-actor" },
        { artifactKind: "scene", sceneMedium: medium, snapshot, productionMode: production ? "managed" : "manual", documentRevision: "scene-test-revision" },
        "scene-test-document", `scene-test-${medium}-${count}`, ceiling, production,
      );
      assert.equal(result.provider, "openai");
      assert.equal(result.model, "configured-scene-text-model");
      assert.equal(result.reservation_is_application_hard_cap, true);
      assert.equal(result.reservation_is_provider_hard_cap, false);
      assert.equal(result.maximum_authorized_cost_microusd, ceiling);
      assert.equal(result.reservation_microusd, ceiling);
      assert.equal(result.planned_provider_call_count, batches);
      assert.equal(result.maximum_provider_call_count, production ? batches * 4 : 2);
      assert.equal(result.max_repair_call_count, production ? batches * 3 : 1);
      assert.equal(result.provider_request_status, "not_submitted");
      assert.equal(result.source_transmission_status, "not_transmitted");
      assert.equal(result.settled_cost_microusd, 0);
      assert.equal(result.scene_medium, medium);
      const captured = privateReceipts.at(-1);
      assert.equal(captured.ownerId, "authorized-test-actor");
      assert.equal(captured.kind, "document-artifact-input");
      assert.equal(captured.value.accounting.reservation_is_application_hard_cap, true);
      assert.equal(captured.value.accounting.maximum_authorized_cost_microusd, ceiling);
      assert.deepEqual(captured.value.document_snapshot, snapshot);
    }
  }
});

test("the Scene receipt correction does not claim a complete application cap for downstream storyboard media", async () => {
  const result = await receiptBuilder([])(
    { OPENAI_MODEL: "configured-text-model" }, { userId: "authorized-test-actor" },
    { artifactKind: "storyboard", snapshot: {}, productionMode: "manual" },
    "test-document", "test-storyboard", 7_000_000, null,
  );
  assert.equal(result.reservation_is_application_hard_cap, false);
  assert.equal(result.maximum_authorized_cost_microusd, undefined);
});
