import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  defaultSlidePresentation,
  documentArtifactValidationIssues,
  normalizeSlideVisual,
  parseDocumentArtifactContent,
  slidePrecisionIssues,
  slideSourceIds,
} from "../src/model/document-artifacts.ts";
import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { createPowerPointDocument } from "../src/model/office-documents.ts";
import {
  createPresentationPdf,
  createPresentationPdfFromRenderedSlides,
} from "../src/model/presentation-pdf.ts";
import {
  buildPresentationSourceContract,
  inferPresentationSourceOutline,
  providerFacingPresentationSourceContract,
  resolvePresentationSourceReferences,
  validatePresentationSourceCoverage,
} from "../src/model/presentation-source.ts";

const [executive, managed23] = await Promise.all([
  readFile(new URL("./fixtures/presentation-executive-source.json", import.meta.url), "utf8"),
  readFile(new URL("./fixtures/presentation-managed-23.json", import.meta.url), "utf8"),
]).then((fixtures) => fixtures.map((fixture) => JSON.parse(fixture)));

const executiveBodies = [
  "Verified sources, authored intent, many outputs, and accountable human review form one coherent creative world.",
  "Exact equal-weight average: 61.125 / 100; rounded displayed average: 61.13 / 100.",
  "Search, Send, asynchronous intervention, and short-height touch workflows must remain reachable.",
  "Traceable document decisions, outputs, revisions, independent review, and editable export protect the differentiator.",
  "Projects / Work / Explore / Activity / Deliver stay stable at every authorized screen size.",
  "Every device posture retains the complete authorized creative product and its exact next action.",
  "Write / Shape / Present organize seven preserved document views without changing routes or access.",
  "Principal-scoped notifications protect actor-private jobs, independent review, and exact-task recovery.",
  "Shared project context, editable Office delivery, searchable PDF, source-aware review, and spending controls are proven assets.",
  "An initial 4–6 weeks investment leads to a complete 12–16 weeks coordinated program.",
  "Complete the dependency-aware 12–16 weeks program while preserving truthful collaboration, accessibility, and trust.",
  "Gate unrestricted enterprise launch until identity, recovery, deletion, accessibility, and permission boundaries pass.",
];

function assignedQuotes(contract) {
  const grouped = new Map();
  for (const quote of contract.protectedQuotes) {
    const slideNumber = quote.slideNumber ?? 1;
    grouped.set(slideNumber, [...(grouped.get(slideNumber) ?? []), quote]);
  }
  const assigned = new Map();
  for (const [slideNumber, quotes] of grouped) {
    const start = Math.max(1, slideNumber - quotes.length + 1);
    quotes.forEach((quote, index) => assigned.set(start + index, quote));
  }
  return assigned;
}

function visualForSlide(fixture, sequence, sourceId, quote) {
  const executiveFixture = fixture === executive;
  const scorecard = executiveFixture ? 2 : 3;
  const destinations = executiveFixture ? 5 : 7;
  const postures = executiveFixture ? 6 : 9;
  const modes = executiveFixture ? 7 : 8;
  const roadmap = executiveFixture ? [10, 11] : [20, 21];
  if (sequence === scorecard) return {
    layout: "scorecard",
    visual: {
      kind: "scorecard",
      label: "Six independently assessed product goals",
      value: "61.13 / 100",
      exactValue: executive.average.exact,
      displayValue: executive.average.display,
      unit: "/100",
      data: executive.scores.map(({ label, value }) => ({
        label,
        value,
        weight: Number(value) / 100,
        sourceIds: [sourceId],
      })),
    },
  };
  if (sequence === destinations) return {
    layout: "architecture",
    visual: {
      kind: "architecture",
      label: "Stable authorized product destinations",
      value: "One coherent product",
      data: executive.destinations.map((label, index) => ({
        label,
        value: ["Resume", "Author", "Discover", "Intervene", "Review"][index],
        weight: 1,
        sourceIds: [sourceId],
      })),
    },
  };
  if (sequence === postures) return {
    layout: "comparison",
    visual: {
      kind: "comparison",
      label: "Four principal device postures",
      value: "Equal authorized capability",
      data: executive.postures.map((label, index) => ({
        label,
        value: ["Exact next action", "Touch-rich exploration", "Complete work + one pane", "Source → work → result → review"][index],
        weight: 1,
        sourceIds: [sourceId],
      })),
    },
  };
  if (sequence === modes) return {
    layout: "matrix",
    visual: {
      kind: "matrix",
      label: "Preserved document working modes",
      value: "Seven existing lenses",
      data: executive.modes.map((label, index) => ({
        label,
        value: ["Author and clarify", "Organize and refine", "Review and hand off"][index],
        weight: 1,
        sourceIds: [sourceId],
      })),
    },
  };
  if (roadmap.includes(sequence)) return {
    layout: "roadmap",
    visual: {
      kind: "roadmap",
      label: "Dependency-aware delivery milestones",
      value: "Protected source planning ranges",
      data: [
        { label: "Foundation phase", value: "4–6 weeks", weight: .38, sourceIds: [sourceId] },
        { label: "Comprehensive delivery", value: "12–16 weeks", weight: 1, sourceIds: [sourceId] },
      ],
    },
  };
  if (quote) return {
    layout: "quote",
    visual: {
      kind: "quote",
      label: quote.role,
      value: quote.text,
      data: [],
    },
  };
  return {
    layout: sequence === 1 ? "cover" : sequence === fixture.expectedSlideTitles.length ? "closing" : "statement",
    visual: {
      kind: "hero-type",
      label: "Authorized authored evidence",
      value: `Grounded decision ${String(sequence).padStart(2, "0")}`,
      data: [],
    },
  };
}

