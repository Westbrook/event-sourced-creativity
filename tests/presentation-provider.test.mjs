import assert from "node:assert/strict";
import test from "node:test";

import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { generateDocumentArtifact } from "../worker/openai-adapter.ts";

const PRIVATE_BLOCK_ID = "PRIVATE_EXECUTIVE_SOURCE_BLOCK_8731";
const PRIVATE_GROUP_ID = "PRIVATE_EXECUTIVE_SOURCE_GROUP_8731";
const PRIVATE_CLAIM_ID = "PRIVATE_EXECUTIVE_SOURCE_CLAIM_8731";
const PRIVATE_CANVAS_ID = "PRIVATE_EXECUTIVE_SOURCE_CANVAS_8731";
const STAKEHOLDER_QUOTE = "The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";
const SCORES = [
  ["Phone", "39.75"],
  ["Tablet", "53.00"],
  ["Small monitor", "67.25"],
  ["Large monitor", "68.50"],
  ["Adaptive/accessibility", "58.75"],
  ["Governed creative loop", "79.50"],
];

const presentation = (style = "field-notes") => ({
  aspect_ratio: "16:9",
  theme: "Forma executive source evidence",
  footer_label: "Responsive product assessment",
  style_preset: style,
  mode: style === "nocturne" ? "dark" : "light",
  palette: {
    background: "#edf1ef",
    foreground: "#14211d",
    accent: "#287260",
    muted: "#586b64",
    surface: "#d9e3df",
  },
});

function executiveSourceSnapshot({ grouped = true } = {}) {
  return {
    project_id: "PRIVATE_EXECUTIVE_PROJECT_8731",
    document_id: "PRIVATE_EXECUTIVE_DOCUMENT_8731",
    actor_id: "PRIVATE_EXECUTIVE_ACTOR_8731",
    organization_id: "PRIVATE_EXECUTIVE_ORGANIZATION_8731",
    facts: [{
      block_id: PRIVATE_BLOCK_ID,
      type: "direction",
      locked: true,
      properties: {
        label: "Executive source evidence",
        text: [
          "## Responsive evidence and stakeholder decision",
          "Slide 1 — RESPONSIVE ASSESSMENT",
          "Phone: 39.75; Tablet: 53.00; Small monitor: 67.25; Large monitor: 68.50; Adaptive/accessibility: 58.75; Governed creative loop: 79.50.",
          "Exact equal-weight average: 61.125. Rounded display value: 61.13.",
          "",
          "Slide 2 — STAKEHOLDER DIFFERENTIATOR",
          `“${STAKEHOLDER_QUOTE}” — Product Owner`,
        ].join("\n"),
        ...(grouped ? {
          combined_context_memberships: [{
            context_set_id: PRIVATE_GROUP_ID,
            name: "Executive evidence chapter",
            target: "Executive source evidence",
            role: "slide_chapter",
            application: "ordered",
            relativity: .97,
            member_order: 0,
            source_canvas_id: PRIVATE_CANVAS_ID,
          }],
        } : {}),
      },
    }],
    claims: [{
      id: PRIVATE_CLAIM_ID,
      blockId: PRIVATE_BLOCK_ID,
      label: "Authorized executive assessment claim",
      text: "The six source-authored assessment values are protected evidence.",
    }],
    relationships: [],
  };
}

function scorecardSlide({ grouped = true } = {}) {
  return {
    title: "Six-goal responsive assessment",
    body: "Each product dimension contributes equally to the current baseline.",
    notes: "The exact equal-weight average is 61.125; the rounded display value is 61.13.",
    image_prompt: "Editable evidence-led six-row assessment scorecard.",
    context_group_ids: grouped ? ["context_group_1"] : [],
    slide: {
      layout: "scorecard",
      kicker: "Independent baseline",
      bullets: [],
      quote: null,
      citations: [{
        source_id: "blk_001",
        label: "Executive product assessment",
        anchor: "Authored slide 1",
        excerpt: SCORES.map(([label, value]) => `${label}: ${value}`).join("; "),
      }],
      source_ids: ["blk_001"],
      section: "Responsive evidence and stakeholder decision",
      source_order: 1,
      visual: {
        kind: "scorecard",
        label: "Device and capability assessment",
        value: "61.13",
        exact_value: "61.125",
        display_value: "61.13",
        unit: "/ 100",
        data: SCORES.map(([label, value]) => ({
          label,
          value,
          weight: Number(value) / 100,
          exact_value: value,
          display_value: value,
          source_ids: ["blk_001"],
        })),
      },
    },
  };
}

