import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildPresentationSourceContract,
  inferPresentationSourceOutline,
  providerFacingPresentationSourceContract,
  repairProtectedPresentationMessages,
  validatePresentationSourceCoverage,
} from "../src/model/presentation-source.ts";
import { assessStoredPresentationCandidate, generateDocumentArtifact } from "../worker/openai-adapter.ts";
import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { combinedSceneSnapshot, generateManagedArtifactDraft } from "../worker/managed-production.ts";
import { documentArtifactValidationIssues, normalizeSlideDeckItems, parseDocumentArtifactContent, slideCopyIsNearDuplicate } from "../src/model/document-artifacts.ts";
import { collectProductionEvidence } from "../src/model/production-evidence.ts";

const promise = "Your content. One context. Infinite paths to your target.";
const sourceId = "PRIVATE_AUTHORED_PITCH_SOURCE_8731";
const unrelatedSourceId = "PRIVATE_UNRELATED_PITCH_SOURCE_8731";
const recommendation = "P0: Move generation to durable server-owned execution; add idempotent provider submission.";

function snapshot({ structured = false, closingPromise = true } = {}) {
  const authored = [
    `Slide 1 — ${promise}\nPreserve this line exactly: ${promise}`,
    `Slide 2 — Protect the delivery experience\n${recommendation}`,
    `Slide 3 — Build the story once. Meet people where they are.\n${closingPromise ? `Close with the exact promise: ${promise} ` : ""}Call to action: Deliver it in the form your audience needs now.`,
  ].join("\n");

  return {
    facts: [
      {
        block_id: sourceId,
        type: "direction",
        properties: { label: "Narrative brief", text: authored, weight: 1 },
      },
      ...(structured ? [{
        block_id: "PRIVATE_PROTECTED_MESSAGE_SETTINGS_8731",
        type: "direction",
        properties: {
          label: "Protected audience promise",
          text: `Preserve this line exactly: ${promise}`,
          exact_text: promise,
          exact_placements: ["opening", "closing"],
          protected_phrases: [{ text: promise, placement: "opening_and_closing" }],
          weight: 1,
        },
      }] : []),
      {
        block_id: unrelatedSourceId,
        type: "direction",
        properties: { label: "Separate authorized source", text: "Independent unrelated customer research.", weight: 1 },
      },
    ],
    relationships: [],
  };
}

function output({ providerAliases = false, notesOnly = false } = {}) {
  const source = providerAliases ? "blk_001" : sourceId;
  const slide = (index, title, visual, excerpt, body = "") => ({
    title,
    body,
    notes: index === 3 ? promise : "Keep the independently authored message.",
    image_prompt: "Source-grounded editable visual direction.",
    context_group_ids: [],
    slide: {
      layout: index === 1 ? "cover" : index === 3 ? "closing" : "statement",
      kicker: ["FORMA", "DELIVERY", "THE INVITATION"][index - 1],
      bullets: [],
      quote: null,
      citations: notesOnly && index === 3 ? [] : [{
        ...(providerAliases ? { source_id: source } : { sourceId: source }),
        label: "Narrative brief",
        anchor: `Slide ${index}`,
        excerpt,
      }],
      ...(providerAliases ? { source_ids: [source], source_order: index } : { sourceIds: [source], sourceOrder: index }),
      section: null,
      visual: {
        kind: "hero-type",
        label: ["Creative beginning", "Execution confidence", "Human invitation"][index - 1],
        value: visual,
        ...(providerAliases ? { exact_value: null, display_value: null } : {}),
        unit: null,
        data: [],
      },
    },
  });

  return {
    title: "A single context, delivered everywhere",
    summary: "One authored message survives every delivery.",
    content_markdown: `# Forma\n\n${promise}\n\n${recommendation}\n\nDeliver it in the form your audience needs now.`,
    presentation: {
      ...(providerAliases
        ? { aspect_ratio: "16:9", footer_label: "Forma", style_preset: "editorial" }
        : { aspectRatio: "16:9", footerLabel: "Forma", stylePreset: "editorial" }),
      theme: "Forma pitch",
      mode: "light",
      palette: {
        background: "#f8f7f5",
        foreground: "#171717",
        accent: "#076a60",
        muted: "#636363",
        surface: "#eceae7",
      },
    },
    items: [
      slide(1, promise, "One durable creative beginning", promise),
      slide(2, "Protect the delivery experience", "Reliable delivery earns lasting trust", recommendation, recommendation),
      slide(3, "Build the story once. Meet people where they are.", "Deliver it in the form your audience needs now.", promise),
    ],
  };
}

