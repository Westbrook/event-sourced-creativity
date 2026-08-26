import assert from "node:assert/strict";
import test from "node:test";
import { compileAssistantContext, ASSISTANT_CONTEXT_LIMITS, ASSISTANT_OUTPUT_KINDS } from "../src/model/conversation-context.ts";
import { foldEvents } from "../src/model/events.ts";
import { deriveIntentTrajectories } from "../src/model/intent-trajectories.ts";

function event(sequence, type, payload = {}, actor = "user") {
  return { eventId: `event-${sequence}`, streamId: "creative:owner", sequence, occurredAt: "2026-01-01T00:00:00.000Z", recordedAt: "2026-01-01T00:00:00.000Z", actor, clientId: "test", correlationId: `correlation-${sequence}`, causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload };
}

function fixture() {
  const events = [
    event(1, "ProjectCreated", { project_id: "project-a", name: "Launch project" }),
    event(2, "DocumentCreated", { project_id: "project-a", document_id: "document-a", title: "Launch direction" }),
    event(3, "BlockCreated", { project_id: "project-a", document_id: "document-a", block_id: "direction-a", type: "direction", handle: "Direction", position: "a0", properties: { text: "Launch a greenhouse" } }),
    event(4, "BlockCreated", { project_id: "project-a", document_id: "document-a", block_id: "audio-a", type: "audio", handle: "Soundtrack", position: "a1", properties: { text: "Warm analog soundtrack", media_url: "https://private.example/secret.wav", allow_provider_audio_transfer: true } }),
    event(5, "BlockCreated", { project_id: "project-a", document_id: "document-a", block_id: "boundary-a", type: "exclusion", handle: "Never use flames", position: "a2", properties: { text: "No fire", intent: "prohibit" } }),
  ];
  return { events, projection: foldEvents(events, Number.POSITIVE_INFINITY, "document-a") };
}

test("prioritizes exact current document, hard boundaries, and atomic audio without leaking media", () => {
  const { events, projection } = fixture();
  const context = compileAssistantContext({ route: "/document/document-a/launch", events, projection, actorUserId: "owner" });
  assert.equal(context.scope.documentId, "document-a");
  assert.equal(context.documentTitle, "Launch direction");
  assert.equal(context.decisionAtoms[0].id, "boundary-a");
  assert.ok(context.decisionAtoms.some((item) => item.type === "audio"));
  assert.ok(context.availableOutputKinds.includes("audio"));
  assert.equal(JSON.stringify(context).includes("secret.wav"), false);
  assert.equal(JSON.stringify(context).includes("allow_provider_audio_transfer"), false);
});

test("never uses a stale selected document on a projects or activity page", () => {
  const { events, projection } = fixture();
  for (const route of ["/projects", "/activity", "/deliver"]) {
    const context = compileAssistantContext({ route, events, projection, actorUserId: "owner" });
    assert.equal(context.scope.documentId, null, route);
    assert.equal(context.documentTitle, null, route);
    assert.deepEqual(context.decisionAtoms, [], route);
  }
});

test("bounds long histories and includes only current actor private chat references", () => {
  const { events, projection } = fixture();
  const actorContent = {};
  for (let index = 0; index < 100; index += 1) {
    const ownerRef = `owner-${index}`;
    const strangerRef = `stranger-${index}`;
    actorContent[ownerRef] = `OWN-${index}`;
    actorContent[strangerRef] = `FOREIGN-${index}`;
    events.push(event(10 + index * 2, "ChatMessageSent", { project_id: "project-a", document_id: "document-a", content_ref: ownerRef }, "user:owner"));
    events.push(event(11 + index * 2, "ChatMessageSent", { project_id: "project-a", document_id: "document-a", content_ref: strangerRef }, "user:another"));
  }
  const context = compileAssistantContext({ route: "/document/document-a", events, projection, actorUserId: "owner", actorContent });
  assert.equal(context.recentTurns.length, ASSISTANT_CONTEXT_LIMITS.turns);
  assert.equal(context.recentTurns.at(-1).text, "OWN-99");
  assert.equal(JSON.stringify(context).includes("FOREIGN-"), false);
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength <= ASSISTANT_CONTEXT_LIMITS.maxBytes);
});