function attributedQuoteSlide({ grouped = true } = {}) {
  return {
    title: "Traceable creative work earns reviewer confidence",
    body: "",
    notes: `Product Owner: “${STAKEHOLDER_QUOTE}”`,
    image_prompt: "A fully attributed, source-grounded stakeholder quotation.",
    context_group_ids: grouped ? ["context_group_1"] : [],
    slide: {
      layout: "quote",
      kicker: "Stakeholder evidence",
      bullets: [],
      quote: {
        text: STAKEHOLDER_QUOTE,
        speaker: "Product Owner",
        role: "Product Owner",
        source_id: "blk_001",
        citation: "Executive source evidence · authored slide 2",
      },
      citations: [{
        source_id: "blk_001",
        label: "Stakeholder interview",
        anchor: "Authored slide 2",
        excerpt: STAKEHOLDER_QUOTE,
      }],
      source_ids: ["blk_001"],
      section: "Responsive evidence and stakeholder decision",
      source_order: 2,
      visual: {
        kind: "quote",
        label: "The product owner's argument",
        value: STAKEHOLDER_QUOTE,
        exact_value: null,
        display_value: null,
        unit: null,
        data: [],
      },
    },
  };
}

function executivePresentation({ grouped = true, style = "field-notes" } = {}) {
  return {
    title: "Forma executive source evidence",
    summary: "A complete, source-grounded executive assessment.",
    content_markdown: [
      "# Forma executive source evidence",
      "",
      "## Six-goal responsive assessment",
      SCORES.map(([label, value]) => `- ${label}: ${value}`).join("\n"),
      "Exact equal-weight average: 61.125. Rounded display value: 61.13.",
      "",
      "## Stakeholder differentiator",
      `> ${STAKEHOLDER_QUOTE}`,
      "> — Product Owner",
    ].join("\n"),
    presentation: presentation(style),
    items: [scorecardSlide({ grouped }), attributedQuoteSlide({ grouped })],
  };
}