function buildFaithfulDraft(fixture) {
  const requestedSlideCount = fixture.requestedSlideCount;
  const contract = buildPresentationSourceContract(fixture.snapshot, { requestedSlideCount });
  const plan = buildManagedProductionPlan("slides", fixture.snapshot, { requestedSlideCount });
  const quotes = assignedQuotes(contract);
  const items = plan.scenes.map((scene, index) => {
    const sequence = index + 1;
    const sourceId = scene.sourceBlockIds[0];
    const quote = quotes.get(sequence);
    const heading = fixture.expectedSlideTitles[index];
    const source = contract.sources.find((candidate) => candidate.sourceId === sourceId);
    const citation = {
      sourceId,
      label: fixture === executive ? "Authorized executive source" : "Authorized managed production source",
      anchor: `Authored slide ${sequence}`,
      excerpt: heading,
    };
    let body = fixture === executive
      ? executiveBodies[index]
      : scene.action.replace(new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*:\\s*`, "u"), "");
    if (fixture === managed23 && sequence === 3) body = "Exact equal-weight average: 61.125 / 100; rounded displayed average: 61.13 / 100.";
    if (fixture === managed23 && sequence === 9) body = "All authorized capability persists as layouts adapt to available space and input method.";
    if (fixture === managed23 && quote) {
      const quoteDescriptions = new Map([
        [5, "Retain the complete verbatim argument for traceable, editable, accountable creative outcomes."],
        [12, "Reveal meaningful relationships between active work, supporting evidence, and the available canvas."],
        [15, "Connect asynchronous jobs to an actionable inbox and exact governed task recovery."],
        [23, "Make scarce screen space strengthen product priorities without removing authorized capability."],
      ]);
      body = quoteDescriptions.get(sequence) ?? body;
    }
    const { layout, visual } = visualForSlide(fixture, sequence, sourceId, quote);
    const role = quote?.role;
    const noteLines = [
      `Present authored section ${sequence}: ${heading}.`,
      body,
      ...(sequence === (fixture === executive ? 2 : 3)
        ? executive.scores.map(({ label, value }) => `${label}: ${value}`)
        : []),
      ...(quote ? [`“${quote.text}” — ${role}`] : []),
      "[Sources]",
      `${citation.label} · ${citation.anchor}`,
    ];
    return {
      title: heading,
      body,
      notes: noteLines.join("\n"),
      image_prompt: "",
      context_group_ids: [...scene.contextGroupIds],
      slide: {
        layout,
        kicker: `Executive chapter ${String(sequence).padStart(2, "0")}`,
        bullets: [],
        sourceIds: [sourceId],
        section: scene.section ?? source?.label ?? "Authorized source",
        sourceOrder: sequence,
        citations: [citation],
        ...(quote ? {
          quote: {
            text: quote.text,
            speaker: quote.speaker,
            role,
            sourceId: quote.sourceBlockId,
            citation: `Authored slide ${quote.slideNumber}`,
          },
        } : {}),
        visual,
      },
    };
  });

  const title = fixture === executive ? "Forma Everywhere — executive opportunity" : "Forma Everywhere — managed responsive strategy";
  const presentation = {
    ...defaultSlidePresentation("field-notes"),
    theme: title,
    footerLabel: "Forma Everywhere",
  };
  const content_markdown = items.map((item, index) => [
    `## ${index + 1}. ${item.title}`,
    item.body,
    ...(item.slide.visual.exactValue
      ? [`Exact equal-weight average: ${item.slide.visual.exactValue}`, `Rounded display average: ${item.slide.visual.displayValue}`]
      : []),
    ...item.slide.visual.data.map((datum) => `- ${datum.label}: ${datum.value}`),
    ...(item.slide.quote ? [`> “${item.slide.quote.text}” — ${item.slide.quote.role}`] : []),
    `[Sources] ${item.slide.citations[0].label} · ${item.slide.citations[0].anchor}`,
  ].join("\n")).join("\n\n");
  const raw = { title, summary: "Faithful, source-attributed responsive product strategy.", content_markdown, presentation, items };
  const draft = parseDocumentArtifactContent(JSON.stringify(raw));
  assert.ok(draft, "the production artifact parser accepts the complete canonical presentation");
  return { contract, draft, plan };
}

function storedZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const footer = bytes.byteLength - 22;
  assert.equal(view.getUint32(footer, true), 0x06054b50);
  const entryCount = view.getUint16(footer + 10, true);
  let central = view.getUint32(footer + 16, true);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(view.getUint32(central, true), 0x02014b50);
    const nameLength = view.getUint16(central + 28, true);
    const extraLength = view.getUint16(central + 30, true);
    const commentLength = view.getUint16(central + 32, true);
    const name = new TextDecoder().decode(bytes.slice(central + 46, central + 46 + nameLength));
    const local = view.getUint32(central + 42, true);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint16(local + 8, true), 0, "editable package parts remain interoperable ZIP STORE entries");
    const size = view.getUint32(central + 24, true);
    const offset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.set(name, new TextDecoder().decode(bytes.slice(offset, offset + size)));
    central += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const xmlText = (value) => value
  .replaceAll("&quot;", "\"")
  .replaceAll("&apos;", "'")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&amp;", "&");

