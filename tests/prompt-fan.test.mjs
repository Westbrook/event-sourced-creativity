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

// Append after the existing three source/model PromptFan tests. These additions
// use the same full Shell/Library/native Compare pattern as the existing native
// PromptFan continuation fixture; no private method or fake renderer is added.
import { createCalmFullPage as createTimingCalmPage, registerCalmFullPageComponents as registerTimingComponents,
  calmFullPageNativePorts as timingPorts } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative as installTimingNative } from "./helpers/output-navigation-focus-native.mjs";
import { appendAuditEvent as appendTimingAuditEvent } from "../worker/runtime.ts";
import { withDocumentInRoute as timingDocumentRoute } from "../src/model/routes.ts";

const fanTimingClass = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const fanTimingInside = (node, ancestor) => { for (let at = node; at; at = at.parent) if (at === ancestor) return true; return false; };
const fanTimingFinance = f => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"]
  .map(table => [table, f.storeHost.worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));

async function fanTimingPage(t, locale) {
  const f = await createTimingCalmPage(t, { locale }), h = f.storeHost, worker = h.worker;
  const initialCounts = worker.counts(), fanId = "retained-comparison-timing-" + locale;
  const members = [["prose", 1150, 1.2], ["bullets", 1200, 1.2], ["json", 1000, 1], ["xml", 13456, 13.5]]
    .map(([technique, latencyMs, seconds]) => ({ technique, latencyMs, seconds, id: fanId + "-" + technique, modelId: "fixture-" + technique }));
  for (const member of members) await appendTimingAuditEvent(worker.env, worker.streamId, "worker:generator", "GenerationCompleted", {
    project_id: worker.projectId, document_id: worker.documentId, object_ids: [member.id], generation_id: member.id + "-generation",
    title: "Retained " + member.technique + " comparison", prompt_fan_id: fanId, prompt_technique: member.technique,
    model_id: member.modelId, provider: "fixture", latency_ms: member.latencyMs, quality: "high", purpose: "final",
    media_url: "data:image/png;base64,AA==", media_type: "image/png", image_width: 1536, image_height: 1024,
  });
  // Re-read the real RAM Worker initialization, as the existing native fixture
  // does after Calm construction. No synthetic HTTP result/approval is supplied.
  await h.store.refreshEvents({ fromStart: true });
  await registerTimingComponents(f, ["forma-library", "forma-workspace"]);
  f.nativeHistoryLocation = h.location; f.native = installTimingNative(t, f, timingPorts);
  // The retained continuation parent supplies this native History port.
  // Standalone timing cases must retain that same location/cleanup boundary.
  const oldHistory = globalThis.history;
  globalThis.history = {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href }); },
    replaceState(...args) { this.pushState(...args); },
  };
  t.after(() => { if (oldHistory === undefined) delete globalThis.history; else globalThis.history = oldHistory; });
  h.store.setRoute(timingDocumentRoute("/", worker.documentId, h.store.projection.get().documentTitle));
  await f.settle();
  const click = async node => {
    assert.ok(node.port?.isConnected); assert.equal(node.hiddenBy, null); assert.equal(node.port.matches(":disabled"), false);
    f.native.emit("pointerdown", node.port); f.native.focus(node.port); await f.act(node, "click", { button: 0 });
  };
  await click(f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && new URL(node.attributes.href, "https://fixture.invalid").pathname === "/library"));
  const owners = f.components().filter(component => component.tag === "forma-prompt-fan-review" && component.fanId === fanId
    && component.isConnected && component.store === h.store && component.closest("forma-library")?.isConnected);
  assert.equal(owners.length, 1); const owner = owners[0]; assert.equal(owner.closest("forma-shell"), f.host);
  assert.equal(h.store.ui.instrumentation, false, "reuse the fixture's declared no-analytics mode, not an altered application method");
  const retained = h.store.projection.get().libraryOutputs.filter(output => output.promptFanId === fanId);
  assert.equal(retained.length, 4); assert.ok(retained.every(output => !output.promptRef), "no unloaded private prompt is requested by this fixture's Compare open");
  await click(f.find("button", node => node.owner === owner && fanTimingClass(node, "prompt-fan-review-trigger")));
  const dialogs = f.tree().visible("dialog").filter(node => node.owner === owner && fanTimingClass(node, "prompt-fan-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  return { f, owner, fanId, members, initialCounts,
    beforeEvents: structuredClone(h.store.events.get()), beforeContent: structuredClone(h.store.content.get()),
    beforeOutputs: structuredClone(h.store.projection.get().libraryOutputs), beforeFinance: fanTimingFinance(f), beforeRequests: h.requests.length };
}

