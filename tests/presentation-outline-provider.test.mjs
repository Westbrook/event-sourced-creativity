import assert from "node:assert/strict";
import test from "node:test";

import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { presentationAudienceItem } from "../src/model/presentation-delivery.ts";
import { assessStoredPresentationCandidate, generateDocumentArtifact, PRESENTATION_ADAPTER_VERSION } from "../worker/openai-adapter.ts";
import { PAID_PROVIDER_FINANCIAL_FIELDS } from "../src/model/provider-submission.ts";

// Paid response and validation completion are snapshots of one immutable charge.
function completedProviderCalls(submissions) {
  const calls = new Map();
  const financial = (receipt) => Object.fromEntries(PAID_PROVIDER_FINANCIAL_FIELDS.filter((key) => Object.hasOwn(receipt, key)).map((key) => [key, receipt[key]]));
  for (const receipt of submissions.filter((entry) => entry.status === "completed")) {
    const previous = calls.get(receipt.clientRequestId);
    if (previous) assert.deepEqual(financial(receipt), financial(previous), "validation progress cannot rewrite an already observed charge");
    calls.set(receipt.clientRequestId, receipt);
  }
  return [...calls.values()];
}

// Newly authored deterministic fixtures, never retained provider drafts or a live Document.
const research = [
  {
    id: "PRIVATE_OUTLINE_CURRENT",
    label: "Current limits and proposed output requirements",
    title: "Current and proposed work",
    coverage: "Explain current limits and proposed output requirements.",
    body: "Current limits permit one ad hoc output at a time. Proposed output requirements would track owed work alongside accepted results.",
    emphasis: "Define the obligation",
  },
  {
    id: "PRIVATE_OUTLINE_RESPONSIBILITIES",
    label: "Linked responsibilities",
    title: "Linked responsibilities",
    coverage: "Cover context, output requirements, confirmed plan, variants, attempts, verification, and delivery.",
    body: "Context and output requirements inform a confirmed plan. Variants lead to attempts; verification distinguishes accepted results from delivery.",
    emphasis: "Keep responsibilities connected",
  },
  {
    id: "PRIVATE_OUTLINE_VARIANTS",
    label: "Required image ratios and video ratios",
    title: "The actual request",
    coverage: "Show image ratios and video ratios, optional square video, and unsupported work.",
    body: "Required image ratios are 1:1, 4:5, 3:4, 9:16, and 16:9. Required video ratios are 4:5, 9:16, and 16:9. Optional square video is unselected; unsupported work must remain visible.",
    emphasis: "Variants are not file count",
  },
  {
    id: "PRIVATE_OUTLINE_LOOP",
    label: "Selective retry and partial review",
    title: "The end-user loop",
    coverage: "Include selective retry, partial review, and no spend on save.",
    body: "Authors confirm selected creation, inspect partial results, and perform partial review. Selective retry preserves successes. No spend on save is a required control.",
    emphasis: "Authorize each selected step",
  },
  {
    id: "PRIVATE_OUTLINE_EDITS",
    label: "Shared fact changes and isolated target edits",
    title: "Changes after an edit",
    coverage: "Explain shared fact changes, isolated target edits, and unrelated approvals.",
    body: "Proposed shared fact changes affect dependent results. Proposed isolated target edits affect only that target. Optional work preserves unrelated approvals.",
    emphasis: "Dependencies govern freshness",
  },
  {
    id: "PRIVATE_OUTLINE_PILOT",
    label: "Image pilot capability gates and proposed usability measures",
    title: "Pilot and decision",
    coverage: "Scope the image pilot, capability gates, and proposed usability measures.",
    body: "The proposed image pilot checks capability gates before execution. Proposed usability measures target 4 of 5 uncoached authors in 3 minutes. These targets remain unmeasured.",
    emphasis: "Decide the next experiment",
  },
];

