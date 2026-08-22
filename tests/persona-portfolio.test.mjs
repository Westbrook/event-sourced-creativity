import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderVideoReel } from "../src/components/video-reel.ts";
import { creatorProductionSummary } from "../src/model/production-summary.ts";
import { APPLICATIONS, applicationAccessible, resolveServerRoute } from "../src/platform/applications.ts";
import { CanvasOfflineQueue, canvasBatchBelongsToScope } from "../src/sync/canvas-offline-queue.ts";

const scopeA = { ownerId: "creator-a", projectId: "project-a" };
const scopeB = { ownerId: "creator-b", projectId: "project-b" };
const eventFor = (scope, action = "action-1") => ({ type: "CanvasItemPlaced", payload: { project_id: scope.projectId, history_owner_id: scope.ownerId, history_action_id: action, item_id: action } });

function indexedDbFixture() {
  const values = new Map();
  let created = false;
  const database = {
    objectStoreNames: { contains: () => created },
    createObjectStore() { created = true; },
    close() {},
    transaction() {
      const transaction = {};
      const request = (operation) => {
        const pending = {};
        queueMicrotask(() => {
          try {
            pending.result = operation();
            pending.onsuccess?.({ target: pending });
            queueMicrotask(() => transaction.oncomplete?.());
          } catch (error) {
            pending.error = error;
            pending.onerror?.({ target: pending });
            transaction.onerror?.({ target: transaction });
          }
        });
        return pending;
      };
      transaction.objectStore = () => ({
        getAll: () => request(() => [...values.values()].map((value) => structuredClone(value))),
        get: (id) => request(() => structuredClone(values.get(id))),
        put: (value) => request(() => { values.set(value.id, structuredClone(value)); return value.id; }),
        delete: (id) => request(() => { values.delete(id); }),
      });
      return transaction;
    },
  };
  return {
    values,
    indexedDB: {
      open() {
        const request = { result: database };
        queueMicrotask(() => {
          if (!created) request.onupgradeneeded?.({ target: request });
          request.onsuccess?.({ target: request });
        });
        return request;
      },
    },
  };
}

test("creator and internal application entitlements use one explicit audience contract", () => {
  assert.deepEqual(APPLICATIONS.filter((application) => application.administratorOnly).map(({ id }) => id), ["operations", "laboratory"]);
  assert.equal(applicationAccessible("creative", { role: "creator" }), true);
  assert.equal(applicationAccessible("canvas", { role: "creator", canvasAccess: false }), false);
  assert.equal(applicationAccessible("canvas", { role: "creator", canvasAccess: true }), true);
  assert.equal(applicationAccessible("operations", { role: "creator" }), false);
  assert.equal(applicationAccessible("laboratory", { role: "creator" }), false);
  assert.equal(applicationAccessible("operations", { role: "creator", principalRole: "admin" }), true);
  assert.equal(applicationAccessible("operations", { role: null, principalRole: "admin" }), false);
  assert.deepEqual(resolveServerRoute("/settings"), { application: "creative", entryPath: "/settings/", canonicalFamily: "/settings" });
});

test("Canvas device custody accepts only the effective owner and project, including provable legacy work", () => {
  const eventsA = [eventFor(scopeA)];
  const ownerBound = { id: "owned", ownerId: scopeA.ownerId, projectId: scopeA.projectId, events: eventsA, createdAt: "2026-08-22T12:00:00.000Z", actionSequence: 1, bytes: 100 };
  const attributableLegacy = { id: "legacy", events: eventsA, createdAt: "2026-08-22T12:00:00.000Z", actionSequence: 2, bytes: 100 };
  const ambiguousLegacy = { ...attributableLegacy, id: "ambiguous", events: [{ type: "CanvasItemPlaced", payload: { project_id: scopeA.projectId } }] };
  const mixedLegacy = { ...attributableLegacy, id: "mixed", events: [...eventsA, eventFor(scopeB)] };
  assert.equal(canvasBatchBelongsToScope(ownerBound, scopeA), true);
  assert.equal(canvasBatchBelongsToScope(ownerBound, scopeB), false);
  assert.equal(canvasBatchBelongsToScope(attributableLegacy, scopeA), true);
  assert.equal(canvasBatchBelongsToScope(attributableLegacy, scopeB), false);
  assert.equal(canvasBatchBelongsToScope(ambiguousLegacy, scopeA), false);
  assert.equal(canvasBatchBelongsToScope(mixedLegacy, scopeA), false);
  assert.equal(canvasBatchBelongsToScope({ ...ownerBound, events: [eventFor(scopeB)] }, scopeA), false);
  assert.equal(canvasBatchBelongsToScope(ownerBound, { ...scopeA, projectId: "" }), false);
});

