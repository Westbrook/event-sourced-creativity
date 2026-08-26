import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPresentationSourceContract,
  inferPresentationSourceOutline,
  providerFacingPresentationSourceContract,
  repairProtectedPresentationMessages,
  validatePresentationSourceCoverage,
} from "../src/model/presentation-source.ts";
import { assessStoredPresentationCandidate, generateDocumentArtifact } from "../worker/openai-adapter.ts";

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
      model: "gpt-presentation-test",
      output_text: JSON.stringify(candidate),
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    });
  };

  try {
    const result = await generateDocumentArtifact(
      { OPENAI_API_KEY: "mock-provider-key", OPENAI_MODEL: "gpt-presentation-test" },
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
      model: "gpt-presentation-test",
      output_text: JSON.stringify(candidates[requests.length - 1]),
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    });
  };

  try {
    const result = await generateDocumentArtifact(
      { OPENAI_API_KEY: "mock-provider-key", OPENAI_MODEL: "gpt-presentation-test" },
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
