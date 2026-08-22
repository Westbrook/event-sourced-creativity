import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents, generationHistoryItems, generationHistoryMix } from "../src/model/events.ts";
import { readFile } from "node:fs/promises";

const event = (sequence, type, payload, actor = "worker:generator") => ({
  eventId: `e${sequence}`, streamId: "s", sequence, occurredAt: new Date(sequence * 1000).toISOString(), recordedAt: new Date(sequence * 1000).toISOString(), actor, clientId: "test", correlationId: "c", causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload,
});

test("fan generation is accepted once and retains explicit failed member states",async()=>{
  const store=await readFile(new URL("../src/state/store.ts",import.meta.url),"utf8");
  const api=await readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8");
  const review=await readFile(new URL("../src/components/prompt-fan-review.ts",import.meta.url),"utf8");
  const actions=await readFile(new URL("../src/components/generation-actions.ts",import.meta.url),"utf8");
  const method=store.slice(store.indexOf("async generatePromptFan"),store.indexOf("async preferPromptTechnique"));
  assert.equal((method.match(/#startDocumentJob\(/g)??[]).length,1);
  assert.match(method,/#startDocumentJob\("prompt_fan"/);
  assert.match(method,/baseRequestKey/);assert.match(method,/\$\{baseRequestKey\}:managed/);assert.match(method,/productionMode/);assert.match(method,/job\.productionMode\?\?"manual"/);assert.match(method,/generationRiskAcknowledged\(baseRequestKey\)/);
  assert.match(api,/'productionMode',json_extract\(request_json,'\$\.productionMode'\)/);assert.match(api,/const parentRequest = \{ fanKind, promptFanId, documentRevision, sourcePreviewId, productionMode/);assert.match(actions,/generatePromptFan\("preview",\{sourceSurface:this\.source,productionMode:this\.#productionMode\}\)/);assert.match(actions,/Team on/);
  assert.match(api,/childJobIds/);
  assert.match(api,/status === "partial"/);
  assert.match(api,/moderationPromptRef/);
  assert.match(review,/generationFailureGuidance/);
  assert.match(review,/failureGuidance\.title/);
  assert.match(review,/failureGuidance\.summary/);
  assert.match(review,/Review submitted prompt/);
  assert.match(actions,/Review submitted/);
  assert.match(review,/Copy prompt/);
  assert.match(actions,/Copy prompt/);
  assert.match(actions,/Copy receipt/);
  assert.match(review,/Prompt copied to the clipboard/);
  assert.match(actions,/Prompt copied to the clipboard/);
  assert.match(actions,/Technical receipt copied to the clipboard/);
  assert.match(actions,/private retention period has expired/);
  assert.match(actions,/Dismiss this generation issue/);
  assert.match(api,/path\.endsWith\("\/dismiss"\)/);
  assert.doesNotMatch(review,/Awaiting this result/);
});

test("keeps one image dialog open while keyboard navigation traverses a prompt fan",async()=>{
  const [visual,fanVisual,review,shared,sharesApi,scenarios,styles]=await Promise.all([
    readFile(new URL("../src/components/output-visual.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/prompt-fan-visual.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/prompt-fan-review.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-shared-view.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/shares-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/model/scenarios.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/styles.css",import.meta.url),"utf8"),
  ]);
  assert.match(visual,/event\.key!=="ArrowLeft"&&event\.key!=="ArrowRight"/);
  assert.match(visual,/const previous=this\.matches\(":dir\(rtl\)"\)\?"ArrowRight":"ArrowLeft"/);
  assert.match(visual,/#navigateFan\(event\.key===previous\?-1:1,"keyboard"\)/);
  assert.match(visual,/PROMPT_TECHNIQUES\.indexOf/);
  assert.match(visual,/type:"ComparisonOpened"/);
  assert.match(visual,/type:"ObjectViewed"/);
  assert.match(visual,/navigation_method:navigationMethod/);
  assert.match(visual,/forma-fan-image-navigated/);
  assert.match(visual,/Use the Left and Right Arrow keys/);
  assert.match(fanVisual,/\.fanOutputs=\$\{this\.outputs\}/);
  assert.match(review,/\.fanOutputs=\$\{fanOutputs\}/);
  assert.match(shared,/\.fanOutputs=\$\{projection\.outputs\}/);
  assert.match(shared,/\.readOnly=\$\{true\}/);
  assert.match(sharesApi,/promptFanId,promptTechnique/);
  assert.match(scenarios,/source_surface:"fan-image-dialog"/);
  assert.match(scenarios,/navigation_method:viewedOrdinal===0\?"trigger":"keyboard"/);
  assert.match(styles,/\.fan-image-navigation\.previous/);
  assert.match(styles,/\.fan-image-navigation\.next/);
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