function outlineSnapshot({ withResearch = true } = {}) {
  return {
    document_id: "PRIVATE_OUTLINE_DOCUMENT",
    facts: [
      ...(withResearch ? research.map((source) => ({
        block_id: source.id,
        type: "message",
        intent: "include",
        properties: { label: source.label, text: `${source.body} ${source.emphasis}.` },
      })) : []),
      {
        block_id: "PRIVATE_OUTLINE_UNRELATED",
        type: "message",
        intent: "include",
        properties: { label: "Orchard maintenance", text: "Seasonal pruning keeps the north orchard healthy." },
      },
      {
        block_id: "PRIVATE_OUTLINE_FORMAT",
        type: "format",
        intent: "include",
        properties: {
          label: "Required supporting outputs",
          text: [
            "Required supporting output 1: Executive Slides",
            "Exactly 6 slides; faithful native structured presentation in field-notes styling. No generated images, soundtrack, or paid media.",
            ...research.map((source, index) => `Slide ${index + 1}: ${source.title}. ${source.coverage}`),
            "",
            "Required supporting output 2: Scripted Scene",
            "A clearly fictional scene with the characters Linden, Maris, and Opal at an imaginary orchard festival.",
            "The final scene beat follows a missing-square screenplay specification and must never be treated as presentation research.",
          ].join("\n"),
        },
      },
      {
        block_id: "PRIVATE_OUTLINE_EXCLUSION",
        type: "exclusion",
        intent: "avoid",
        properties: { text: "Do not invent measured results or claim the proposed workflow was tested." },
      },
    ],
    relationships: [],
  };
}

const options = { itemCount: 6, requestedSlideCount: 6, presentationStyle: "field-notes", presentationFidelity: "faithful" };

function contractFor(snapshot = outlineSnapshot()) {
  return buildPresentationSourceContract(snapshot, options);
}

function outputFor(snapshot = outlineSnapshot()) {
  const contract = contractFor(snapshot);
  const alias = (id) => contract.sources.find((source) => source.sourceId === id)?.alias;
  const items = research.map((source, index) => ({
    title: source.title,
    body: source.body,
    notes: `Discuss the authorized research: ${source.body}`,
    image_prompt: "Native editable text composition; no generated media.",
    context_group_ids: [],
    slide: {
      layout: index === research.length - 1 ? "closing" : "statement",
      kicker: ["Baseline", "Dependencies", "Variants", "Workflow", "Freshness", "Launch"][index],
      bullets: [],
      quote: null,
      citations: [{ source_id: alias(source.id), label: source.label, anchor: "Shared research", excerpt: source.body }],
      source_ids: [alias(source.id)],
      section: null,
      source_order: index + 1,
      visual: { kind: "hero-type", label: "", value: source.emphasis, exact_value: null, display_value: null, unit: null, data: [] },
    },
  }));
  return {
    title: "Output requirements decision brief",
    summary: "Current limits and a proposed path from requirements to delivery.",
    content_markdown: items.map((item, index) => `## ${index + 1}. ${item.title}\n${item.body}\n${item.slide.visual.value}`).join("\n\n"),
    presentation: {
      aspect_ratio: "16:9",
      theme: "Output requirements field notes",
      footer_label: "Output requirements decision brief",
      style_preset: "field-notes",
      mode: "light",
      palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" },
    },
    items,
  };
}