test("only includes explicit authorized selection from the current canvas", () => {
  const { events, projection } = fixture();
  const canvasProjection = { projectId: "project-a", selectedCanvasId: "canvas-a", canvases: [], items: [
    { id: "selected", canvasId: "canvas-a", projectId: "project-a", sourceKind: "document", sourceId: "document-a", title: "Actual selection", visible: true, removed: false },
    { id: "foreign", canvasId: "canvas-b", projectId: "project-a", sourceKind: "document", sourceId: "document-b", title: "Foreign board", visible: true, removed: false },
  ], arrangements: [], contextSets: [], proposals: [], memberships: [] };
  const context = compileAssistantContext({ route: "/canvas/canvas-a/launch", events, projection, actorUserId: "owner", canvasProjection, selectedItemIds: ["selected", "foreign"] });
  assert.deepEqual(context.selectedItems.map((item) => item.title), ["Actual selection"]);
  assert.equal(context.scope.documentId, null);
});

test("caps attacker-controlled routes and always enforces the serialized context ceiling", () => {
  const { events, projection } = fixture();
  const context = compileAssistantContext({ route: `/document/document-a?search=${"x".repeat(40_000)}#context=${"y".repeat(20_000)}`, events, projection, actorUserId: "owner" });
  assert.ok(context.surface.route.length <= 768);
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength <= ASSISTANT_CONTEXT_LIMITS.maxBytes);
  assert.equal(context.surface.focusedBlockId, null);
  assert.ok(context.decisionAtoms.some((atom) => atom.type === "exclusion"));
});

test("counts authorized images alongside all existing document-output formats", () => {
  const { events, projection } = fixture();
  const image = { id: "image-a", documentId: "document-a", variant: 1, sequence: 9, discarded: false };
  projection.outputs.push(image);
  projection.libraryOutputs.push(image);
  const document = compileAssistantContext({ route: "/document/document-a", events, projection, actorUserId: "owner" });
  const delivery = compileAssistantContext({ route: "/deliver", events, projection, actorUserId: "owner" });
  assert.equal(document.availableOutputs.find((output) => output.kind === "image")?.id, "image-a");
  assert.equal(delivery.availableOutputs.find((output) => output.kind === "image")?.id, "image-a");
});

test("never exposes output titles whose source document is absent or belongs to another project", () => {
  const { events, projection } = fixture();
  projection.libraryArtifacts.push({ id: "foreign-artifact", documentId: "foreign-document", kind: "slides", title: "CONFIDENTIAL OTHER PROJECT TITLE", sequence: 99 });
  projection.libraryOutputs.push({ id: "foreign-image", documentId: "foreign-document", variant: 1, sequence: 100, discarded: false });
  const context = compileAssistantContext({ route: "/deliver", events, projection, actorUserId: "owner" });
  assert.equal(context.availableOutputs.length, 0);
  assert.doesNotMatch(JSON.stringify(context), /CONFIDENTIAL|foreign-image|foreign-artifact/u);
});

test("audio is an existing output kind with pending and ready event-derived guidance", () => {
  const scope = { project_id: "project-a", document_id: "document-a" };
  const requested = [event(1, "ProjectCreated", scope), event(2, "DocumentCreated", scope), event(3, "DocumentRenderRequested", { ...scope, artifact_id: "audio-a", artifact_kind: "audio" })];
  const pending = deriveIntentTrajectories(requested)[0];
  assert.equal(pending.expectedOutputKind, "audio");
  assert.match(pending.nextAction.label, /audio/i);
  const ready = deriveIntentTrajectories([...requested, event(4, "DocumentRenderCompleted", { ...scope, artifact_id: "audio-a", artifact_kind: "audio" }, "worker:renderer")])[0];
  assert.equal(ready.expectedOutputKind, "audio");
  assert.equal(ASSISTANT_OUTPUT_KINDS.length, 7);
});