const isolatedTitles = [promise, "One idea. Five files. Five chances to lose the plot.", "Stop managing formats. Start managing meaning.", "The storyteller picks the path.", "The audience can pick the experience.", "One source of truth. Fewer FINAL-final-v3 files.", "Three moments. One adaptable story.", "Human judgment stays in the loop.", "Build the story once. Meet people where they are."];
const isolatedVisuals = ["A durable creative beginning", "Reformatting fragments the argument", "Keep meaning linked to evidence", "Choose a route through the story", "Give readers control over depth", "Revise shared context with confidence", "Adapt the format to the moment", "Approve changes before publication", "Deliver it in the form your audience needs now."];

function isolatedPitchSnapshot() {
  return { facts: isolatedTitles.map((title, index) => ({
    block_id: `PRIVATE_ISOLATED_PITCH_${index + 1}`, type: "reference",
    properties: { label: `Authored chapter ${index + 1}`, weight: 1,
      text: `Slide ${index + 1} — ${title}\n${index === 0 ? `Preserve this line exactly: ${promise}\n` : index === 8 ? `Close with the exact promise: ${promise}\n` : ""}${isolatedVisuals[index]}` },
  })), relationships: [] };
}

function isolatedPitchItem(position, source) {
  return { title: isolatedTitles[position - 1], body: "", notes: position === 9 ? promise : "", image_prompt: "Source-grounded editorial visual.", context_group_ids: [],
    slide: { layout: position === 1 ? "cover" : position === 9 ? "closing" : "statement", kicker: "", bullets: [], quote: null, section: null,
      source_ids: [source], source_order: position,
      citations: [{ source_id: source, label: `Authored chapter ${position}`, anchor: `Slide ${position}`, excerpt: position === 1 || position === 9 ? promise : isolatedVisuals[position - 1] }],
      visual: { kind: "hero-type", label: "", value: isolatedVisuals[position - 1], data: [] } } };
}