async function withProviderResponses(outputs, callback) {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(init.method, "POST");
    const request = JSON.parse(String(init.body));
    requests.push({
      request,
      input: JSON.parse(request.input),
    });
    const output = outputs[Math.min(requests.length - 1, outputs.length - 1)];
    assert.ok(output, "a mocked provider output must exist for every submitted request");
    return Response.json({
      id: `presentation-provider-response-${requests.length}`,
      model: "gpt-presentation-test",
      output_text: JSON.stringify(output),
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    });
  };
  try {
    return await callback(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function generateExecutivePresentation(options = {}, snapshot = executiveSourceSnapshot()) {
  return generateDocumentArtifact(
    { OPENAI_API_KEY: "mock-provider-key", OPENAI_MODEL: "gpt-presentation-test" },
    "authorized-executive-actor",
    "slides",
    {
      documentTitle: "Executive source evidence",
      snapshot,
      options: { itemCount: 2, presentationStyle: "field-notes", ...options },
    },
  );
}

function assertRequestContainsNoPrivateSourceIdentifiers(request) {
  const serialized = JSON.stringify(request);
  for (const privateIdentifier of [
    PRIVATE_BLOCK_ID,
    PRIVATE_GROUP_ID,
    PRIVATE_CLAIM_ID,
    PRIVATE_CANVAS_ID,
    "PRIVATE_EXECUTIVE_PROJECT_8731",
    "PRIVATE_EXECUTIVE_DOCUMENT_8731",
    "PRIVATE_EXECUTIVE_ACTOR_8731",
    "PRIVATE_EXECUTIVE_ORGANIZATION_8731",
  ]) assert.equal(serialized.includes(privateIdentifier), false, `provider request leaked ${privateIdentifier}`);
}

test("the strict slideshow schema preserves complete attributed quotes, editable scorecards, and an explicitly selected presentation style", async () => {
  await withProviderResponses([executivePresentation()], async (requests) => {
    const result = await generateExecutivePresentation();
    assert.equal(requests.length, 1);

    const { request, input } = requests[0];
    const schema = request.text.format.schema;
    const slideSchema = schema.properties.items.items.properties.slide;
    const visualSchema = slideSchema.properties.visual;
    assert.equal(request.text.format.strict, true);
    assert.equal(schema.additionalProperties, false);
    assert.ok(slideSchema.properties.quote.properties.text.maxLength >= 1_000, "attributed quotations cannot inherit the legacy 120-character ceiling");
    assert.ok(visualSchema.properties.value.maxLength >= 1_000, "quote-card visible copy must retain a complete protected quotation");
    assert.ok(slideSchema.properties.bullets.maxItems >= 24);
    assert.ok(slideSchema.properties.citations.maxItems >= 24);
    assert.ok(visualSchema.properties.data.maxItems >= 48, "editable scorecards and comparison matrices must not be capped at five rows");
    assert.ok(slideSchema.properties.source_ids.maxItems >= 24);
    assert.deepEqual(schema.properties.presentation.properties.style_preset.enum, ["field-notes"], "an explicitly selected deck style must be schema-locked before the first provider call");

    assert.equal(input.creative_context.facts[0].source_key, "blk_001");
    assert.deepEqual(input.creative_context.facts[0].source_group_keys, ["grp_001"]);
    assert.deepEqual(input.creative_context.facts[0].source_claim_keys, ["clm_001"]);
    assert.equal(input.creative_context.claims[0].source_key, "clm_001");
    assert.equal(input.creative_context.claims[0].source_block_key, "blk_001");
    assert.equal(input.presentation_source.authoredSlideCount, 2);
    assert.deepEqual(input.presentation_source.outline.map((slide) => slide.sourceAlias), ["blk_001", "blk_001"]);
    assert.equal(input.presentation_source.protectedFacts.filter((fact) => fact.precision === "source").length, 6);
    assert.equal(input.presentation_source.protectedQuotes[0].text, STAKEHOLDER_QUOTE);
    assertRequestContainsNoPrivateSourceIdentifiers(request);

    const [scorecard, stakeholder] = result.output.items;
    assert.deepEqual(scorecard.slide.visual.data.map(({ label, value }) => [label, value]), SCORES);
    assert.equal(scorecard.slide.visual.data[1].value, "53.00", "trailing source precision must remain visible");
    assert.equal(scorecard.slide.visual.exactValue, "61.125");
    assert.equal(scorecard.slide.visual.displayValue, "61.13");
    assert.ok(scorecard.slide.sourceIds.includes(PRIVATE_BLOCK_ID));
    assert.equal(scorecard.slide.sourceIds.includes("blk_001"), false, "request aliases must resolve before durable slide storage");
    assert.ok(STAKEHOLDER_QUOTE.length > 120);
    assert.equal(stakeholder.slide.quote.text, STAKEHOLDER_QUOTE);
    assert.equal(stakeholder.slide.visual.value, STAKEHOLDER_QUOTE);
    assert.equal(stakeholder.slide.quote.speaker, "Product Owner");
    assert.equal(stakeholder.slide.quote.role, "Product Owner");
    assert.equal(stakeholder.slide.quote.sourceId, PRIVATE_BLOCK_ID);
    assert.equal(stakeholder.slide.citations[0].sourceId, PRIVATE_BLOCK_ID);
    assert.ok(stakeholder.notes.includes(STAKEHOLDER_QUOTE));
    assert.ok(result.output.content_markdown.includes(STAKEHOLDER_QUOTE));
    assert.deepEqual(result.output.items.map((item) => item.context_group_ids), [[PRIVATE_GROUP_ID], [PRIVATE_GROUP_ID]]);
    assert.deepEqual(result.inputReceipt.validation.source_resolution.initial.rawAssignments, [["blk_001"], ["blk_001"]]);
    assert.deepEqual(result.inputReceipt.validation.source_resolution.initial.canonicalAssignments, [[PRIVATE_BLOCK_ID], [PRIVATE_BLOCK_ID]]);
    assert.deepEqual(result.inputReceipt.validation.source_resolution.initial.unknownAssignments, []);
    assert.equal(result.inputReceipt.validation.repair_attempted, false);
    assert.equal(result.inputReceipt.validation.maximum_provider_calls, 2);
    assert.equal(result.inputReceipt.validation.provider_call_count, 1);
    assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 80, totalTokens: 200 });
  });
});

