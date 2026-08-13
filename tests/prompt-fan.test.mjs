import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents, generationHistoryItems, generationHistoryMix } from "../src/model/events.ts";

const event = (sequence, type, payload, actor = "worker:generator") => ({
  eventId: `e${sequence}`, streamId: "s", sequence, occurredAt: new Date(sequence * 1000).toISOString(), recordedAt: new Date(sequence * 1000).toISOString(), actor, clientId: "test", correlationId: "c", causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload,
});

const events = [
  event(1, "ProjectCreated", { project_id: "p", name: "Project" }, "user"),
  event(2, "DocumentCreated", { project_id: "p", document_id: "d", title: "Study" }, "user"),
  event(3, "GenerationCompleted", { document_id: "d", generation_id: "regular", object_ids: ["regular-output"], quality: "high", purpose: "final" }),
  ...["prose", "bullets", "json", "xml"].map((technique, index) => event(4 + index, "GenerationCompleted", { document_id: "d", generation_id: `fan-${technique}`, object_ids: [`fan-${technique}`], quality: "high", purpose: "final", prompt_fan_id: "fan-1", prompt_technique: technique })),
  event(8, "PromptFanOutputPromoted", { object_id: "fan-json", prompt_fan_id: "fan-1", prompt_technique: "json", document_id: "d", project_id: "p" }, "user"),
];

test("projects one prompt fan until members are promoted to stand alone", () => {
  const grouped = foldEvents(events, 7);
  const groupedHistory = generationHistoryItems(grouped.outputs);
  assert.equal(grouped.outputs.length, 5);
  assert.equal(groupedHistory.length, 2);
  const fan = groupedHistory.find((item) => item.kind === "fan");
  assert.equal(fan?.complete, 4);
  assert.equal(fan?.standaloneCount, 0);
  assert.deepEqual(generationHistoryMix(grouped.outputs), { total: 2, drafts: 0, full: 2 });

  const promoted = foldEvents(events);
  const promotedHistory = generationHistoryItems(promoted.outputs);
  assert.equal(promotedHistory.length, 3);
  assert.equal(promoted.outputs.find((output) => output.id === "fan-json")?.standalone, true);
  assert.equal(promotedHistory.find((item) => item.kind === "fan")?.standaloneCount, 1);
  assert.ok(promotedHistory.some((item) => item.kind === "output" && item.id === "fan-json"));
});