for (const lateRepair of [false, true]) test(`isolated ninth-slide promise survives ${lateRepair ? "a whole-work repair and " : ""}final normalization without a duplicate-copy retry`, async (context) => {
  const authored = isolatedPitchSnapshot();
  const production = buildManagedProductionPlan("slides", authored, { requestedSlideCount: 9 });
  const requests = [];
  context.mock.method(globalThis, "fetch", async (url, init = {}) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const request = JSON.parse(String(init.body)), input = JSON.parse(request.input);
    requests.push({ request, input });
    assert.ok(requests.length <= (lateRepair ? 3 : 2), "source-authorized repetition must not consume paid retries");
    const items = input.production.assigned_scenes.map((scene) => isolatedPitchItem(scene.narrative_order, scene.source_keys[0]));
    if (lateRepair && requests.length === 2) items[0].slide.layout = "cover";
    const candidate = { ...output({ providerAliases: true }), items,
      content_markdown: items.map((item) => [item.title, item.body, item.slide.visual.value].filter(Boolean).join("\n")).join("\n\n") };
    return Response.json({ id: `isolated-pitch-${requests.length}`, model: "gpt-5.6-terra", output_text: JSON.stringify(candidate), usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  });
  const result = await generateManagedArtifactDraft({ OPENAI_API_KEY: "mock-provider-key", OPENAI_MODEL: "gpt-5.6-terra" }, "owner", "slides", {
    documentTitle: "Pitch context", snapshot: authored, production, requestedSlideCount: 9, presentationStyle: "editorial", presentationFidelity: "faithful",
  });
  assert.equal(requests.length, lateRepair ? 3 : 2);
  assert.deepEqual(requests.slice(0, 2).map(({ input }) => input.presentation_source.outline.map((slide) => slide.number)), [[1,2,3,4,5,6,7,8], [9]]);
  for (const { request, input } of requests.slice(1)) {
    assert.equal(input.presentation_source.outline[0].order, 9);
    assert.deepEqual(input.presentation_source.protectedMessages.map(({ slideNumber, placement }) => ({ slideNumber, placement })), [{ slideNumber: 9, placement: "closing" }]);
    assert.equal(input.production.page.prior_visible_copy.includes(promise), false);
    assert.match(request.instructions, /take precedence over every general de-duplication instruction/);
  }
  assert.ok(requests.every(({ request }) => !JSON.stringify(request).includes("PRIVATE_ISOLATED_PITCH_")));
  assert.equal(result.output.items[0].title, promise);
  assert.equal(result.output.items[8].body, promise);
  assert.equal(result.output.items[8].slide.layout, "closing");
  assert.deepEqual(result.output.items.map((item) => item.slide.sourceIds), authored.facts.map((fact) => [fact.block_id]));
  assert.equal(result.inputReceipt.provider_request_count, lateRepair ? 3 : 2);
  assert.equal(result.inputReceipt.whole_work_validation.repaired_pages, lateRepair ? 1 : 0);
  assert.deepEqual(result.inputReceipt.whole_work_validation.issues, []);
  const contract = buildPresentationSourceContract(authored, { requestedSlideCount: 9 });
  const evidence = collectProductionEvidence(production, { draft: result.output, sourceContract: contract });
  assert.equal(evidence.metrics.nonDuplication.status, "measured");
  assert.equal(evidence.metrics.nonDuplication.score, 1);
  assert.equal(evidence.metrics.formatCraft.status, "measured");
  assert.equal(evidence.metrics.formatCraft.score, 1);
  assert.equal(normalizeSlideDeckItems(result.output.items, { sourceContract: contract })[8].body, promise);
});

test("a scoped first page cannot treat its eighth slide as the global closing slide", () => {
  const authored = isolatedPitchSnapshot();
  authored.facts[7].properties.text += `\n${promise}`;
  const production = buildManagedProductionPlan("slides", authored, { requestedSlideCount: 9 });
  const scoped = combinedSceneSnapshot(authored, production.scenes.slice(0, 8));
  const contract = buildPresentationSourceContract(scoped, { itemCount: 8, requestedSlideCount: 9, authoredSlideNumbers: [1,2,3,4,5,6,7,8,9] });
  const items = authored.facts.slice(0, 8).map((fact, index) => isolatedPitchItem(index + 1, fact.block_id));
  items[7].body = promise;
  const candidate = parseDocumentArtifactContent(JSON.stringify({ ...output({ providerAliases: true }), items }));
  const issues = documentArtifactValidationIssues("slides", candidate, { itemCount: 8, sourceContract: contract, sourcePageStart: 0, sourcePageSize: 8, requireSourceGrounding: true, requireAllProtectedContent: false });
  assert.equal(contract.authoredSlideCount, 9);
  assert.equal(contract.protectedMessages.some((message) => message.slideNumber === 8 && message.placement === "closing"), false);
  assert.ok(issues.some((issue) => issue.code === "duplicate_deck_copy" && issue.path === "items.7.body"));
  assert.equal(normalizeSlideDeckItems(candidate.items, { sourceContract: contract })[7].body, "");
});

test("stored isolated final-page candidates use global source positions and never promote notes-only evidence", () => {
  const authored = isolatedPitchSnapshot();
  const production = buildManagedProductionPlan("slides", authored, { requestedSlideCount: 9 });
  const scenes = production.scenes.slice(8), scoped = combinedSceneSnapshot(authored, scenes);
  const options = { itemCount: 1, requestedSlideCount: 9, presentationStyle: "editorial", productionScenes: scenes,
    productionPage: { pageIndex: 1, pageCount: 2, globalStartIndex: 8, totalItems: 9, phase: "final", priorSummary: "", priorEnding: "", priorVisibleCopy: [promise], authoredSlideNumbers: [1,2,3,4,5,6,7,8,9] } };
  const candidate = { ...output({ providerAliases: true }), items: [isolatedPitchItem(9, "blk_001")] };
  const accepted = assessStoredPresentationCandidate(JSON.stringify(candidate), scoped, options);
  assert.deepEqual(accepted.issues, []);
  assert.equal(accepted.output.items[0].body, promise);
  candidate.items[0].slide.citations = [];
  const rejected = assessStoredPresentationCandidate(JSON.stringify(candidate), scoped, options);
  assert.ok(rejected.issues.some((issue) => issue.code === "missing_protected_message" && issue.path === "items.0.body"));
});

test("stored page assessment preserves non-contiguous authored numbers at their global positions", () => {
  const authored=[
    {number:10,title:"Keep the evidence connected",value:"Trace each decision to its original source"},
    {number:11,title:"Make the next step clear",value:"Invite the audience to put the plan into practice"},
  ];
  const scoped={facts:authored.map(({number,title,value})=>({block_id:`scoped-${number}`,type:"reference",properties:{text:`Slide ${number} — ${title}\n${value}`}})),relationships:[]};
  const options={itemCount:2,requestedSlideCount:10,presentationStyle:"editorial",productionPage:{pageIndex:1,pageCount:2,globalStartIndex:8,totalItems:10,phase:"final",priorSummary:"",priorEnding:"",priorVisibleCopy:[],authoredSlideNumbers:[1,2,3,4,5,6,7,9,10,11]}};
  for(const explicitAssignments of [true,false]){
    const candidate={...output({providerAliases:true}),items:authored.map(({number,title,value},index)=>({
      title,body:"",notes:"",image_prompt:"",context_group_ids:[],
      slide:{layout:index?"closing":"statement",kicker:"",bullets:[],
        ...(explicitAssignments?{source_ids:[`blk_00${index+1}`],source_order:number}:{}),
        visual:{kind:"hero-type",label:"",value,data:[]}},
    }))};
    const assessed=assessStoredPresentationCandidate(JSON.stringify(candidate),scoped,options);
    assert.deepEqual(assessed.issues,[],`explicit source assignments: ${explicitAssignments}`);
    assert.deepEqual(assessed.output.items.map((item)=>item.slide.sourceOrder),[10,11]);
    assert.deepEqual(assessed.output.items.map((item)=>item.slide.sourceIds),[["scoped-10"],["scoped-11"]]);
    candidate.items[1].slide.source_order=10;
    assert.equal(assessStoredPresentationCandidate(JSON.stringify(candidate),scoped,options).issues.some((issue)=>issue.code==="incorrect_slide_order"&&issue.path==="items.1.slide.source_order"),true);
  }
});

test("an exhausted local artifact repair is not mislabeled as a retryable upstream 502", async (context) => {
  let calls=0;
  context.mock.method(globalThis,"fetch",async()=>{
    calls++;
    return Response.json({id:`incomplete-layout-${calls}`,model:"gpt-5.6-terra",output_text:'{"items": [',usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
  });
  await assert.rejects(generateDocumentArtifact({OPENAI_API_KEY:"mock-provider-key",OPENAI_MODEL:"gpt-5.6-terra"},"owner","slides",{documentTitle:"Pitch context",snapshot:snapshot(),options:{itemCount:3,presentationStyle:"editorial"}}),(error)=>{
    assert.equal(error.detail.code,"provider_returned_incomplete_document_artifact");
    assert.equal(error.detail.action,"edit_request");
    assert.equal(error.detail.retryable,false);
    assert.equal(error.detail.httpStatus,null);
    assert.ok(error.detail.validationIssues.some((issue)=>issue.code==="invalid_json"));
    return true;
  });
  assert.equal(calls,2);
});

test("preserves complete newline-delimited pitch and feedback headings, including deliberate sentence and ending punctuation", () => {
  const pitchHeadings = [
    "Your content. One context. Infinite paths to your target.",
    "One idea. Five files. Five chances to lose the plot.",
    "Stop managing formats. Start managing meaning.",
    "The storyteller picks the path.",
    "The audience can pick the experience.",
    "One source of truth. Fewer FINAL-final-v3 files.",
    "Three moments. One adaptable story.",
    "Human judgment stays in the loop.",
    "Build the story once. Meet people where they are.",
  ];
  const pitch = pitchHeadings.map((heading, index) => `Slide ${index + 1} — ${heading}\nIndependently authored supporting evidence ${index + 1}.`).join("\n");
  const feedback = "Slide 1 — One context, infinite paths: the end-user verdict\nA source-grounded opening.\nSlide 6 — Fix the friction. Keep the promise.\nP0: Move generation to durable server-owned execution.";

  assert.deepEqual(inferPresentationSourceOutline(pitch).slides.map((slide) => slide.title), pitchHeadings);
  assert.equal(inferPresentationSourceOutline(feedback).slides.at(-1).title, "Fix the friction. Keep the promise.");
  assert.deepEqual(providerFacingPresentationSourceContract(buildPresentationSourceContract(pitch)).outline.map((slide) => slide.title), pitchHeadings);
});

test("never absorbs same-line narrative prose into an authored heading or invents an overlong title", () => {
  assert.equal(
    inferPresentationSourceOutline("Slide 1 — The product opportunity. This sentence is supporting narrative, not its title.").slides[0].title,
    "The product opportunity",
  );
  assert.equal(
    inferPresentationSourceOutline("Slide 1 — The product opportunity. This sentence is supporting narrative.\nAdditional evidence remains in the body.").slides[0].title,
    "The product opportunity",
  );
  assert.equal(
    inferPresentationSourceOutline("Slide 1 — SOURCE EVIDENCE: The authored uppercase heading introduces inline prose.\nAnother supporting paragraph.").slides[0].title,
    "SOURCE EVIDENCE",
  );

  const overlong = `Slide 1 — ${"Source-authored heading ".repeat(12)}\nSupporting body.`;
  assert.ok(inferPresentationSourceOutline(overlong).slides[0].title.length <= 180);
});

test("protects the exact opening and closing promise without absorbing a following call-to-action directive", () => {
  for (const structured of [false, true]) {
    const contract = buildPresentationSourceContract(snapshot({ structured }), { requestedSlideCount: 3 });
    assert.deepEqual(contract.protectedMessages.map(({ text, placement, slideNumber }) => ({ text, placement, slideNumber })), [
      { text: promise, placement: "opening", slideNumber: 1 },
      { text: promise, placement: "closing", slideNumber: 3 },
    ]);
    assert.equal(contract.protectedMessages.every((message) => !message.text.includes("Call to action:")), true);

    const safe = providerFacingPresentationSourceContract(contract);
    assert.deepEqual(safe.protectedMessages.map(({ text, placement, slideNumber }) => ({ text, placement, slideNumber })), [
      { text: promise, placement: "opening", slideNumber: 1 },
      { text: promise, placement: "closing", slideNumber: 3 },
    ]);
    assert.doesNotMatch(JSON.stringify(safe.protectedMessages), /PRIVATE_|sourceBlockId|sourceId/);
  }
});

test("protects an intake-authored exact promise on the planned opening and closing even before a numbered outline exists", () => {
  const authored = {
    facts: [{
      block_id: sourceId,
      type: "direction",
      properties: {
        label: "Message",
        text: `A persuasive founder pitch.\nPreserve this line exactly: ${promise}`,
        exact_text: promise,
        exact_placements: ["opening", "closing"],
        protected_phrases: [{ text: promise, placement: "opening_and_closing" }],
        weight: 1,
      },
    }],
    relationships: [],
  };
  const contract = buildPresentationSourceContract(authored, { requestedSlideCount: 5 });

  assert.equal(contract.authoredSlideCount, null);
  assert.deepEqual(contract.protectedMessages.map(({ text, placement, slideNumber }) => ({ text, placement, slideNumber })), [
    { text: promise, placement: "opening", slideNumber: 1 },
    { text: promise, placement: "closing", slideNumber: 5 },
  ]);

  const slides = Array.from({ length: 5 }, (_, index) => ({
    title: index === 0 ? promise : `A distinct authored argument ${index + 1}`,
    body: "",
    slide: { sourceIds: [sourceId], bullets: [], visual: { kind: "hero-type", label: "Delivery", value: `Decision ${index + 1}`, data: [] } },
  }));

  assert.ok(validatePresentationSourceCoverage(slides, contract, {
    requireEverySlideSource: true,
    requireAllProtectedContent: true,
  }).some((issue) => issue.code === "misplaced_protected_message" && issue.path === "items.4.body"));

  slides[4].body = promise;
  assert.deepEqual(validatePresentationSourceCoverage(slides, contract, {
    requireEverySlideSource: true,
    requireAllProtectedContent: true,
  }), []);
});

const benefitsFixture = JSON.parse(await readFile(new URL("./fixtures/presentation-forma-benefits-source.json", import.meta.url), "utf8"));
const benefitsPromise = "One source. Many outputs.";
const benefitsSource = () => structuredClone(benefitsFixture.sourceSnapshot);
const benefitsOutput = () => parseDocumentArtifactContent(JSON.stringify(benefitsFixture.syntheticOutput));
const benefitsOptions = (sourceContract) => ({ itemCount: 6, sourceContract, requireSourceGrounding: true, requireAllProtectedContent: true });

test("the frozen six-beat source preserves its exact unnumbered bookends through full validation and normalization", () => {
  const contract = buildPresentationSourceContract(benefitsSource(), benefitsFixture.request);
  const candidate = benefitsOutput(), before = structuredClone(candidate);
  assert.equal(contract.numberedOutline.length, 0, "numbered narrative beats are not a numbered authored slide outline");
  assert.deepEqual(contract.protectedMessages.map(({ text, placement, slideNumber }) => ({ text, placement, slideNumber })), [
    { text: benefitsPromise, placement: "opening", slideNumber: 1 },
    { text: benefitsPromise, placement: "closing", slideNumber: 6 },
  ]);
  assert.ok(documentArtifactValidationIssues("slides", candidate, { itemCount: 6 }).some(issue => issue.code === "duplicate_deck_copy" && issue.path === "items.5.body"), "the generic duplicate detector is unchanged");
  assert.deepEqual(documentArtifactValidationIssues("slides", candidate, benefitsOptions(contract)), []);
  const normalized = { ...candidate, items: normalizeSlideDeckItems(candidate.items, { sourceContract: contract }) };
  assert.equal(normalized.items[5].body, benefitsPromise);
  assert.deepEqual(documentArtifactValidationIssues("slides", normalized, benefitsOptions(contract)), []);
  assert.deepEqual(candidate, before, "source-aware normalization never changes the retained response");
});

test("observed paid-repair copy distinguishes three genuine within-slide repeats from required body bookends", () => {
  const observed = benefitsFixture.observedRepairCopy, fifth = observed.slideFive;
  for (const pair of observed.genuineRedundantPairs) {
    assert.equal(slideCopyIsNearDuplicate(fifth.bullets[pair.bullet], fifth.data[pair.datum][pair.field]), true, pair.reportedPath);
  }
  const contract = buildPresentationSourceContract(benefitsSource(), benefitsFixture.request);
  const candidate = benefitsOutput();
  candidate.items[0].title = "One document. More ways to use it.";
  candidate.items[0].body = observed.openingBody;
  candidate.items[5].body = observed.closingBody;
  // Layout and all other slides remain test-authored: this is not a recovered paid deck.
  candidate.items[4].title = fifth.title;
  candidate.items[4].body = fifth.body;
  candidate.items[4].slide.bullets = structuredClone(fifth.bullets);
  candidate.items[4].slide.visual = { kind: "comparison", label: fifth.visualLabel, value: "", data: structuredClone(fifth.data) };
  const issues = documentArtifactValidationIssues("slides", candidate, benefitsOptions(contract));
  assert.deepEqual(issues.filter(issue => issue.code === "duplicate_slide_copy").map(issue => issue.path), observed.genuineRedundantPairs.map(pair => pair.reportedPath));
  assert.equal(issues.some(issue => issue.code === "duplicate_deck_copy" && issue.path === "items.5.body"), false);
});

test("an unnumbered protected message does not exempt middle slides, approximate wording, titles, or unrelated copy", () => {
  const contract = buildPresentationSourceContract(benefitsSource(), benefitsFixture.request);
  const cases = [
    ["intermediate echo", candidate => { candidate.items[3].body = benefitsPromise; }, "items.3.body"],
    ["case-only rewrite", candidate => { candidate.items[5].body = benefitsPromise.toUpperCase(); }, "items.5.body"],
    ["longer repeated claim", candidate => { candidate.items[5].body = `${benefitsPromise} Deliver it everywhere.`; }, "items.5.body"],
    ["repeated title", candidate => { candidate.items[5].title = benefitsPromise; candidate.items[5].body = ""; }, "items.5.title"],
    ["unrelated visual echo", candidate => { candidate.items[5].slide.visual.value = candidate.items[1].slide.visual.value; }, "items.5.slide.visual.value"],
  ];
  for (const [label, mutate, path] of cases) {
    const candidate = benefitsOutput(); mutate(candidate);
    assert.ok(documentArtifactValidationIssues("slides", candidate, benefitsOptions(contract)).some(issue => issue.code === "duplicate_deck_copy" && issue.path === path), label);
  }
  const sameSlide = benefitsOutput();
  sameSlide.items[5].slide.bullets = [benefitsPromise];
  assert.ok(documentArtifactValidationIssues("slides", sameSlide, benefitsOptions(contract)).some(issue => issue.code === "duplicate_slide_copy"), "an endpoint exemption never suppresses within-slide duplication");
  const noClosing = benefitsSource();
  const message = noClosing.facts.find(fact => fact.properties.exact_text === benefitsPromise);
  message.properties.exact_placements = ["opening"];
  message.properties.protected_phrases = [{ text: benefitsPromise, placement: "opening" }];
  const openingOnly = buildPresentationSourceContract(noClosing, benefitsFixture.request);
  assert.ok(documentArtifactValidationIssues("slides", benefitsOutput(), benefitsOptions(openingOnly)).some(issue => issue.code === "duplicate_deck_copy" && issue.path === "items.5.body"), "source authorization for one occurrence cannot authorize two");
});

test("each unnumbered bookend must retain its exact protected-message source without foreign aliases", () => {
  const source = benefitsSource(), contract = buildPresentationSourceContract(source, benefitsFixture.request);
  const messageSource = source.facts.find(fact => fact.properties.exact_text === benefitsPromise).block_id;
  const unrelatedSource = source.facts.find(fact => fact.type === "reference").block_id;
  for (const position of [0, 5]) for (const references of [[unrelatedSource], [messageSource, "blk_999"]]) {
    const candidate = benefitsOutput(); candidate.items[position].slide.sourceIds = references;
    const issues = documentArtifactValidationIssues("slides", candidate, benefitsOptions(contract));
    assert.ok(issues.some(issue => issue.code === "duplicate_deck_copy" && issue.path === "items.5.body"), `slide ${position + 1}: ${references.join(",")}`);
    if (references.includes("blk_999")) assert.ok(issues.some(issue => issue.code === "unknown_source_reference"), "cosmetic repetition cannot authenticate a foreign source");
    assert.equal(normalizeSlideDeckItems(candidate.items, { sourceContract: contract })[5].body, "");
  }
});

test("unnumbered bookend placement follows the complete requested deck or its explicit flexible range", () => {
  const source = benefitsSource(), fixed = buildPresentationSourceContract(source, benefitsFixture.request);
  const partial = benefitsOutput(); partial.items = partial.items.slice(0, 3); partial.items[2].body = benefitsPromise;
  const issues = documentArtifactValidationIssues("slides", partial, { ...benefitsOptions(fixed), itemCount: 3, sourcePageStart: 0, sourcePageSize: 3, requireAllProtectedContent: false });
  assert.ok(issues.some(issue => issue.code === "duplicate_deck_copy" && issue.path === "items.2.body"), "the last item of an intermediate provider page is not the document closing");
  assert.equal(normalizeSlideDeckItems(partial.items, { sourceContract: fixed })[2].body, "");
  const countPolicy = { kind: "flexible", unit: "slide", min: 5, max: 8, aim: 7 };
  const flexible = buildPresentationSourceContract(source, { itemCount: 7, slideCountPolicy: countPolicy });
  const candidate = benefitsOutput();
  assert.equal(flexible.protectedMessages.find(message => message.placement === "closing").slideNumber, 7, "the proposed count is not an exact commitment");
  assert.deepEqual(documentArtifactValidationIssues("slides", candidate, { ...benefitsOptions(flexible), itemCount: 7, slideCountPolicy: countPolicy }), []);
  assert.equal(normalizeSlideDeckItems(candidate.items, { sourceContract: flexible })[5].body, benefitsPromise);
});

test("a synthetic response to the frozen unnumbered source needs one mocked provider call and no paid-repair attempt", async context => {
  const source = benefitsSource(), contract = buildPresentationSourceContract(source, benefitsFixture.request);
  const candidate = structuredClone(benefitsFixture.syntheticOutput);
  for (const item of candidate.items) item.slide.sourceIds = item.slide.sourceIds.map(id => contract.sources.find(source => source.sourceId === id).alias);
  let calls = 0;
  context.mock.method(globalThis, "fetch", async url => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    calls += 1;
    assert.equal(calls, 1, "the explicit authored bookends must not trigger another provider attempt");
    return Response.json({ id: "synthetic-benefits-response", model: "gpt-5.6-terra", output_text: JSON.stringify(candidate), usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  });
  const result = await generateDocumentArtifact({ OPENAI_API_KEY: "mock-provider-key", OPENAI_MODEL: "gpt-5.6-terra" }, "synthetic-benefits-owner", "slides", {
    documentTitle: "Forma benefits", snapshot: source, options: benefitsFixture.request,
  });
  assert.equal(result.output.items[5].body, benefitsPromise);
  assert.equal(result.inputReceipt.validation.repair_attempted, false);
  const retained = assessStoredPresentationCandidate(JSON.stringify(candidate), source, benefitsFixture.request);
  assert.deepEqual(retained.issues, []);
  assert.equal(retained.output.items[5].body, benefitsPromise);
  assert.equal(calls, 1, "local retained-response assessment cannot contact a provider");
});

test("citation excerpts, provenance labels, and presenter notes never satisfy exact audience message delivery", () => {
  const contract = buildPresentationSourceContract(snapshot(), { requestedSlideCount: 3 });

  for (const notesOnly of [false, true]) {
    const artifact = output({ notesOnly });
    const issues = validatePresentationSourceCoverage(artifact.items, contract, {
      requireEverySlideSource: true,
      requireAllProtectedContent: true,
    });

    assert.ok(issues.some((issue) => issue.code === "misplaced_protected_message" && issue.path === "items.2.body"));
    assert.equal(artifact.items[2].notes, promise, "private speaker notes alone are never audience delivery");
  }
});

test("requires a protected final promise on its own managed-production page without imposing unrelated whole-deck coverage", () => {
  const contract = buildPresentationSourceContract(snapshot(), { requestedSlideCount: 3 });
  const final = output().items[2];

  const issues = validatePresentationSourceCoverage([final], contract, {
    pageStart: 2,
    pageSize: 1,
    requireEverySlideSource: true,
    requireAllProtectedContent: false,
  });
  assert.ok(issues.some((issue) => issue.code === "missing_protected_message" && issue.path === "items.0.body"));
  assert.equal(issues.some((issue) => issue.code === "slide_count_mismatch"), false);

  const repaired = repairProtectedPresentationMessages([final], contract, { pageStart: 2 });
  assert.equal(repaired[0].body, promise, "the assigned closing citation independently authorizes page-scoped correction");
  assert.deepEqual(validatePresentationSourceCoverage(repaired, contract, {
    pageStart: 2,
    pageSize: 1,
    requireEverySlideSource: true,
    requireAllProtectedContent: false,
  }), []);
});

test("repairs only a source-authorized final message while preserving the CTA, attribution, recommendation, and private evidence", () => {
  const contract = buildPresentationSourceContract(snapshot(), { requestedSlideCount: 3 });
  const artifact = output();
  const original = structuredClone(artifact.items);
  const repaired = repairProtectedPresentationMessages(artifact.items, contract);

  assert.equal(repaired[0].title, promise);
  assert.equal(repaired[2].body, promise);
  assert.equal(repaired[2].title, original[2].title);
  assert.deepEqual(repaired[2].slide.visual, original[2].slide.visual);
  assert.deepEqual(repaired[2].slide.citations, original[2].slide.citations);
  assert.equal(repaired[1].body, recommendation, "legitimate authored product-feedback recommendations must never be censored");
  assert.equal(artifact.items[2].body, "", "deterministic repair must not mutate the original paid artifact");
  assert.deepEqual(validatePresentationSourceCoverage(repaired, contract, {
    requireEverySlideSource: true,
    requireAllProtectedContent: true,
  }), []);
});

test("refuses to promote protected wording across source boundaries or onto an unauthorized authored position", () => {
  const contract = buildPresentationSourceContract(snapshot(), { requestedSlideCount: 3 });
  const foreign = output();
  foreign.items[2].slide.sourceIds = [unrelatedSourceId];
  foreign.items[2].slide.citations[0].sourceId = unrelatedSourceId;

  assert.equal(repairProtectedPresentationMessages(foreign.items, contract)[2].body, "");
  assert.ok(validatePresentationSourceCoverage(foreign.items, contract, {
    requireEverySlideSource: true,
    requireAllProtectedContent: true,
  }).some((issue) => issue.code === "incorrect_slide_source"));

  const missingClosingSource = buildPresentationSourceContract(snapshot({ closingPromise: false }), { requestedSlideCount: 3 });
  assert.deepEqual(missingClosingSource.protectedMessages.map((message) => message.placement), ["opening"]);
  assert.equal(repairProtectedPresentationMessages(output().items, missingClosingSource)[2].body, "");
});

test("promotes a citation-only exact closing promise before validation with one provider call and zero paid repair", async () => {
  const authored = snapshot();
  const candidate = output({ providerAliases: true });
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const request = JSON.parse(String(init.body));
    requests.push({ instructions: request.instructions, input: JSON.parse(request.input) });
    return Response.json({
      id: `protected-message-provider-${requests.length}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify(candidate),
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    });
  };

  try {
    const result = await generateDocumentArtifact(
      { OPENAI_API_KEY: "mock-provider-key", OPENAI_MODEL: "gpt-5.6-terra" },
      "authorized-pitch-owner",
      "slides",
      {
        documentTitle: "Pitch context",
        snapshot: authored,
        options: { itemCount: 3, requestedSlideCount: 3, presentationStyle: "editorial", presentationFidelity: "faithful" },
      },
    );

    assert.equal(requests.length, 1, "a deterministic source-authorized correction must never submit a second paid request");
    assert.equal(result.inputReceipt.validation.repair_attempted, false);
    assert.deepEqual(result.inputReceipt.validation.initial_issues, []);
    assert.equal(result.output.items[0].title, promise);
    assert.equal(result.output.items[2].body, promise);
    assert.equal(result.output.items[1].body, recommendation);
    assert.match(requests[0].instructions, /Citation labels, anchors, excerpts, source aliases, production instructions, and speaker notes are private evidence/);
    assert.deepEqual(requests[0].input.presentation_source.protectedMessages.map((message) => message.slideNumber), [1, 3]);
    assert.doesNotMatch(JSON.stringify(requests[0].input.presentation_source.protectedMessages), /PRIVATE_|sourceBlockId|sourceId/);

    const retained = assessStoredPresentationCandidate(JSON.stringify(candidate), authored, {
      itemCount: 3,
      requestedSlideCount: 3,
      presentationStyle: "editorial",
      presentationFidelity: "faithful",
    });
    assert.deepEqual(retained.issues, []);
    assert.equal(retained.output.items[2].body, promise);
    assert.equal(requests.length, 1, "assessing a retained paid candidate must never contact a provider");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a genuinely missing protected opening uses the one bounded repair while retaining exact-message and audience-layout instructions", async () => {
  const authored = snapshot();
  const invalid = output({ providerAliases: true });
  invalid.items[0].title = "Start with one creative context";
  const corrected = output({ providerAliases: true });
  const candidates = [invalid, corrected];
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    requests.push({ instructions: request.instructions, input: JSON.parse(request.input) });
    return Response.json({
      id: `protected-message-bounded-repair-${requests.length}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify(candidates[requests.length - 1]),
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    });
  };

  try {
    const result = await generateDocumentArtifact(
      { OPENAI_API_KEY: "mock-provider-key", OPENAI_MODEL: "gpt-5.6-terra" },
      "authorized-pitch-owner",
      "slides",
      {
        documentTitle: "Pitch context",
        snapshot: authored,
        options: { itemCount: 3, requestedSlideCount: 3, presentationStyle: "editorial", presentationFidelity: "faithful" },
      },
    );

    assert.equal(requests.length, 2, "an actually missing protected opening receives exactly one bounded provider repair");
    assert.equal(result.inputReceipt.validation.repair_attempted, true);
    assert.ok(result.inputReceipt.validation.initial_issues.some((issue) => issue.code === "misplaced_protected_message"));
    assert.equal(result.output.items[0].title, promise);
    assert.equal(result.output.items[2].body, promise);
    assert.match(requests[1].instructions, /Preserve a deliberately authored identical opening and closing promise on both positions/);
    assert.match(requests[1].instructions, /Citation labels, anchors, excerpts, source aliases, production instructions, and speaker notes are private evidence/);
    assert.match(requests[1].instructions, /layout|artboard|readable/iu, "bounded repair must receive the same audience layout contract as first generation");
    assert.doesNotMatch(JSON.stringify(requests[1].input.presentation_source.protectedMessages), /PRIVATE_|sourceBlockId|sourceId/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