test("locally preserves authored brand typography without broadening the provider output schema",async()=>{
  const snapshot=executiveSourceSnapshot();
  snapshot.facts[0].properties.text=`Typography: Helvetica Neue\n${snapshot.facts[0].properties.text}`;
  await withProviderResponses([executivePresentation()],async(requests)=>{
    const result=await generateExecutivePresentation({},snapshot);
    assert.equal(requests.length,1);
    assert.equal(requests[0].input.presentation_source.style.typography,"Helvetica Neue");
    assert.equal(result.output.presentation.fontFamily,"Helvetica Neue");
  });
});

test("ungrouped authored source blocks still ground every slide without manufacturing Combined Context provenance", async () => {
  const snapshot = executiveSourceSnapshot({ grouped: false });
  await withProviderResponses([executivePresentation({ grouped: false })], async (requests) => {
    const result = await generateExecutivePresentation({}, snapshot);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].input.combined_context_plan, []);
    assert.equal(requests[0].input.creative_context.facts[0].source_key, "blk_001");
    assert.equal(requests[0].input.creative_context.facts[0].source_group_keys, undefined);
    assert.deepEqual(result.output.items.map((item) => item.context_group_ids), [[], []]);
    assert.deepEqual(result.output.items.map((item) => item.slide.sourceIds), [[PRIVATE_BLOCK_ID], [PRIVATE_BLOCK_ID]]);
    assert.equal(result.output.items[1].slide.quote.sourceId, PRIVATE_BLOCK_ID);
    assertRequestContainsNoPrivateSourceIdentifiers(requests[0].request);
  });
});

for (const invalidReference of [
  {
    label: "invented slide source alias",
    issue: "unknown_source_reference",
    apply: (output) => { output.items[0].slide.source_ids.push("blk_999"); },
  },
  {
    label: "guessed durable slide source identifier",
    issue: "unknown_source_reference",
    apply: (output) => { output.items[0].slide.source_ids.push(PRIVATE_BLOCK_ID); },
  },
  {
    label: "invented combined-context alias",
    issue: "unknown_context_group_reference",
    apply: (output) => { output.items[0].context_group_ids.push("context_group_999"); },
  },
  {
    label: "guessed durable combined-context identifier",
    issue: "unknown_context_group_reference",
    apply: (output) => { output.items[0].context_group_ids.push(PRIVATE_GROUP_ID); },
  },
]) {
  test(`${invalidReference.label} triggers exactly one source-safe bounded repair`, async () => {
    const invalid = executivePresentation();
    invalidReference.apply(invalid);
    await withProviderResponses([invalid, executivePresentation()], async (requests) => {
      const result = await generateExecutivePresentation();
      assert.equal(requests.length, 2, "an unauthorized provider reference must trigger exactly one repair call");
      assert.equal(requests[1].request.text.format.name, "document_slides_repair");
      assert.equal(result.inputReceipt.validation.repair_attempted, true);
      assert.ok(result.inputReceipt.validation.initial_issues.some((issue) => issue.code === invalidReference.issue));
      assert.deepEqual(result.inputReceipt.validation.repair_issues, []);
      assert.deepEqual(result.inputReceipt.validation.source_resolution.repair.unknownAssignments, []);
      assert.equal(result.inputReceipt.validation.maximum_provider_calls, 2);
      assert.equal(result.inputReceipt.validation.provider_call_count, 2);
      assert.deepEqual(result.usage, { inputTokens: 240, outputTokens: 160, totalTokens: 400 });
      assert.ok(requests[1].input.validation_issues.some((issue) => issue.code === invalidReference.issue));
      for (const { request } of requests) assertRequestContainsNoPrivateSourceIdentifiers(request);
      assert.ok(result.output.items.every((item) => item.slide.sourceIds.includes(PRIVATE_BLOCK_ID)));
    });
  });

  test(`${invalidReference.label} fails closed when the one permitted repair remains unauthorized`, async () => {
    const invalid = executivePresentation();
    invalidReference.apply(invalid);
    await withProviderResponses([invalid, invalid], async (requests) => {
      await assert.rejects(
        generateExecutivePresentation(),
        (error) => {
          assert.equal(error.detail?.code, "source_fidelity_validation_failed");
          assert.equal(error.detail?.action, "edit_request");
          assert.equal(error.detail?.retryable, false);
          assert.match(error.detail?.message ?? "", /after one bounded repair pass/i);
          assert.match(error.detail?.message ?? "", new RegExp(invalidReference.issue));
          assert.equal((error.detail?.message ?? "").includes(PRIVATE_BLOCK_ID), false);
          assert.equal((error.detail?.message ?? "").includes(PRIVATE_GROUP_ID), false);
          assert.deepEqual(error.providerUsage, { inputTokens: 240, outputTokens: 160, totalTokens: 400 });
          assert.deepEqual(error.providerResponseIds, ["presentation-provider-response-1", "presentation-provider-response-2"]);
          assert.equal(error.providerCallCount, 2);
          return true;
        },
      );
      assert.equal(requests.length, 2, "unauthorized evidence must not be silently accepted or retried indefinitely");
      assert.equal(requests[1].request.text.format.name, "document_slides_repair");
      for (const { request } of requests) assertRequestContainsNoPrivateSourceIdentifiers(request);
    });
  });
}