test("one device never lists, counts, removes, or replays a different account's queued Canvas batches", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const fixture = indexedDbFixture();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: fixture.indexedDB });
  try {
    const queue = new CanvasOfflineQueue();
    await queue.enqueueBatch([eventFor(scopeA, "account-a-change")], scopeA);
    await queue.enqueueBatch([eventFor(scopeB, "account-b-change")], scopeB);
    fixture.values.set("unattributed", { id: "unattributed", events: [{ type: "CanvasItemPlaced", payload: { project_id: scopeA.projectId } }], createdAt: "2026-08-22T12:00:00.000Z", actionSequence: 0, bytes: 50 });

    assert.deepEqual((await queue.listBatches(scopeA)).map(({ id }) => id), ["account-a-change"]);
    assert.deepEqual((await queue.listBatches(scopeB)).map(({ id }) => id), ["account-b-change"]);
    assert.equal((await queue.summary(scopeA)).count, 1);
    await queue.removeBatch("account-b-change", scopeA);
    assert.equal(fixture.values.has("account-b-change"), true);
    await queue.removeBatch("account-a-change", scopeA);
    assert.equal(fixture.values.has("account-a-change"), false);
    assert.equal(fixture.values.has("account-b-change"), true);
    assert.equal(fixture.values.has("unattributed"), true);
    await assert.rejects(queue.enqueueBatch([eventFor(scopeB)], scopeA), /active account and project/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else delete globalThis.indexedDB;
  }
});

test("video-scene announcements use a Lit property binding that remains safe across later rerenders", () => {
  const result = renderVideoReel([
    { id: "one", title: "Opening", mediaUrl: "/one.mp4", mediaType: "video/mp4" },
    { id: "two", title: "Resolution", mediaUrl: "/two.mp4", mediaType: "video/mp4" },
  ]);
  const scenes = result.values.find((value) => value && typeof value === "object" && Array.isArray(value.strings));
  const markup = scenes.strings.join("EXPRESSION");
  assert.match(markup, /data-scene-status \.textContent=EXPRESSION><\/p>/);
  assert.doesNotMatch(markup, /data-scene-status>EXPRESSION/);

  const status = { textContent: "Scene 1 of 2: Opening" };
  const player = { dataset: { sceneIndex: "0" }, src: "/one.mp4", paused: true, setAttribute(name, value) { this[name] = value; } };
  const picker = { value: "1" };
  const root = { querySelector(selector) { return selector.includes("select") ? picker : selector.includes("data-scene-status") ? status : player; } };
  player.closest = () => root;
  picker.closest = () => root;
  const onChange = scenes.values.find((value) => typeof value === "function");
  onChange({ currentTarget: picker });
  assert.equal(status.textContent, "Scene 2 of 2: Resolution");
  assert.equal(player.src, "/two.mp4");
  assert.equal(player["aria-label"], "Scene 2 of 2: Resolution");
});

test("creator production reporting distinguishes actual charges from reservations and uninspected media", () => {
  const artifact = {
    id: "artifact-1", documentId: "document-1", kind: "video", itemCount: 2,
    settings: {
      production_mode: "managed",
      production_team: { label: "Film production team", specialists: [{ label: "Director" }, { label: "Editor" }] },
      production_evidence: { basis: "provider-video-receipt", measured_weight: .33, fully_evaluated: false, media_inspected: false },
      video_audio_mode: "original_ambient",
    },
  };
  const events = [
    { type: "DocumentRenderRequested", payload: { artifact_id: artifact.id, estimated_cost_microusd: 10_000_000 } },
    { type: "BudgetReserved", payload: { artifact_id: artifact.id, reserved_microusd: 10_000_000 } },
    { type: "GenerationUsageRecorded", payload: { artifact_id: artifact.id, cost_microusd: 9_147_110 } },
    { type: "GenerationUsageRecorded", payload: { artifact_id: "other-artifact", cost_microusd: 100_000_000 } },
  ];
  assert.deepEqual(creatorProductionSummary(artifact, events), {
    mode: "managed", teamLabel: "Film production team", specialists: ["Director", "Editor"], itemCount: 2,
    estimatedMicrousd: 10_000_000, reservedMicrousd: 10_000_000, actualMicrousd: 9_147_110,
    evidenceBasis: "provider-video-receipt", measuredWeight: .33, fullyEvaluated: false,
    mediaInspected: false, delivery: "scene-reel", audioMode: "original_ambient",
  });
});

test("creator privacy, managed evidence, and Canvas reading order remain outside administrator-only paths", async () => {
  const [shell, settings, artifacts, canvas, worker, config] = await Promise.all([
    "../src/components/forma-shell.ts", "../src/components/forma-account-settings.ts", "../src/components/document-artifacts.ts",
    "../src/canvas/canvas-application.ts", "../worker/index.ts", "../vite.config.ts",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  assert.match(shell, /applicationAccessible/);
  assert.match(shell, /this\.#route\("\/settings"\)/);
  assert.doesNotMatch(shell, /\/operations#governance/);
  assert.match(settings, /forgetAttentionSignals/);
  assert.match(settings, /revokeShare/);
  assert.match(settings, /costBudgets\?\.user/);
  assert.match(artifacts, /creatorProductionSummary/);
  assert.match(artifacts, /Visual quality and continuity were not inspected/);
  assert.match(artifacts, /combined MP4 is not available/);
  assert.doesNotMatch(canvas, /enoughToOrganize\?html`<button[^`]*>Reading order/);
  assert.doesNotMatch(canvas, /enoughToOrganize\?html`<button[^`]*>Accessible reading order/);
  assert.match(worker, /administratorOnly\)\{[\s\S]*?requireUser\(request,env,"admin"/);
  assert.match(worker, /directHtmlRoute&&applicationDefinition\(directHtmlRoute\.application\)\.administratorOnly/);
  assert.match(worker, /\/protected-assets\//);
  assert.match(config, /protected-assets/);
});