function editableShapes(xml) {
  return [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/gu)].map(([, shape]) => ({
    name: xmlText(shape.match(/<p:cNvPr\b[^>]*\bname="([^"]*)"/u)?.[1] ?? ""),
    text: [...shape.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gu)]
      .map(([, value]) => xmlText(value))
      .join("\n"),
  }));
}

function actualPdfText(source) {
  return [...source.matchAll(/\/ActualText\s*<([\da-fA-F]+)>/gu)].map(([, encoded]) => {
    const bytes = Buffer.from(encoded, "hex");
    return bytes.swap16().toString("utf16le").replace(/^\ufeff/u, "");
  });
}

const issueCodes = (issues) => new Set(issues.map((issue) => issue.code));

test("the authentic executive source retains all 12 exact inline slide headings and three authored boundaries", () => {
  const outline = inferPresentationSourceOutline(executive.snapshot);

  assert.equal(outline.authoredSlideCount, 12);
  assert.deepEqual(outline.slides.map((slide) => slide.number), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.deepEqual(outline.slides.map((slide) => slide.title), executive.expectedSlideTitles);
  assert.deepEqual(outline.slides.map((slide) => slide.sourceBlockId), [
    ...Array(4).fill("executive-opening"),
    ...Array(4).fill("executive-architecture"),
    ...Array(4).fill("executive-investment"),
  ]);
  assert.equal(outline.sections.length, 3);
  assert.deepEqual(outline.sections.map((section) => section.slideNumbers), [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]);
  assert.equal(executive.observedNativeArtifacts.length, 2);
  assert.ok(executive.observedNativeArtifacts.every((artifact) => artifact.observedScoreRows === 5));
});

test("the executive protected-source ledger preserves all six scores, exact precision, four quotations, terminology, and roadmap", () => {
  const contract = buildPresentationSourceContract(executive.snapshot);
  const scores = contract.protectedFacts.filter((fact) => fact.precision === "source");

  assert.deepEqual(scores.map(({ label, value }) => ({ label, value })), executive.scores);
  assert.equal(scores.reduce((sum, fact) => sum + Number(fact.value), 0) / scores.length, 61.125);
  assert.deepEqual(contract.protectedFacts.filter((fact) => fact.precision !== "source").map(({ precision, value, exactValue, displayValue }) => ({
    precision,
    value,
    exactValue,
    displayValue,
  })), [
    { precision: "exact", value: "61.125", exactValue: "61.125", displayValue: "61.13" },
    { precision: "display", value: "61.13", exactValue: "61.125", displayValue: "61.13" },
  ]);
  assert.deepEqual(contract.protectedQuotes.map(({ text, speaker, sourceBlockId }) => ({ text, speaker, sourceBlockId })), executive.quotes.map(({ text, speaker, sourceId }) => ({
    text,
    speaker,
    sourceBlockId: sourceId,
  })));
  assert.ok(contract.protectedQuotes[0].text.length > 120, "the historically truncated Product Owner quotation exceeds the former provider limit");
  assert.deepEqual(contract.protectedTerminology.map((family) => family.terms), [executive.destinations, executive.modes, ["Phone", "Tablet", "Small/snapped monitor", "Large monitor"]]);
  assert.deepEqual(contract.roadmaps.map((roadmap) => roadmap.value), executive.roadmaps);
});

test("provider-facing presentation contracts expose resolvable aliases while withholding durable source and chapter identifiers", () => {
  const executiveContract = buildPresentationSourceContract(executive.snapshot);
  const executiveProviderContract = providerFacingPresentationSourceContract(executiveContract);
  const executiveProviderJson = JSON.stringify(executiveProviderContract);

  assert.deepEqual(executiveProviderContract.sources.map((source) => source.alias), ["blk_001", "blk_002", "blk_003"]);
  for (const fact of executive.snapshot.facts) assert.equal(executiveProviderJson.includes(fact.block_id), false);
  assert.equal(executiveProviderJson.includes(executive.sourceDocumentId), false);
  assert.deepEqual(resolvePresentationSourceReferences(["blk_002"], executiveContract), {
    sourceIds: ["executive-architecture"],
    blockIds: ["executive-architecture"],
    contextGroupIds: [],
    sourceAliases: ["blk_002"],
    unknownReferences: [],
    valid: true,
  });
  const invented = resolvePresentationSourceReferences(["blk_002", "blk_999"], executiveContract);
  assert.equal(invented.valid, false);
  assert.deepEqual(invented.unknownReferences, ["blk_999"]);

  const managedContract = buildPresentationSourceContract(managed23.snapshot, { requestedSlideCount: 23 });
  const providerManaged = providerFacingPresentationSourceContract(managedContract);
  const providerManagedJson = JSON.stringify(providerManaged);
  assert.equal(providerManaged.sources.filter((source) => source.sourceKind === "context-group").length, 4);
  for (const fact of managed23.snapshot.facts) {
    assert.equal(providerManagedJson.includes(fact.block_id), false);
    for (const membership of fact.properties.combined_context_memberships) {
      assert.equal(providerManagedJson.includes(membership.context_set_id), false);
    }
  }
  const groupAlias = providerManaged.sources.find((source) => source.sourceKind === "context-group").alias;
  assert.deepEqual(resolvePresentationSourceReferences([groupAlias], managedContract).contextGroupIds, ["chapter-strategy"]);
});

test("managed planning preserves the actual 12-slide source, explains batching, and refuses silent authored-slide truncation", () => {
  const plan = buildManagedProductionPlan("slides", executive.snapshot);

  assert.equal(plan.authoredSlideCount, 12);
  assert.equal(plan.predictedSlideCount, 12);
  assert.equal(plan.requestedSlideCount, null);
  assert.equal(plan.slideCountMismatch, false);
  assert.deepEqual(plan.scenes.map((scene) => scene.title), executive.expectedSlideTitles);
  assert.ok(plan.scenes.every((scene) => scene.sourceBlockIds.length > 0));
  assert.deepEqual(plan.providerBatches.map((batch) => batch.slideCount), [8, 4]);
  assert.equal(plan.providerBatchCount, 2);
  assert.equal(plan.providerCallCount, 2);
  assert.ok(plan.maximumProviderCallCount >= plan.providerCallCount);
  assert.equal(plan.estimatedPlanningCostMicrousd, plan.providerBatches.reduce((total, batch) => total + batch.reservationMicrousd, 0));

  const shorter = buildManagedProductionPlan("slides", executive.snapshot, { requestedSlideCount: 8 });
  assert.equal(shorter.authoredSlideCount, 12);
  assert.equal(shorter.requestedSlideCount, 8);
  assert.equal(shorter.slideCountMismatch, true);
  assert.equal(shorter.predictedSlideCount, 12, "a managed production cannot silently discard four authored slide sections");
  assert.equal(shorter.slideCountMismatchReason, "requested_less_than_authored");

  const expanded = buildManagedProductionPlan("slides", executive.snapshot, { requestedSlideCount: 23 });
  assert.equal(expanded.predictedSlideCount, 23);
  assert.equal(expanded.slideCountMismatch, true);
  assert.equal(expanded.slideCountMismatchReason, "requested_more_than_authored");
  assert.deepEqual(expanded.scenes.slice(0, 12).map((scene) => scene.title), executive.expectedSlideTitles);
  assert.ok(expanded.scenes.slice(12).every((scene) => scene.sourceBlockIds.length > 0));
  assert.deepEqual(expanded.providerBatches.map((batch) => batch.slideCount), [8, 8, 7]);
});

test("an explicitly authored, independently scoped 23-slide managed presentation preserves every title, chapter, source, and provider batch", () => {
  const outline = inferPresentationSourceOutline(managed23.snapshot);
  const plan = buildManagedProductionPlan("slides", managed23.snapshot, { requestedSlideCount: managed23.requestedSlideCount });

  assert.equal(outline.authoredSlideCount, 23);
  assert.deepEqual(outline.slides.map((slide) => slide.title), managed23.expectedSlideTitles);
  assert.deepEqual(outline.sections.map((section) => section.slideNumbers.length), [6, 6, 6, 5]);
  assert.equal(plan.authoredSlideCount, 23);
  assert.equal(plan.requestedSlideCount, 23);
  assert.equal(plan.predictedSlideCount, 23);
  assert.equal(plan.slideCountMismatch, false);
  assert.equal(plan.scenes.length, 23);
  assert.deepEqual(plan.scenes.map((scene) => scene.title), managed23.expectedSlideTitles);
  assert.ok(plan.scenes.every((scene) => scene.sourceBlockIds.length && scene.contextGroupIds.length));
  assert.deepEqual(plan.providerBatches.map(({ startSlide, endSlide, slideCount }) => ({ startSlide, endSlide, slideCount })), [
    { startSlide: 1, endSlide: 8, slideCount: 8 },
    { startSlide: 9, endSlide: 16, slideCount: 8 },
    { startSlide: 17, endSlide: 23, slideCount: 7 },
  ]);
  assert.equal(plan.estimatedPlanningCostMicrousd, 3_000_000);
  assert.match(managed23.referenceProvenance, /produced outside Forma/u);
});

test("canonical presentation normalization preserves complete six-point scorecards, complete attributed quotes, precise labels, and source evidence", () => {
  const sourceId = "executive-opening";
  const quote = executive.quotes[0];
  const normalized = normalizeSlideVisual({
    layout: "scorecard",
    kicker: "Independent assessment",
    quote: { text: quote.text, speaker: quote.speaker, role: quote.speaker, sourceId, citation: "Authored slide 4" },
    citations: [{ sourceId, label: "Authorized executive source", anchor: "Authored slide 2", excerpt: "Six-goal assessment" }],
    sourceIds: [sourceId],
    section: "Executive opportunity",
    sourceOrder: 2,
    bullets: [],
    visual: {
      kind: "scorecard",
      label: "Independent assessment",
      value: "61.13 / 100",
      exactValue: "61.125",
      displayValue: "61.13",
      unit: "/100",
      data: executive.scores.map(({ label, value }) => ({ label, value, weight: Number(value) / 100, sourceIds: [sourceId] })),
    },
  }, { title: "Product performance", body: "The independent evidence is protected." }, 1);

  assert.equal(normalized.visual.data.length, 6);
  assert.deepEqual(normalized.visual.data.map(({ label, value }) => ({ label, value })), executive.scores);
  assert.equal(normalized.visual.exactValue, executive.average.exact);
  assert.equal(normalized.visual.displayValue, executive.average.display);
  assert.equal(normalized.quote.text, quote.text);
  assert.equal(normalized.quote.speaker, quote.speaker);
  assert.deepEqual(slideSourceIds(normalized), [sourceId]);
  assert.deepEqual(slidePrecisionIssues(normalized), []);
});

test("derives percentage-scaled assessment geometry from exact scores and rejects forged source score weights",()=>{
  const forged=normalizeSlideVisual({layout:"scorecard",kicker:"Evidence",bullets:[],visual:{kind:"scorecard",label:"Source scores",value:"",unit:"/100",data:executive.scores.map(({label,value},index)=>({label,value,weight:index===0?1:.1}))}},{title:"Responsive assessment",body:"Each score uses the authored 100-point scale."});
  assert.deepEqual(forged.visual.data.map(({weight})=>weight),executive.scores.map(({value})=>Number(value)/100));
  forged.visual.data[0].weight=1;
  assert.ok(slidePrecisionIssues(forged).some((issue)=>issue.code==="inconsistent_scorecard_weight"));

  const {contract,draft}=buildFaithfulDraft(executive);
  const scorecard=draft.items.find((item)=>item.slide?.visual.kind==="scorecard");
  assert.ok(scorecard);
  delete scorecard.slide.visual.unit;
  scorecard.slide.visual.data[0].weight=1;
  assert.ok(validatePresentationSourceCoverage(draft.items,contract,{requireEverySlideSource:true,requireAllProtectedContent:true}).some((issue)=>issue.code==="inconsistent_scorecard_weight"));

  const qualitative=normalizeSlideVisual({layout:"timeline",kicker:"Plan",bullets:[],visual:{kind:"timeline",label:"Delivery",value:"",data:[{label:"Foundation",value:"4 weeks",weight:.2},{label:"Release",value:"8 weeks",weight:.8}]}},{title:"Roadmap",body:"Relative emphasis stays authored."});
  assert.deepEqual(qualitative.visual.data.map(({weight})=>weight),[.2,.8]);
});

test("rejects speaker-note and Markdown score contradictions even when every visible score remains correct",()=>{
  const {contract,draft}=buildFaithfulDraft(executive);
  draft.items[1].notes="Phone: 79.50. Governed creative loop: 39.75.";
  draft.content_markdown+= "\nPhone: 79.50.";
  const issues=documentArtifactValidationIssues("slides",draft,{itemCount:12,sourceContract:contract,requireSourceGrounding:true,requireAllProtectedContent:true});
  assert.ok(issues.some((issue)=>issue.code==="mislabeled_narrative_fact"&&issue.path==="items.1.notes"));
  assert.ok(issues.some((issue)=>issue.code==="mislabeled_narrative_fact"&&issue.path==="content_markdown"));
});

test("complete authored presentations validate all visible protected content and reject the exact native score, quote, precision, and provenance failures", () => {
  const { contract, draft } = buildFaithfulDraft(executive);
  const validate = (candidate) => documentArtifactValidationIssues("slides", candidate, {
    itemCount: 12,
    sourceContract: contract,
    requireSourceGrounding: true,
  });

  assert.deepEqual(validate(draft), []);
  assert.deepEqual(validatePresentationSourceCoverage(draft.items, contract, { requireEverySlideSource: true }), []);
  assert.equal(draft.items.length, 12);
  assert.ok(draft.items.every((item) => slideSourceIds(item).length));
  assert.equal(draft.items.filter((item) => item.slide.quote).length, 4);
  for (const quote of executive.quotes) {
    const visible = draft.items.find((item) => item.slide.quote?.text === quote.text);
    assert.ok(visible, `the complete ${quote.speaker} quotation is visible in a first-class quote card`);
    assert.equal(visible.slide.quote.role, quote.speaker);
    assert.match(visible.notes, new RegExp(quote.text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.ok(draft.content_markdown.includes(quote.text));
  }

  const fiveRows = structuredClone(draft);
  fiveRows.items[1].slide.visual.data.pop();
  const rowIssues = issueCodes(validate(fiveRows));
  assert.ok(rowIssues.has("inconsistent_scorecard_average"));
  assert.ok(rowIssues.has("missing_scorecard_datum"));
  assert.ok(rowIssues.has("missing_protected_fact"));

  const reversed = structuredClone(draft);
  reversed.items[1].body = "Exact equal-weight average: 61.13 / 100; rounded displayed average: 61.125 / 100.";
  reversed.items[1].slide.visual.exactValue = "61.13";
  reversed.items[1].slide.visual.displayValue = "61.125";
  const precisionIssues = issueCodes(validate(reversed));
  assert.ok(precisionIssues.has("reversed_precision_labels"));
  assert.ok(precisionIssues.has("incorrect_exact_value"));
  assert.ok(precisionIssues.has("incorrect_display_value"));
  assert.ok(precisionIssues.has("reversed_numeric_precision"));

  const truncated = structuredClone(draft);
  const quoteSlide = truncated.items[3];
  quoteSlide.slide.quote.text = executive.observedNativeArtifacts[1].truncatedVisibleQuote.replace(/^“/u, "");
  quoteSlide.slide.visual.value = quoteSlide.slide.quote.text;
  assert.ok(quoteSlide.notes.includes(executive.quotes[0].text), "hidden speaker notes still retain the full quote");
  assert.ok(issueCodes(validate(truncated)).has("missing_protected_quote"), "complete hidden notes cannot excuse a visibly clipped quotation");

  const ungrounded = structuredClone(draft);
  ungrounded.items[0].slide.sourceIds = [];
  ungrounded.items[0].slide.citations = [];
  const groundingIssues = issueCodes(validate(ungrounded));
  assert.ok(groundingIssues.has("missing_source_grounding"));
  assert.ok(groundingIssues.has("missing_slide_source"));

  const invented = structuredClone(draft);
  invented.items[0].slide.sourceIds = ["invented_provider_reference"];
  invented.items[0].slide.citations = [];
  assert.ok(issueCodes(validate(invented)).has("unknown_source_reference"));
});

test("authorized presenter PowerPoint exports retain exact scores and quotes while separating private evidence from audience slides", () => {
  const { draft } = buildFaithfulDraft(executive);
  const archive = storedZipEntries(createPowerPointDocument(draft.items, draft.presentation, {
    title: draft.title,
    showFooterLabel: true,
    includePresenterNotes: true,
  }));

  assert.equal([...archive.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).length, 12);
  assert.equal([...archive.keys()].filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(name)).length, 12);
  const scoreShapes = editableShapes(archive.get("ppt/slides/slide2.xml"));
  executive.scores.forEach(({ label, value }, index) => {
    assert.equal(scoreShapes.find((shape) => shape.name === `Editable score label ${index + 1}`)?.text, label);
    assert.equal(scoreShapes.find((shape) => shape.name === `Editable score value ${index + 1}`)?.text, `${value} /100`);
    assert.ok(scoreShapes.some((shape) => shape.name === `Editable score bar ${index + 1}`));
  });
  assert.ok(scoreShapes.some((shape) => shape.name === "Editable exact value" && shape.text === "61.125"));
  assert.ok(scoreShapes.some((shape) => shape.name === "Editable displayed value" && shape.text === "61.13"));

  for (const [index, item] of draft.items.entries()) {
    const slide = archive.get(`ppt/slides/slide${index + 1}.xml`);
    const notes = archive.get(`ppt/notesSlides/notesSlide${index + 1}.xml`);
    const shapes = editableShapes(slide);
    assert.equal(shapes.find((shape) => shape.name === "Editable slide title")?.text, item.title);
    assert.equal(shapes.some((shape) => shape.name.startsWith("Editable evidence citation")), false, `slide ${index + 1} does not expose internal source metadata to its audience`);
    assert.doesNotMatch(slide, /Authorized executive source/u, `slide ${index + 1} keeps internal provenance backstage`);
    assert.match(notes, /\[Sources\]/u);
    assert.match(notes, /Authorized executive source/u, `slide ${index + 1} retains full provenance in explicitly authorized presenter notes`);
    if (item.slide.quote) {
      assert.equal(shapes.find((shape) => shape.name === "Editable quotation")?.text, item.slide.quote.text);
      assert.ok(shapes.find((shape) => shape.name === "Editable quotation attribution")?.text.includes(item.slide.quote.role));
      assert.ok(xmlText(notes).includes(item.slide.quote.text));
    }
    for (const fact of executive.snapshot.facts) {
      assert.equal(slide.includes(fact.block_id), false);
      assert.equal(notes.includes(fact.block_id), false);
    }
  }

  const roadmapShapes = editableShapes(archive.get("ppt/slides/slide11.xml"));
  assert.ok(roadmapShapes.some((shape) => shape.name === "Editable quotation"));
  assert.ok(roadmapShapes.some((shape) => shape.name === "Editable timeline value 1" && shape.text === "4–6 weeks"));
  assert.ok(roadmapShapes.some((shape) => shape.name === "Editable timeline value 2" && shape.text === "12–16 weeks"));
});

test("programmatic presentation PDFs retain scores, precision, searchable quotations, and roadmaps without internal citations", () => {
  const { draft } = buildFaithfulDraft(executive);
  const result = createPresentationPdf(draft.items, draft.presentation, { title: draft.title, showFooterLabel: true });
  const pdf = new TextDecoder().decode(result.bytes);
  const searchable = actualPdfText(pdf);

  assert.equal(result.pageCount, 12);
  assert.match(pdf, /\/Count 12\b/u);
  for (const { label, value } of executive.scores) {
    assert.ok(pdf.includes(label), `the PDF retains the ${label} score label`);
    assert.ok(pdf.includes(value), `the PDF retains the exact ${label} score ${value}`);
  }
  assert.ok(pdf.includes("61.125"));
  assert.ok(pdf.includes("61.13"));
  for (const quote of executive.quotes) {
    assert.ok(searchable.includes(quote.text), `the PDF retains searchable verbatim ${quote.speaker} quotation text`);
    assert.ok(pdf.includes(quote.speaker), `the PDF visibly attributes the ${quote.speaker} quotation`);
  }
  assert.ok(pdf.includes("4-6 weeks"));
  assert.ok(pdf.includes("12-16 weeks"));
  assert.equal(pdf.includes("Authorized executive source"), false, "audience-facing PDF pages do not expose internal provenance");
  for (const fact of executive.snapshot.facts) assert.equal(pdf.includes(fact.block_id), false);
});

test("browser-captured PDF reading alternatives preserve tagged searchable six-score and full-quotation evidence", () => {
  const quote = executive.quotes[0];
  const body = [
    "Independent source-grounded product assessment",
    ...executive.scores.map(({ label, value }) => `${label}: ${value}`),
    "Exact equal-weight average: 61.125",
    "Rounded displayed average: 61.13",
    `“${quote.text}” — ${quote.speaker}`,
    "Projects / Work / Explore / Activity / Deliver",
    "Write / Shape / Present",
    "First release: 4–6 weeks; full program: 12–16 weeks",
  ];
  const result = createPresentationPdfFromRenderedSlides([{
    width: 1,
    height: 1,
    bytes: deflateSync(Uint8Array.from([237, 241, 239])),
    heading: "Independent source-grounded product assessment",
    bullets: executive.scores.map(({ label, value }) => `${label}: ${value}`),
    text: body.join("\n"),
    language: "en-US",
    direction: "ltr",
  }], { title: "Accessible executive evidence", language: "en-US" });
  const source = Buffer.from(result.bytes).toString("latin1");
  const searchable = actualPdfText(source).join("");

  assert.equal(result.pageCount, 1);
  assert.match(source, /\/StructTreeRoot\s+\d+\s+0\s+R/u);
  assert.match(source, /\/MarkInfo\s*<<\s*\/Marked true/u);
  assert.match(source, /\/S \/H1/u);
  assert.equal((source.match(/\/S \/LI\b/gu) ?? []).length, 6);
  for (const score of executive.scores) assert.ok(searchable.includes(`${score.label}: ${score.value}`));
  assert.ok(searchable.includes(quote.text));
  assert.ok(searchable.includes(quote.speaker));
});

test("the complete explicit 23-slide managed draft stays source-grounded and exports 23 editable slides, 23 notes, and 23 PDF pages", () => {
  const { contract, draft, plan } = buildFaithfulDraft(managed23);
  const expectedGroups = plan.contextGroups.map((group) => group.id);
  const issues = documentArtifactValidationIssues("slides", draft, {
    itemCount: 23,
    contextGroupIds: expectedGroups,
    sourceContract: contract,
    requireSourceGrounding: true,
  });

  assert.deepEqual(issues, []);
  assert.deepEqual(draft.items.map((item) => item.title), managed23.expectedSlideTitles);
  assert.ok(draft.items.every((item) => item.context_group_ids.length && slideSourceIds(item).length));

  const archive = storedZipEntries(createPowerPointDocument(draft.items, draft.presentation, { title: draft.title }));
  assert.equal([...archive.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).length, 23);
  assert.equal([...archive.keys()].filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(name)).length, 23);
  assert.equal(editableShapes(archive.get("ppt/slides/slide23.xml")).find((shape) => shape.name === "Editable slide title")?.text, managed23.expectedSlideTitles[22]);
  const pdf = createPresentationPdf(draft.items, draft.presentation, { title: draft.title });
  assert.equal(pdf.pageCount, 23);
  assert.match(new TextDecoder().decode(pdf.bytes), /\/Count 23\b/u);
});