test("reversed exact/display semantics and a dropped sixth score independently require a bounded factual repair", async () => {
  for (const defect of [
    {
      label: "reversed exact/display values",
      issue: "reversed_precision_labels",
      apply: (output) => {
        output.items[0].slide.visual.exact_value = "61.13";
        output.items[0].slide.visual.display_value = "61.125";
      },
    },
    {
      label: "dropped governed-creative-loop score",
      issue: "inconsistent_scorecard_average",
      apply: (output) => { output.items[0].slide.visual.data.pop(); },
    },
  ]) {
    const invalid = executivePresentation();
    defect.apply(invalid);
    await withProviderResponses([invalid, executivePresentation()], async (requests) => {
      const result = await generateExecutivePresentation();
      assert.equal(requests.length, 2, defect.label);
      assert.ok(result.inputReceipt.validation.initial_issues.some((issue) => issue.code === defect.issue), defect.label);
      assert.deepEqual(result.output.items[0].slide.visual.data.map(({ label, value }) => [label, value]), SCORES);
      assert.equal(result.output.items[0].slide.visual.exactValue, "61.125");
      assert.equal(result.output.items[0].slide.visual.displayValue, "61.13");
    });
  }
});

test("checkpoints each successful paid response before bounded repair can fail", async () => {
  const invalid = executivePresentation();
  invalid.items[0].slide.source_ids = ["blk_999"];
  const attempts = [];

  await withProviderResponses([invalid, invalid], async () => {
    await assert.rejects(generateExecutivePresentation({ onProviderAttempt: (receipt) => attempts.push(receipt) }), (error) => {
      assert.equal(error.providerCallCount, 2);
      assert.equal(error.providerUsage.totalTokens, 400);
      return true;
    });
  });

  assert.deepEqual(attempts.map((attempt) => attempt.usage.totalTokens), [200, 400]);
  assert.deepEqual(attempts.map((attempt) => attempt.responseIds), [["presentation-provider-response-1"], ["presentation-provider-response-1", "presentation-provider-response-2"]]);
  assert.doesNotMatch(JSON.stringify(attempts), /PRIVATE_EXECUTIVE_/);
});

test("never automatically resubmits a paid OpenAI Responses request after an ambiguous gateway failure",async(context)=>{
  let submissions=0;
  context.mock.method(globalThis,"fetch",async()=>{
    submissions+=1;
    return Response.json({error:{code:"upstream_gateway",message:"The upstream gateway could not confirm provider execution."}},{status:502});
  });

  await assert.rejects(generateExecutivePresentation(),(error)=>error.detail?.httpStatus===502);
  assert.equal(submissions,1,"an ambiguous paid POST cannot be automatically replayed or billed repeatedly");
});

