import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents, generationHistoryItems, generationHistoryMix } from "../src/model/events.ts";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

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
  assert.match(method,/baseRequestKey/);assert.match(method,/\$\{baseRequestKey\}:managed/);assert.match(method,/productionMode/);assert.match(method,/job\.productionMode\?\?"manual"/);assert.match(method,/generationRiskAcknowledged\(requestKey\)/);
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
  assert.match(shared,/const approvedFan=result\.outputs\.flatMap/);
  assert.match(shared,/\/api\/shared\/\$\{encodeURIComponent\(this\.token\)\}\/media\//);
  assert.match(shared,/shared-image-dialog/);
  assert.match(shared,/#navigateImage\(event\.key===previous\?-1:1\)/);
  assert.match(shared,/this\.matches\(":dir\(rtl\)"\)\?"ArrowRight":"ArrowLeft"/);
  assert.match(shared,/this\.#returnFocus\?\.focus\(\)/);
  assert.doesNotMatch(shared,/output-visual|state\/store|this\.store|ObjectViewed/);
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

// Source/model contracts only. This synthetic partition is not the production
// Document, a browser rendering, private-source proof or a generation request.
test("E image history does not describe six existing artifact results as no generations", async () => {
  const kinds = ["slides", "short_story", "audio", "slides", "short_story", "audio"];
  const artifactEvents = [...events.slice(0, 2), ...kinds.map((kind, index) => event(index + 3,
    "DocumentRenderCompleted", { document_id: "d", artifact_id: "image-history-artifact-" + index,
      artifact_kind: kind, title: "Synthetic retained result " + index, item_count: 1,
      items: [{ id: "image-history-part-" + index, title: "Retained part", body: "Source-only fixture text" }] }))];
  const artifactOnly = foldEvents(artifactEvents);
  assert.equal(artifactOnly.artifacts.length, 6); assert.equal(new Set(artifactOnly.artifacts.map(item => item.kind)).size, 3);
  assert.deepEqual(generationHistoryMix(artifactOnly.outputs), { total: 0, drafts: 0, full: 0 });
  const mixed = foldEvents([...artifactEvents, ...events.slice(2).map((entry, index) =>
    event(artifactEvents.length + index + 1, entry.type, entry.payload, entry.actor))]);
  assert.deepEqual(mixed.artifacts, artifactOnly.artifacts, "Image/fan history never absorbs or removes separate artifact results");
  assert.deepEqual(generationHistoryMix(mixed.outputs), { total: 3, drafts: 0, full: 3 });
  const empty = foldEvents(events.slice(0, 2));
  assert.equal(empty.artifacts.length, 0); assert.deepEqual(generationHistoryItems(empty.outputs), []);
  const source = await readFile(new URL("../src/components/document-generations.ts", import.meta.url), "utf8");
  assert.match(source, /const allOutputs = this\.store\.projection\.get\(\)\.outputs;/);
  assert.match(source, /const mix = generationHistoryMix\(allOutputs\);/);
  const start = source.indexOf('    return html`<forma-document-artifacts source=${this.view}>');
  assert.ok(start >= 0, "The actual full renderer still renders separate Creative results first");
  const full = source.slice(start);
  assert.ok(full.includes('aria-label=${this.i18n.t("generation.history.imageLabel")}'));
  assert.ok(full.includes('<span class="eyebrow">${this.i18n.t("generation.history.imageLabel")}</span>'));
  assert.ok(full.includes(': this.i18n.t("generation.history.imageEmpty")}</h2>'));
  assert.doesNotMatch(full, /The document has no generations yet/);
});

test("E image-history scope and empty copy are explicit in the existing four locale catalogs", async () => {
  const cases = [
    ["../src/components/design-system/localization.ts", "Image generation history", "No image generations in this history"],
    ["../src/components/design-system/locales/fr.ts", "Historique des générations d’images", "Aucune génération d’images dans cet historique"],
    ["../src/components/design-system/locales/ar.ts", "سجل توليد الصور", "لا توجد عمليات توليد صور في هذا السجل"],
    ["../src/components/design-system/locales/ja.ts", "画像生成の履歴", "この履歴には画像生成の記録がありません"],
  ];
  for (const [path, label, empty] of cases) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    for (const [key, value] of [["generation.history.imageLabel", label], ["generation.history.imageEmpty", empty]])
      assert.ok(source.includes(JSON.stringify(key) + ": " + JSON.stringify(value) + ","), path + " contains the exact scoped " + key);
  }
});

// Source/template contracts and an isolated status expression; no DOM paint claim.
test("prompt-fan comparison keeps one content body between persistent close and actions", async () => {
  const source = await readFile(new URL("../src/components/prompt-fan-review.ts", import.meta.url), "utf8");
  // Derive parent ownership from literal container tags; conditional Lit branches
  // remain source contracts, not an instantiated DOM or a visibility witness.
  const nodes = [], stack = [];
  for (const match of source.matchAll(/<(\/?)(section|div|header|form|footer|p|button)\b([^>]*)>/g)) {
    const [, closing, tag, attributes] = match;
    if (closing) {
      const node = stack.pop();
      assert.equal(node?.tag, tag, "Balanced source container: " + tag);
      node.end = match.index + match[0].length;
    } else {
      const node = { tag, attributes, start: match.index, parent: stack.at(-1) ?? null };
      nodes.push(node); stack.push(node);
    }
  }
  assert.equal(stack.length, 0);
  const hasClass = (node, name) => (node.attributes.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) ?? []).includes(name);
  const one = predicate => { const values = nodes.filter(predicate); assert.equal(values.length, 1); return values[0]; };
  const card = one(node => node.tag === "section" && hasClass(node, "prompt-fan-card"));
  const bodyNode = one(node => hasClass(node, "prompt-fan-scroll-body"));
  const closeNode = one(node => hasClass(node, "modal-close"));
  const footerNode = one(node => node.parent === card && node.tag === "footer");
  const summaryNode = one(node => hasClass(node, "prompt-fan-summary"));
  assert.equal(bodyNode.parent, card); assert.equal(closeNode.parent, card);
  assert.equal(summaryNode.parent, bodyNode);
  assert.ok(closeNode.start < bodyNode.start && bodyNode.end < footerNode.start);
  const content = [
    one(node => node.parent === bodyNode && node.tag === "header"),
    one(node => node.parent === bodyNode && hasClass(node, "prompt-fan-preference-bar")),
    one(node => node.parent === bodyNode && hasClass(node, "prompt-fan-grid")),
    summaryNode,
  ];
  assert.ok(content.every((node, index) => index === 0 || node.start > content[index - 1].end));
  const close = source.slice(closeNode.start, closeNode.end);
  const body = source.slice(bodyNode.start, bodyNode.end);
  const actions = source.slice(footerNode.start, footerNode.end);
  assert.match(close, /aria-label="Close prompt fan comparison"/);
  assert.match(close, /@click=\$\{this\.#close\}/);
  assert.match(source, /aria-labelledby="prompt-fan-title"/);
  assert.match(body, /<h2 id="prompt-fan-title">One generation, four ways to hand off the plan<\/h2>/);
  assert.match(body, /All four images share one document state and one fan identity\./);
  assert.match(body, /!context\?html`<form class="prompt-fan-preference-bar"/);
  assert.match(body, /class="prompt-fan-grid">\$\{PROMPT_TECHNIQUE_DEFINITIONS\.map/);
  assert.match(body, /promotePromptFanOutputs[\s\S]*preferPromptTechnique[\s\S]*#useAsInput[\s\S]*this\.i18n\.system\("Inspect inputs"\)/);
  assert.equal(one(node => node.parent === footerNode && node.tag === "div").parent, footerNode);
  assert.equal((actions.match(/<button\b/g) ?? []).length, 2);
  assert.match(actions, /!context\?html`<button class="button primary" \?disabled=\$\{!promotable\.length\}/);
  assert.match(actions, /promotePromptFanOutputs\(fanId, promotable\.map\(\(output\) => output\.id\)\)/);
  assert.match(actions, /this\.i18n\.system\("Promote all \{count\}", \{ count: this\.i18n\.number\(promotable\.length\) \}\)/);
  assert.match(actions, /<button class="button secondary" @click=\$\{this\.#close\}>Done<\/button>/);
  assert.doesNotMatch(actions, /prompt-fan-summary|<p>|prompt-fan-grid/);
});

test("prompt-fan scrolling summary retains completion, promotion and failure state copy", async () => {
  const source = await readFile(new URL("../src/components/prompt-fan-review.ts", import.meta.url), "utf8");
  const slots = [...source.matchAll(/<p class="prompt-fan-summary">\$\{([\s\S]*?)\}<\/p>/g)];
  assert.equal(slots.length, 1, "One unchanged state expression remains after the comparison grid");
  const i18n = {
    number: value => String(value),
    system: (text, values) => text.replace(/\{([^}]+)\}/g, (_, key) => String(values[key])),
  };
  const history = "The complete fan remains one comparison in history.";
  const failures = "Failures are terminal and remain part of this comparison receipt.";
  const cases = [
    { complete: 4, failed: 0, standalone: 0, count: 4, expected: "No images promoted. " + history },
    { complete: 4, failed: 0, standalone: 1, count: 4, expected: "1 image promoted. " + history },
    { complete: 4, failed: 0, standalone: 2, count: 4, expected: "2 images promoted. " + history },
    { complete: 4, failed: 3, standalone: 0, count: 1, expected: "1 image ready and 3 failed. " + failures },
    { complete: 4, failed: 2, standalone: 0, count: 2, expected: "2 images ready and 2 failed. " + failures },
    { complete: 4, failed: 4, standalone: 0, count: 0, expected: "0 images ready and 4 failed. " + failures },
    { complete: 2, failed: 1, standalone: 0, count: 1, expected: "2 of 4 prompt processes finished. Remaining jobs continue if this dialog or page closes." },
  ];
  for (const { count, expected, ...state } of cases) {
    const actual = runInNewContext("(" + slots[0][1] + ")", {
      ...state, fanOutputs: Array.from({ length: count }, () => ({})), i18n,
    }, { timeout: 1000 });
    assert.equal(actual, expected, JSON.stringify(state));
  }
});