for (const [locale, label] of [["en", "Latency"], ["fr", "Latence"], ["ar", "زمن الاستجابة"], ["ja", "レイテンシー"]]) {
  test("prompt fan labels each model's retained comparison latency " + locale, async t => {
    const x = await fanTimingPage(t, locale), { f, owner, members } = x, current = f.tree();
    assert.equal(f.i18n.system("Latency"), label); assert.equal(Boolean(f.store.session.get()?.projectContext), false);
    const options = current.visible("article").filter(node => node.owner === owner && fanTimingClass(node, "prompt-fan-option"));
    assert.equal(options.length, 4);
    const observed = [];
    for (const member of members) {
      const output = f.store.projection.get().libraryOutputs.find(value => value.id === member.id);
      assert.ok(output); assert.equal(output.modelId, member.modelId); assert.equal(output.latency, member.latencyMs);
      assert.equal(output.promptTechnique, member.technique); assert.equal(output.promptFanId, x.fanId);
      assert.equal(output.quality, "high"); assert.equal(output.standalone, false); assert.equal(output.discarded, false);
      const option = options.find(candidate => current.nodes.some(node => node.tag === "forma-output-visual"
        && fanTimingInside(node, candidate) && node.component?.output?.id === member.id));
      assert.ok(option, "the metadata belongs to this exact current retained image option");
      const visuals = current.nodes.filter(node => node.tag === "forma-output-visual" && fanTimingInside(node, option));
      assert.equal(visuals.length, 1); assert.equal(visuals[0].component.output.sourceEventId, output.sourceEventId);
      assert.equal(visuals[0].component.fanOutputs.length, 4); assert.equal(visuals[0].component.output.mediaUrl, output.mediaUrl);
      const footers = option.children.filter(node => typeof node !== "string" && node.tag === "footer"); assert.equal(footers.length, 1);
      const metadata = current.visible("small").filter(node => node.owner === owner && fanTimingInside(node, footers[0]));
      assert.equal(metadata.length, 1); assert.ok(metadata[0].text.startsWith(member.modelId + " · "));
      const quality = current.visible("b").filter(node => node.owner === owner && fanTimingInside(node, footers[0]));
      assert.equal(quality.length, 1); assert.equal(quality[0].text, f.i18n.system("Full quality"));
      const actions = current.visible("button").filter(node => node.owner === owner && fanTimingInside(node, footers[0]));
      assert.equal(actions.length, 4);
      for (const name of ["Promote image", "Use as default", "Use & edit", "Inspect inputs"]) {
        const matches = actions.filter(node => node.text === f.i18n.system(name)); assert.equal(matches.length, 1);
        assert.equal(matches[0].port.matches(":disabled"), false);
      }
      observed.push({ text: metadata[0].text, member });
    }
    assert.deepEqual(f.store.events.get(), x.beforeEvents); assert.deepEqual(f.store.content.get(), x.beforeContent);
    assert.deepEqual(f.store.projection.get().libraryOutputs, x.beforeOutputs); assert.deepEqual(fanTimingFinance(f), x.beforeFinance);
    assert.equal(f.storeHost.requests.length, x.beforeRequests); assert.deepEqual(f.storeHost.worker.counts(), x.initialCounts);
    for (const { text, member } of observed) assert.equal(text, member.modelId + " · " + label + " " + f.i18n.number(member.seconds) + "s",
      "every comparison metric is labeled without changing original rounded-tenth precision or model identity");
  });
}