test("preflights each paid slideshow request and preserves truthful accounting when its repair exceeds the ceiling",async()=>{
  await withProviderResponses([executivePresentation()],async(requests)=>{
    await assert.rejects(generateExecutivePresentation({onBeforeProviderAttempt:(attempt)=>{
      assert.equal(attempt.model,"gpt-presentation-test");
      assert.ok(attempt.maximumInputTokens>4096);
      assert.ok(attempt.maximumOutputTokens>=6500);
      throw new Error("application_spending_ceiling_reached");
    }}),/application_spending_ceiling_reached/);
    assert.equal(requests.length,0,"a denied initial request never contacts the model provider");
  });

  const invalid=executivePresentation();
  invalid.items[0].slide.source_ids=["blk_999"];
  await withProviderResponses([invalid],async(requests)=>{
    let attempts=0;
    await assert.rejects(generateExecutivePresentation({onBeforeProviderAttempt:()=>{
      attempts+=1;
      if(attempts===2)throw new Error("application_spending_ceiling_reached");
    }}),(error)=>{
      assert.equal(error.providerCallCount,1);
      assert.deepEqual(error.providerUsage,{inputTokens:120,outputTokens:80,totalTokens:200});
      assert.deepEqual(error.providerResponseIds,["presentation-provider-response-1"]);
      return true;
    });
    assert.equal(attempts,2);
    assert.equal(requests.length,1,"an unaffordable repair never reaches the provider");
  });
});

test("a visibly truncated stakeholder quotation is repaired from authorized evidence even when notes and Markdown retain the complete text", async () => {
  const invalid = executivePresentation();
  const truncation = STAKEHOLDER_QUOTE.slice(0, 120);
  invalid.items[1].slide.quote.text = truncation;
  invalid.items[1].slide.visual.value = truncation;
  invalid.items[1].slide.citations[0].excerpt = truncation;
  assert.ok(invalid.items[1].notes.includes(STAKEHOLDER_QUOTE));
  assert.ok(invalid.content_markdown.includes(STAKEHOLDER_QUOTE));

  await withProviderResponses([invalid, executivePresentation()], async (requests) => {
    const result = await generateExecutivePresentation();
    assert.equal(requests.length, 2, "speaker notes and Markdown cannot excuse a clipped slide quotation");
    assert.ok(result.inputReceipt.validation.initial_issues.some((issue) => issue.code === "missing_protected_quote"));
    assert.equal(result.output.items[1].slide.quote.text, STAKEHOLDER_QUOTE);
    assert.equal(result.output.items[1].slide.visual.value, STAKEHOLDER_QUOTE);
    assert.equal(result.output.items[1].slide.quote.speaker, "Product Owner");
    assert.equal(result.output.items[1].slide.quote.role, "Product Owner");
    for (const { request } of requests) assertRequestContainsNoPrivateSourceIdentifiers(request);
  });
});

test("managed assigned scenes expose only resolvable source aliases and retain canonical slide attribution", async () => {
  const snapshot = executiveSourceSnapshot();
  const productionPlan = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 2 });
  assert.equal(productionPlan.scenes.length, 2);

  await withProviderResponses([executivePresentation({ style: "editorial" })], async (requests) => {
    const result = await generateExecutivePresentation({
      presentationStyle: "editorial",
      productionMode: "managed",
      productionPlan,
      productionScenes: productionPlan.scenes,
      productionPage: {
        pageIndex: 0,
        pageCount: 1,
        globalStartIndex: 0,
        totalItems: 2,
        phase: "complete",
        priorSummary: "",
        priorEnding: "",
        priorVisibleCopy: [],
      },
    }, snapshot);

    assert.equal(requests.length, 1);
    const { request, input } = requests[0];
    assert.deepEqual(request.text.format.schema.properties.presentation.properties.style_preset.enum, ["editorial"]);
    assert.equal(input.production.assigned_scenes.length, 2);
    assert.deepEqual(input.production.assigned_scenes.map((scene) => scene.source_keys), [["blk_001"], ["blk_001"]]);
    assert.deepEqual(input.production.assigned_scenes.map((scene) => scene.context_keys), [["context_group_1"], ["context_group_1"]]);
    assert.deepEqual(input.production.assigned_scenes.map((scene) => scene.narrative_order), [1, 2]);
    assertRequestContainsNoPrivateSourceIdentifiers(request);
    assert.deepEqual(result.output.items.map((item) => item.slide.sourceIds), [[PRIVATE_BLOCK_ID], [PRIVATE_BLOCK_ID]]);
    assert.deepEqual(result.output.items.map((item) => item.context_group_ids), [[PRIVATE_GROUP_ID], [PRIVATE_GROUP_ID]]);
  });
});