function mockProvider(context, outputs) {
  const requests = [];
  context.mock.method(globalThis, "fetch", async (url, init = {}) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(init.method, "POST");
    assert.ok(requests.length < outputs.length, "the adapter may not exceed the explicitly supplied mock responses");
    const request = JSON.parse(String(init.body));
    requests.push({ request, input: JSON.parse(request.input) });
    return Response.json({
      id: `outline-response-${requests.length}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify(outputs[requests.length - 1]),
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    });
  });
  return requests;
}

const generate = (snapshot = outlineSnapshot(), extraOptions = {}) => generateDocumentArtifact(
  { OPENAI_API_KEY: "deterministic-test-key", OPENAI_MODEL: "gpt-5.6-terra" },
  "deterministic-test-author",
  "slides",
  { documentTitle: "Output requirements decision brief", snapshot, options: { ...options, ...extraOptions } },
);

function assertScopedRequest({ request, input }) {
  const payload = JSON.stringify(input);
  assert.doesNotMatch(payload, /PRIVATE_OUTLINE_/u, "durable source identifiers remain local");
  assert.doesNotMatch(payload, /Linden|Maris|Opal|missing-square screenplay|Scripted Scene/u, "sibling output prose is not sent as presentation content");
  assert.match(payload, /Do not invent measured results/u, "negative constraints remain binding");
  assert.match(request.instructions, /evidencePassageIds.*presentation_source\.passages/u);
  assert.match(request.instructions, /one contiguous quotation in its own resolved cited passage/u);
  assert.match(request.instructions, /truthful research section label or an empty citation\.anchor/u);
  assert.match(request.instructions, /coverageRequirement.*audience-facing/u);
  assert.doesNotMatch(request.instructions, /quotation from (?:its own assigned|that exact) authored numbered slide/u);
  assert.deepEqual(input.presentation_source.outline.map((slide) => slide.title), research.map((source) => source.title));
}

test("real adapter accepts permitted research passages for a six-slide outline without including the sibling Scene", async (context) => {
  const snapshot = outlineSnapshot();
  const contract = contractFor(snapshot);
  assert.deepEqual(contract.sourceIssues, []);
  assert.equal(contract.schemaVersion, 2);
  assert.equal(contract.numberedOutline.length, 6);
  for (const [index, slide] of contract.numberedOutline.entries()) {
    assert.equal(slide.sourceMode, "outline");
    assert.equal(slide.sourceBlockId, "PRIVATE_OUTLINE_FORMAT", "requirement ownership is distinct from supporting evidence");
    const evidence = contract.passages.filter((passage) => slide.evidencePassageIds.includes(passage.id));
    assert.ok(evidence.some((passage) => passage.sourceBlockId === research[index].id));
    assert.ok(evidence.every((passage) => passage.sourceBlockId !== "PRIVATE_OUTLINE_UNRELATED"));
  }
  const localAssessment = assessStoredPresentationCandidate(JSON.stringify(outputFor(snapshot)), snapshot, options);
  assert.deepEqual(localAssessment.issues, [], "the full contract accepts each allowed cited passage before the mocked request");
  const requests = mockProvider(context, [outputFor(snapshot)]);
  const result = await generate(snapshot);
  assert.equal(requests.length, 1);
  assertScopedRequest(requests[0]);
  assert.equal(result.inputReceipt.validation.repair_attempted, false);
  assert.deepEqual(result.inputReceipt.validation.initial_issues, []);
  assert.equal(result.inputReceipt.validation.adapter_reconciliation.adapter_version, PRESENTATION_ADAPTER_VERSION);
  assert.deepEqual(result.output.items.map((item) => item.title), research.map((source) => source.title));
  assert.doesNotMatch(JSON.stringify(result.output), /Linden|Maris|Opal|Scope the image pilot/u);
  for (const [index, item] of result.output.items.entries()) assert.ok(item.slide.sourceIds.includes(research[index].id));
});

test("the bounded repair receives the same scoped passages and resolves an invalid excerpt without changing attribution", async (context) => {
  const invalid = outputFor();
  invalid.items[0].slide.citations[0].excerpt = "An invented finding says every deliverable is complete.";
  const requests = mockProvider(context, [invalid, outputFor()]);
  const result = await generate();
  assert.equal(requests.length, 2);
  requests.forEach(assertScopedRequest);
  assert.equal(requests[1].request.text.format.name, "document_slides_repair");
  assert.ok(requests[1].input.validation_issues.some((issue) => issue.code === "ungrounded_citation_excerpt"));
  assert.deepEqual(requests[1].input.presentation_source, requests[0].input.presentation_source);
  assert.equal(result.inputReceipt.validation.repair_attempted, true);
  assert.deepEqual(result.inputReceipt.validation.repair_issues, []);
  assert.deepEqual(result.usage, { inputTokens: 240, outputTokens: 160, totalTokens: 400 });
});

test("correct passage anchors survive adapter validation unchanged and are hidden only in audience projections", async (context) => {
  const snapshot = outlineSnapshot();
  const contract = contractFor(snapshot);
  const output = outputFor(snapshot);
  for (const [index, item] of output.items.entries()) {
    item.slide.citations[0].anchor = contract.passages.find((passage) => passage.sourceBlockId === research[index].id).id;
  }
  const requests = mockProvider(context, [output]);
  const result = await generate(snapshot);
  assert.equal(requests.length, 1);
  assert.deepEqual(result.output.items.map((item) => item.slide.citations[0].anchor), output.items.map((item) => item.slide.citations[0].anchor));
  const before = structuredClone(result.output);
  for (const item of result.output.items) assert.doesNotMatch(JSON.stringify(presentationAudienceItem(item).slide.citations), /passage_\d+/u);
  assert.deepEqual(result.output, before);
});

for (const defect of [
  {
    name: "a quotation from the wrong permitted source",
    mutate(output) { output.items[0].slide.citations[0].excerpt = research[1].body; },
    code: "ungrounded_citation_excerpt",
  },
  {
    name: "an altered numerical citation",
    mutate(output) { output.items[2].slide.citations[0].excerpt = research[2].body.replace("1:1", "2:1"); },
    code: "ungrounded_citation_excerpt",
  },
  {
    name: "a changed visible ratio with an unchanged exact citation",
    mutate(output) { output.items[2].body = research[2].body.replace("1:1", "2:1"); },
    code: "unsupported_outline_number",
  },
  {
    name: "attribution to unrelated authorized evidence",
    mutate(output) { output.items[0].slide.citations[0].source_id = contractFor().sources.find((source) => source.sourceId === "PRIVATE_OUTLINE_UNRELATED").alias; },
    code: "incorrect_citation_source",
  },
  {
    name: "an extra unassigned source alongside a valid citation",
    mutate(output) { output.items[0].slide.source_ids.push(contractFor().sources.find((source) => source.sourceId === "PRIVATE_OUTLINE_UNRELATED").alias); },
    code: "incorrect_slide_source",
  },
  {
    name: "supporting research mislabeled as an authored slide passage",
    mutate(output) { output.items[0].slide.citations[0].anchor = "Authored slide 1"; },
    code: "incorrect_citation_anchor",
  },
  {
    name: "a private passage anchor belonging to different research",
    mutate(output) { output.items[0].slide.citations[0].anchor = contractFor().passages.find((passage) => passage.sourceBlockId === research[1].id).id; },
    code: "incorrect_citation_anchor",
  },
]) {
  test(`real outline adapter rejects ${defect.name} after one repair and retains both charges`, async (context) => {
    const invalid = outputFor();
    defect.mutate(invalid);
    const requests = mockProvider(context, [invalid, invalid]);
    const attempts = [], submissions = [];
    let accepted;
    await assert.rejects(async () => {
      accepted = await generate(outlineSnapshot(), {
        onProviderAttempt: (receipt) => attempts.push(receipt),
        onProviderSubmission: (receipt) => submissions.push(structuredClone(receipt)),
      });
    }, (error) => {
      assert.equal(error.detail?.code, "source_fidelity_validation_failed");
      assert.ok(error.detail.validationIssues.some((issue) => issue.stage === "repair" && issue.code === defect.code));
      assert.equal(error.providerCallCount, 2);
      assert.deepEqual(error.providerResponseIds, ["outline-response-1", "outline-response-2"]);
      assert.deepEqual(error.providerUsage, { inputTokens: 240, outputTokens: 160, totalTokens: 400 });
      const completed = completedProviderCalls(submissions);
      assert.deepEqual(completed.map((receipt) => receipt.providerRequestId), error.providerResponseIds);
      const actualCost = completed.reduce((total, receipt) => total + receipt.costMicrousd, 0);
      assert.equal(actualCost, 2400, "failure accounting preserves each immutable paid call once for route settlement");
      assert.doesNotMatch(JSON.stringify(error.detail), /PRIVATE_OUTLINE_/u);
      return true;
    });
    assert.equal(accepted, undefined, "rejected responses never become accepted artifacts");
    assert.equal(requests.length, 2);
    assert.deepEqual(attempts.map((receipt) => receipt.usage.totalTokens), [200, 400]);
    assert.deepEqual(submissions.map((receipt) => receipt.status), ["pending", "completed", "completed", "pending", "completed", "completed"]);
    assert.deepEqual(submissions.filter((receipt) => receipt.status === "completed").map((receipt) => receipt.validationStatus), ["pending", "invalid", "pending", "invalid"]);
  });
}

test("unresolved outline evidence fails before provider preflight, submission, or spend", async (context) => {
  const requests = mockProvider(context, []);
  let preflights = 0, submissions = 0;
  const snapshot = outlineSnapshot({ withResearch: false });
  assert.ok(contractFor(snapshot).sourceIssues.length);
  await assert.rejects(generate(snapshot, {
    onBeforeProviderAttempt: () => { preflights += 1; },
    onProviderSubmission: () => { submissions += 1; },
  }), (error) => {
    assert.equal(error.detail?.code, "presentation_source_contract_invalid");
    assert.equal(error.detail?.httpStatus, 422);
    assert.match(error.detail?.message ?? "", /No provider request was made/u);
    assert.equal(error.providerCallCount, undefined);
    return true;
  });
  assert.equal(requests.length, 0);
  assert.equal(preflights, 0);
  assert.equal(submissions, 0);
});

test("valid citations and complete notes do not excuse missing visible outline coverage", async (context) => {
  const invalid = outputFor();
  invalid.items[2].body = "The requirements remain under review.";
  const requests = mockProvider(context, [invalid, invalid]);
  await assert.rejects(generate(), (error) => {
    assert.equal(error.detail?.code, "source_fidelity_validation_failed");
    assert.ok(error.detail.validationIssues.some((issue) => issue.stage === "repair" && /coverage/u.test(issue.code)));
    assert.ok(error.detail.validationIssues.every((issue) => issue.code !== "ungrounded_citation_excerpt"), "coverage and quotation integrity are independent checks");
    return true;
  });
  assert.equal(requests.length, 2);
});

test("an outline's authoring directions cannot become its visible title after repair", async (context) => {
  const invalid = outputFor();
  invalid.items[5].title = contractFor().numberedOutline[5].content;
  const requests = mockProvider(context, [invalid, invalid]);
  await assert.rejects(generate(), (error) => {
    assert.equal(error.detail?.code, "source_fidelity_validation_failed");
    assert.ok(error.detail.validationIssues.some((issue) => issue.stage === "repair" && /title|authoring/u.test(issue.code)));
    return true;
  });
  assert.equal(requests.length, 2);
});

test("a valid citation cannot authenticate an invented attributed quotation from the same permitted research", async (context) => {
  const invalid = outputFor();
  const item = invalid.items[0];
  const text = "Every obligation is already delivered with certified universal completeness.";
  item.slide.layout = "quote";
  item.slide.quote = { text, speaker: "Independent reviewer", role: "Independent reviewer", source_id: item.slide.source_ids[0], citation: item.slide.citations[0].label };
  item.slide.visual = { ...item.slide.visual, kind: "quote", value: text };
  item.notes += `\nIndependent reviewer: “${text}”`;
  invalid.content_markdown += `\n\n> ${text}\n> — Independent reviewer`;
  const requests = mockProvider(context, [invalid, invalid]);
  await assert.rejects(generate(), (error) => {
    assert.equal(error.detail?.code, "source_fidelity_validation_failed");
    assert.ok(error.detail.validationIssues.some((issue) => issue.stage === "repair" && /quote/u.test(issue.code)));
    assert.ok(error.detail.validationIssues.every((issue) => issue.code !== "ungrounded_citation_excerpt"), "the citation is exact; the quotation is the separate defect");
    return true;
  });
  assert.equal(requests.length, 2);
});

for (const mixed of [false, true]) {
  test(`a ${mixed ? "mixed" : "sibling-only"} Combined Context group stops before sibling prose or spend reaches a provider`, async (context) => {
    const snapshot = outlineSnapshot();
    const membership = {
      context_set_id: "PRIVATE_OUTLINE_SIBLING_GROUP",
      name: "Fictional scene cast",
      target: "Fictional scene",
      role: "scene",
      application: "co_locate",
      relativity: 1,
      member_order: 0,
    };
    snapshot.facts.push({
      block_id: "PRIVATE_OUTLINE_SIBLING_BLOCK",
      type: "format",
      intent: "include",
      properties: {
        text: "Required supporting output 2: Scripted Scene\nLinden enters the orchard, speaks to Maris and Opal, and opens the fictional festival.",
        combined_context_memberships: [membership],
      },
    });
    if (mixed) snapshot.facts[0].properties.combined_context_memberships = [{ ...membership, member_order: 1 }];
    assert.deepEqual(contractFor(snapshot).sourceIssues, [], "the evidence mapping itself is resolved; the binding sibling group is the distinct conflict");
    const assessment = assessStoredPresentationCandidate(JSON.stringify(outputFor(snapshot)), snapshot, options);
    assert.ok(assessment.issues.some((issue) => issue.code === "ambiguous_presentation_context_group"), "private reassessment uses the same output-scope gate");
    const requests = mockProvider(context, []);
    const submissions = [];
    await assert.rejects(generate(snapshot, { onProviderSubmission: (receipt) => submissions.push(receipt) }), (error) => {
      assert.equal(error.detail?.code, "presentation_source_contract_invalid");
      assert.match(error.detail?.message ?? "", /Combined Context group.*sibling output/u);
      assert.match(error.detail?.message ?? "", /No provider request was made/u);
      assert.doesNotMatch(JSON.stringify(error.detail), /PRIVATE_OUTLINE_|Linden|Maris|Opal/u);
      return true;
    });
    assert.equal(requests.length, 0);
    assert.deepEqual(submissions, []);
  });
}

test("a mixed output block cannot leak Scene prose through a preserved group's inferred member label", async (context) => {
  const snapshot = outlineSnapshot();
  const format = snapshot.facts.find((fact) => fact.block_id === "PRIVATE_OUTLINE_FORMAT");
  const slides = format.properties.text.split("\nRequired supporting output 2:")[0];
  delete format.properties.label;
  format.properties.text = `Required supporting output 2: Scripted Scene\nSIBLING_ONLY_ORCHARD_STORY with Linden, Maris, and Opal.\n\n${slides}`;
  const membership = {
    context_set_id: "PRIVATE_OUTLINE_MIXED_GROUP",
    name: "Selected decision brief",
    target: "Presentation chapter",
    role: "slide_chapter",
    application: "ordered",
    relativity: 1,
  };
  for (const [index, fact] of snapshot.facts.entries()) {
    if (fact.block_id === format.block_id || research.some((source) => source.id === fact.block_id)) {
      fact.properties.combined_context_memberships = [{ ...membership, member_order: index }];
    }
  }
  assert.deepEqual(contractFor(snapshot).sourceIssues, []);
  const assessment = assessStoredPresentationCandidate(JSON.stringify(outputFor(snapshot)), snapshot, options);
  assert.ok(assessment.issues.some((issue) => issue.code === "ambiguous_presentation_context_group"));
  const requests = mockProvider(context, []);
  await assert.rejects(generate(snapshot), (error) => {
    assert.equal(error.detail?.code, "presentation_source_contract_invalid");
    assert.match(error.detail?.message ?? "", /binding group members and instructions/u);
    assert.doesNotMatch(JSON.stringify(error.detail), /PRIVATE_OUTLINE_|SIBLING_ONLY_ORCHARD_STORY|Linden/u);
    return true;
  });
  assert.equal(requests.length, 0);
});
