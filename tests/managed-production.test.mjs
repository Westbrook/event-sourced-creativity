import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { generationBudgetGate, generationBudgetPreferenceKey } from "../src/model/generation-budget.ts";
import { documentJobCanRecoverProviderRender, documentJobProgress } from "../src/model/document-jobs.ts";
import {
  buildManagedProductionPlan,
  minimumPresentationSlideCount,
  productionClaims,
  productionDefectReduction,
  productionSceneSnapshot,
  productionTeamInstructions,
  productionTeamFor,
  providerFacingProductionContinuity,
  scoreManagedProductionPlan,
  scoreManualVideoBaseline,
} from "../src/model/managed-production.ts";
import { productionSystemFor, productionUnitsForPlan, validateProductionUnits } from "../src/model/production-system.ts";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { generateManagedArtifactDraft, renderManagedStoryboardProduction, renderManagedVideoProduction } from "../worker/managed-production.ts";
import { PRESENTATION_ADAPTER_VERSION } from "../worker/openai-adapter.ts";

const membership = (contextSetId, target, order = 0) => ({ context_set_id: contextSetId, name: target, target, role: "character", application: "isolate", relativity: .94, member_order: order });

function productionFixture(count = 12, climax = Math.ceil(count / 2)) {
  const facts = [
    { block_id: "mara", type: "subject", locked: true, properties: { text: "Mara keeps her crimson coat and silver compass.", combined_context_memberships: [membership("cast-mara", "Mara")] } },
    { block_id: "ivo", type: "subject", locked: true, properties: { text: "Ivo keeps his cobalt coat and brass lantern.", combined_context_memberships: [membership("cast-ivo", "Ivo")] } },
    { block_id: "moonlight", type: "lighting", locked: true, properties: { text: "Preserve cold moonlight against warm practical lanterns." } },
    { block_id: "avoid-crowds", type: "direction", locked: true, intent: "prohibit", effect: "exclude", properties: { text: "Never introduce a crowd or modern vehicle." } },
    ...Array.from({ length: count }, (_, offset) => {
      const sequence = offset + 1;
      const character = sequence % 2 ? "Mara" : "Ivo";
      const target = character === "Mara" ? "cast-mara" : "cast-ivo";
      return {
        block_id: `shot-${sequence}`,
        type: "reference",
        position: String(sequence).padStart(3, "0"),
        properties: {
          label: sequence === climax ? "Climax: the hidden compass reveals the observatory" : `Original beat ${sequence}`,
          text: `${character} performs unique authored action ${sequence}.`,
          storyboard_frame_index: sequence,
          storyboard_title: "The midnight observatory",
          source_artifact_id: "storyboard-midnight",
          storyboard_shot_title: sequence === climax ? "Climax: the hidden compass reveals the observatory" : `Original beat ${sequence}`,
          storyboard_shot_direction: `${character} performs unique authored action ${sequence}.`,
          storyboard_camera_direction: sequence % 2 ? "Slow rightward tracking shot." : "Matched left-facing eyeline.",
          storyboard_frame_prompt: `${character} in moonlit observatory at story beat ${sequence}.`,
          combined_context_memberships: [membership(target, character, sequence)],
        },
      };
    }),
  ];
  return { facts, relationships: [{ relation_id: "cast-opposition", from_block_id: "mara", to_block_id: "ivo", kind: "contrast" }] };
}

const approvedReferences = (sequences) => sequences.map((sequence) => ({
  referenceId: `reference-${sequence}`,
  blockId: `shot-${sequence}`,
  sequence,
  contextGroupIds: [sequence % 2 ? "cast-mara" : "cast-ivo"],
  label: `Approved storyboard image ${sequence}`,
}));

function saturatedContinuityFixture(format, { scopedAlias = false } = {}) {
  const snapshot = productionFixture(2, 1);
  const shared = Array.from({ length: scopedAlias ? 7 : 8 }, (_, index) => ({
    referenceId: `generic-${index + 1}`,
    blockId: `generic-${index + 1}`,
    sequence: null,
    contextGroupIds: [],
    label: `General approved study ${index + 1}`,
  }));
  const aliases = scopedAlias ? [
    { referenceId: "shared-resource", blockId: "ivo-alias", sequence: null, contextGroupIds: ["cast-ivo"], label: "Ivo-only shared resource" },
    { referenceId: "shared-resource", blockId: "mara-alias", sequence: null, contextGroupIds: ["cast-mara"], label: "Mara-only shared resource" },
  ] : [];
  const authorized = [...shared, ...aliases, ...approvedReferences([1, 2])];
  const production = buildManagedProductionPlan(format, snapshot, { references: authorized });
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  const references = authorized.map((reference) => ({
    ...reference,
    bytes,
    mimeType: "image/png",
    mode: "preserve_composition",
    shotDirection: `Approved direction ${reference.referenceId}`,
    cameraDirection: "Controlled camera.",
    framePrompt: `Approved study ${reference.referenceId}`,
    sourceArtifactId: "approved-board",
    sourceArtifactItemId: reference.sequence ? `frame-${reference.sequence}` : null,
    sourceArtifactKind: "storyboard",
    storyboardTitle: "The midnight observatory",
    provider: "fal",
    providerMediaUrl: `https://v3b.fal.media/files/test/${reference.referenceId}.png`,
    contextGroups: reference.contextGroupIds.map((id) => ({ id, name: id, target: id, role: "character", application: "isolate", relativity: 1 })),
  }));
  const draft = { title: "Capped continuity", summary: "Every frame remains connected.", content_markdown: "A continuous world.", presentation: null, items: production.scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: scene.cameraDirection, image_prompt: scene.imagePrompt, context_group_ids: scene.contextGroupIds, slide: null })) };
  return { snapshot, production, references, draft, bytes };
}

const EXECUTIVE_SLIDE_TITLES = [
  "Executive opportunity",
  "Six-goal assessment scorecard",
  "Four device postures",
  "One stable information architecture",
  "Governed creative differentiation",
  "Accessible phone and tablet priorities",
  "An actionable global activity inbox",
  "Responsive monitor relationships",
  "Write, Shape, and Present continuity",
  "Evidence-centered screen real estate",
  "Dependency-aware implementation roadmap",
  "Accessible, reviewable delivery",
  "Phone portrait work queue",
  "Phone landscape presenter continuity",
  "Tablet portrait document writing",
  "Tablet landscape paired review",
  "Small-monitor evidence relationships",
  "Large-monitor editorial governance",
  "Independent review and source attribution",
  "Private generation receipts",
  "Near-term four-to-six-week foundation",
  "Twelve-to-sixteen-week governed rollout",
  "A reusable, trustworthy final presentation",
];

const EXECUTIVE_STAKEHOLDER_QUOTES = [
  "The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.",
  "An asynchronous job without a global, actionable inbox is just work the customer has to remember to check.",
  "Every extra inch of screen should reveal a useful relationship, not another column of product chrome.",
  "A smaller screen is not a smaller product; it is a stricter argument about what deserves the next square inch.",
];

const executiveSlideCopy = (number) => ({
  1: "Forma should make every approved presentation faithful, coherent, accessible, and editable.",
  2: "Phone: 39.75; Tablet: 53.00; Small monitor: 67.25; Large monitor: 68.50; Adaptive/accessibility: 58.75; Governed creative loop: 79.50. Exact equal-weight average: 61.125. Rounded display value: 61.13.",
  3: "Protect phone portrait, phone landscape, tablet portrait, and tablet landscape device postures.",
  4: "Keep Projects / Work / Explore / Activity / Deliver as the stable product destinations.",
  5: `“${EXECUTIVE_STAKEHOLDER_QUOTES[0]}” — Product Owner`,
  6: "Touch targets remain at least 44px and no critical visual evidence disappears on narrower screens.",
  7: `“${EXECUTIVE_STAKEHOLDER_QUOTES[1]}” — Market Researcher`,
  8: "Expose useful relationships between source context, active document, and generated presentation.",
  9: "Keep Write / Shape / Present available while preserving the same document and review state.",
  10: `“${EXECUTIVE_STAKEHOLDER_QUOTES[2]}” — Product Owner`,
  11: "Deliver the foundation in 4–6 weeks and the governed cross-device rollout in 12–16 weeks.",
  12: `“${EXECUTIVE_STAKEHOLDER_QUOTES[3]}” — Lead Designer`,
  13: "Phone portrait reveals the inbox, current work, and an explicit accessible next action.",
  14: "Phone landscape retains slide position, the source-backed notes, and keyboard navigation.",
  15: "Tablet portrait preserves document identity and an uninterrupted editorial writing flow.",
  16: "Tablet landscape pairs the approved presentation with its evidence and reviewer feedback.",
  17: "Small monitors prioritize contextual evidence without manufacturing extra navigation chrome.",
  18: "Large monitors expose useful document relationships and independently reviewed decisions.",
  19: "Every final slide binds to an authorized section and the exact source-authored claims.",
  20: "Generation receipts retain actor-private provider usage, reservations, and settlement.",
  21: "Weeks 4–6 establish responsive accessibility, stable routes, and actionable project activity.",
  22: "Weeks 12–16 complete independent review, governed evidence, and reliable delivery.",
  23: "Release one coherent, source-grounded, accessible, and independently editable deck.",
}[number]);

function executivePresentationSnapshot(count = 12) {
  const sectionSize = Math.ceil(count / 3);
  const sections = [
    { name: "Executive foundation", type: "direction", key: "FOUNDATION" },
    { name: "Responsive experience", type: "audience", key: "EXPERIENCE" },
    { name: "Governed delivery", type: "message", key: "DELIVERY" },
  ];
  return {
    facts: sections.map((section, sectionIndex) => {
      const start = sectionIndex * sectionSize + 1;
      const end = Math.min(count, start + sectionSize - 1);
      const authoredSlides = Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => {
        const number = start + offset;
        return `Slide ${number} — ${EXECUTIVE_SLIDE_TITLES[number - 1]}\n${executiveSlideCopy(number)}`;
      });
      return {
        block_id: `PRIVATE_SOURCE_BLOCK_${section.key}_8731`,
        type: section.type,
        locked: true,
        properties: {
          label: section.name,
          text: [`## ${section.name}`, ...authoredSlides].join("\n\n"),
          combined_context_memberships: [{
            context_set_id: `PRIVATE_SOURCE_SECTION_${section.key}_8731`,
            name: section.name,
            target: section.name,
            role: "slide_chapter",
            application: "ordered",
            relativity: .97,
            member_order: sectionIndex,
            source_canvas_id: "PRIVATE_SOURCE_CANVAS_8731",
          }],
        },
      };
    }),
  };
}

test("registers truthful, reusable specialist teams for every supported output format", () => {
  const expected = {
    video: ["Director", "Script writer", "Cinematographer", "Story boarder"],
    storyboard: ["Director", "Storyboard artist", "Cinematographer", "Continuity supervisor"],
    slides: ["Narrative strategist", "Information designer", "Presentation art director", "Fact and continuity editor"],
    short_story: ["Developmental editor", "Story architect", "Continuity editor", "Prose stylist"],
    scene: ["Showrunner", "Screenwriter", "Dialogue editor", "Script supervisor"],
    image: ["Creative director", "Art director", "Lighting designer", "Brand and continuity steward"],
  };
  for (const [format, labels] of Object.entries(expected)) {
    const team = productionTeamFor(format);
    assert.equal(team.format, format);
    assert.equal(team.version, "1.0.0");
    assert.deepEqual(team.specialists.map((role) => role.label), labels);
  }
});

test("managed slides preserve the twelve authored numbered outline positions, sections, and authorized source blocks", () => {
  const snapshot = executivePresentationSnapshot();
  const plan = buildManagedProductionPlan("slides", snapshot);

  assert.equal(plan.authoredSlideCount, 12);
  assert.equal(plan.requestedSlideCount, null);
  assert.equal(plan.predictedSlideCount, 12);
  assert.equal(plan.slideCountMismatch, false);
  assert.equal(plan.slideCountMismatchReason, null);
  assert.equal(plan.scenes.length, 12, "three authored prose blocks must produce twelve slide scenes, not two or three context-led scenes");
  assert.deepEqual(plan.scenes.map((scene) => scene.title), EXECUTIVE_SLIDE_TITLES.slice(0, 12));
  assert.deepEqual(plan.scenes.map((scene) => scene.narrativeOrder), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.deepEqual(plan.scenes.map((scene) => scene.sourceBlockIds), Array.from({ length: 12 }, (_, index) => [snapshot.facts[Math.floor(index / 4)].block_id]));
  assert.deepEqual(plan.scenes.map((scene) => scene.contextGroupIds), Array.from({ length: 12 }, (_, index) => [snapshot.facts[Math.floor(index / 4)].properties.combined_context_memberships[0].context_set_id]));
  assert.ok(plan.scenes.every((scene) => scene.sourceClaimIds.length > 0), "every authored slide needs a real, reviewable source claim");
  assert.match(plan.scenes[1].action, /Phone: 39\.75[\s\S]*Tablet: 53\.00[\s\S]*Governed creative loop: 79\.50/);
  assert.match(plan.scenes[1].action, /Exact equal-weight average: 61\.125[\s\S]*Rounded display value: 61\.13/);
  for (const quotation of EXECUTIVE_STAKEHOLDER_QUOTES) assert.ok(plan.scenes.some((scene) => scene.action.includes(quotation)), `protected stakeholder quotation is absent: ${quotation}`);
  assert.match(plan.scenes[3].action, /Projects \/ Work \/ Explore \/ Activity \/ Deliver/);
  assert.match(plan.scenes[8].action, /Write \/ Shape \/ Present/);
  assert.match(plan.scenes[10].action, /4–6 weeks[\s\S]*12–16 weeks/);
  assert.equal(plan.providerBatchSize, 8);
  assert.equal(plan.providerBatchCount, 2);
  assert.equal(plan.providerCallCount, 2);
  assert.deepEqual(plan.providerBatches.map((batch) => [batch.index, batch.startSlide, batch.endSlide, batch.slideCount]), [[0, 1, 8, 8], [1, 9, 12, 4]]);
  assert.deepEqual(plan.providerBatches.map((batch) => batch.reservationMicrousd), [1_000_000, 1_000_000]);
  assert.equal(plan.estimatedPlanningCostMicrousd, 2_000_000);
  assert.equal(plan.estimatedTotalCostMicrousd, 2_000_000);
});

test("managed slides recognize the real executive document's twelve inline slide headings across three authored prose blocks", () => {
  const snapshot = executivePresentationSnapshot();
  snapshot.facts = snapshot.facts.map((fact, sectionIndex) => {
    const start = sectionIndex * 4 + 1;
    const end = start + 3;
    const authoredSlides = Array.from({ length: 4 }, (_, offset) => {
      const number = start + offset;
      return `Slide ${number} — ${EXECUTIVE_SLIDE_TITLES[number - 1]}. ${executiveSlideCopy(number)}`;
    }).join(" ");
    return {
      ...fact,
      properties: {
        ...fact.properties,
        text: `SLIDESHOW ${String.fromCharCode(65 + sectionIndex)} — ${fact.properties.label}. SLIDES ${start}–${end}. ${authoredSlides}`,
      },
    };
  });

  const plan = buildManagedProductionPlan("slides", snapshot);

  assert.equal(plan.authoredSlideCount, 12);
  assert.equal(plan.predictedSlideCount, 12);
  assert.equal(plan.scenes.length, 12, "same-line authored headings must not collapse into three context-led slides");
  assert.deepEqual(plan.scenes.map((scene) => scene.title), EXECUTIVE_SLIDE_TITLES.slice(0, 12));
  assert.deepEqual(plan.scenes.map((scene) => scene.sourceBlockIds), Array.from({ length: 12 }, (_, index) => [snapshot.facts[Math.floor(index / 4)].block_id]));
  assert.match(plan.scenes[1].action, /Phone: 39\.75[\s\S]*Governed creative loop: 79\.50[\s\S]*61\.125[\s\S]*61\.13/);
  assert.match(plan.scenes[10].action, /4–6 weeks[\s\S]*12–16 weeks/);
  assert.equal(plan.providerBatchCount, 2);
  assert.equal(plan.estimatedPlanningCostMicrousd, 2_000_000);
});

test("managed slides allow an explicit twenty-three-slide presentation while retaining authorized attribution and a truthful three-batch reservation", () => {
  const snapshot = executivePresentationSnapshot();
  const plan = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 23 });
  const authorizedBlocks = new Set(snapshot.facts.map((fact) => fact.block_id));
  const authorizedGroups = new Set(snapshot.facts.map((fact) => fact.properties.combined_context_memberships[0].context_set_id));

  assert.equal(plan.authoredSlideCount, 12);
  assert.equal(plan.requestedSlideCount, 23);
  assert.equal(plan.predictedSlideCount, 23);
  assert.equal(plan.slideCountMismatch, true, "intentional expansion still needs a visible authored-versus-planned count disclosure");
  assert.equal(plan.slideCountMismatchReason, "requested_more_than_authored");
  assert.equal(plan.scenes.length, 23);
  assert.deepEqual(plan.scenes.slice(0, 12).map((scene) => scene.title), EXECUTIVE_SLIDE_TITLES.slice(0, 12));
  assert.ok(plan.scenes.every((scene) => scene.sourceBlockIds.length > 0 && scene.sourceBlockIds.every((id) => authorizedBlocks.has(id))), "requested expansion must reuse authorized authored material, never invent or omit source blocks");
  assert.ok(plan.scenes.every((scene) => scene.sourceClaimIds.length > 0), "expanded slides must retain meaningful claim-level evidence");
  assert.ok(plan.scenes.every((scene) => scene.contextGroupIds.length > 0 && scene.contextGroupIds.every((id) => authorizedGroups.has(id))), "expanded slides must remain attributable to real authored sections");
  for (const groupId of authorizedGroups) {
    const positions = plan.scenes.flatMap((scene, index) => scene.contextGroupIds.includes(groupId) ? [index] : []);
    assert.ok(positions.length > 0, `authorized section ${groupId} must survive expansion`);
    assert.ok(positions.every((position, index) => index === 0 || position === positions[index - 1] + 1), `authorized section ${groupId} must occupy one contiguous chapter`);
  }
  assert.ok(plan.scenes.slice(12).every((scene) => scene.contextGroupIds.includes(snapshot.facts[2].properties.combined_context_memberships[0].context_set_id)), "additional supporting slides must extend the final authored chapter without reopening an earlier source section");
  assert.equal(plan.providerBatchSize, 8);
  assert.equal(plan.providerBatchCount, 3);
  assert.equal(plan.providerCallCount, 3);
  assert.ok(plan.maxRepairCallCount >= 0 && plan.maximumProviderCallCount >= plan.providerCallCount, "bounded additional paid provider work must be visible before generation");
  assert.deepEqual(plan.providerBatches.map((batch) => [batch.index, batch.startSlide, batch.endSlide, batch.slideCount]), [[0, 1, 8, 8], [1, 9, 16, 8], [2, 17, 23, 7]]);
  assert.deepEqual(plan.providerBatches.map((batch) => batch.reservationMicrousd), [1_000_000, 1_000_000, 1_000_000]);
  assert.equal(plan.estimatedPlanningCostMicrousd, 3_000_000);
  assert.equal(plan.estimatedTotalCostMicrousd, 3_000_000);
});

test("managed slide counts cannot silently compress a twelve-position authored outline", () => {
  const snapshot = executivePresentationSnapshot();
  const plan = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 4 });

  assert.equal(plan.authoredSlideCount, 12);
  assert.equal(plan.requestedSlideCount, 4);
  assert.equal(plan.predictedSlideCount, 12);
  assert.equal(plan.scenes.length, 12);
  assert.equal(plan.slideCountMismatch, true);
  assert.equal(plan.slideCountMismatchReason, "requested_less_than_authored");
  assert.deepEqual(plan.scenes.map((scene) => scene.title), EXECUTIVE_SLIDE_TITLES.slice(0, 12));
  assert.equal(plan.providerBatchCount, 2);
  assert.equal(plan.estimatedPlanningCostMicrousd, 2_000_000);
});

test("managed slide requests enforce the supported one-to-one-hundred-slide contract without changing legacy formats", () => {
  const snapshot = executivePresentationSnapshot();
  const invalid = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, 2.5];
  for (const requestedSlideCount of invalid) {
    assert.throws(
      () => buildManagedProductionPlan("slides", snapshot, { requestedSlideCount }),
      (error) => error instanceof RangeError && /invalid_managed_presentation_slide_count/.test(error.message),
      `invalid requested slide count ${String(requestedSlideCount)} must fail before provider calls or cost reservations`,
    );
  }
  assert.throws(
    () => buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 101 }),
    (error) => error instanceof RangeError && /managed_presentation_slide_count_exceeds_supported_maximum:100/.test(error.message),
  );

  const maximum = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 100 });
  assert.equal(maximum.requestedSlideCount, 100);
  assert.equal(maximum.predictedSlideCount, 100);
  assert.equal(maximum.scenes.length, 100);
  assert.equal(maximum.providerBatchCount, 13);
  assert.equal(maximum.providerBatches.at(-1).slideCount, 4);
  assert.equal(maximum.estimatedPlanningCostMicrousd, 13_000_000);

  const video = buildManagedProductionPlan("video", productionFixture(2), { requestedItemCount: 3 });
  assert.equal(video.format, "video");
  assert.equal(video.scenes.length, 3, "existing non-presentation production requests must retain their prior behavior");
});

test("managed planning rejects an authored one-hundred-and-first slide before truncation, reservation, or provider execution", () => {
  const snapshot = {
    facts: [{
      block_id: "PRIVATE_OVERSIZED_SOURCE_BLOCK_8731",
      type: "direction",
      properties: {
        text: Array.from({ length: 101 }, (_, index) => `Slide ${index + 1} — Authored position ${index + 1}\nPreserve the complete authorized source position ${index + 1}.`).join("\n\n"),
      },
    }],
  };
  assert.throws(
    () => buildManagedProductionPlan("slides", snapshot),
    (error) => error instanceof RangeError && /managed_presentation_slide_count_exceeds_supported_maximum:100/.test(error.message),
    "an oversized authored outline must fail visibly instead of dropping its one-hundred-and-first source slide",
  );
});

test("managed presentations also reject an oversized inferred storyboard baseline before any provider reservation", () => {
  const snapshot = productionFixture(101);
  assert.throws(
    () => buildManagedProductionPlan("slides", snapshot),
    (error) => error instanceof RangeError && /managed_presentation_slide_count_exceeds_supported_maximum:100/.test(error.message),
    "an inferred one-hundred-and-one-scene presentation must not bypass the authored/requested slide ceiling",
  );
});

test("managed outline planning preserves substantive colons inside authored slide titles", () => {
  const snapshot = {
    facts: [{
      block_id: "PRIVATE_COLON_SOURCE_BLOCK_8731",
      type: "direction",
      properties: {
        text: "Slide 1 — Opportunity: trustworthy creative production\nProtect authored intent and reviewer confidence.\n\nSlide 2 — Navigation: Projects / Work / Explore / Activity / Deliver\nPreserve the stable five-destination information architecture.",
      },
    }],
  };
  const plan = buildManagedProductionPlan("slides", snapshot);
  assert.equal(plan.authoredSlideCount, 2);
  assert.deepEqual(plan.scenes.map((scene) => scene.title), ["Opportunity: trustworthy creative production", "Navigation: Projects / Work / Explore / Activity / Deliver"]);
  assert.ok(plan.scenes.every((scene) => scene.sourceBlockIds.includes("PRIVATE_COLON_SOURCE_BLOCK_8731")));
});

test("requested managed slide expansion without a numbered outline grounds every generated position in active authorized source claims", () => {
  const snapshot = {
    facts: [
      { block_id: "PRIVATE_ACTIVE_SOURCE_BLOCK_8731", type: "direction", properties: { text: "Explain the approved product strategy with accessible, reviewable, source-grounded decisions." } },
      { block_id: "PRIVATE_INACTIVE_SOURCE_BLOCK_8731", type: "direction", active: false, properties: { text: "Unauthorized disabled customer evidence must never appear." } },
    ],
  };
  const plan = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 6 });

  assert.equal(plan.authoredSlideCount, 0);
  assert.equal(plan.requestedSlideCount, 6);
  assert.equal(plan.predictedSlideCount, 6);
  assert.equal(plan.scenes.length, 6);
  assert.ok(plan.scenes.every((scene) => scene.sourceBlockIds.length > 0 && scene.sourceClaimIds.length > 0), "every requested slide position must retain real source evidence");
  assert.deepEqual(plan.scenes.map((scene) => scene.sourceBlockIds), Array.from({ length: 6 }, () => ["PRIVATE_ACTIVE_SOURCE_BLOCK_8731"]));
  assert.ok(plan.claims.every((claim) => claim.blockId !== "PRIVATE_INACTIVE_SOURCE_BLOCK_8731"));
  assert.equal(plan.providerBatchCount, 1);
  assert.equal(plan.estimatedPlanningCostMicrousd, 1_000_000);
});

test("thirty unnumbered decisions and seven targeted chapters remain exactly seven isolated slides", () => {
  const targets = ["last slide", "Slide 3", "Slide 6", "first slide", "Slide 2", "Slide 4", "Slide 5"];
  const expectedPositions = [7, 3, 6, 1, 2, 4, 5];
  const snapshot = {
    facts: Array.from({ length: 30 }, (_, index) => {
      const group = Math.min(6, Math.floor(index * 7 / 30));
      return {
        block_id: `PRIVATE_INCIDENT_SOURCE_${index + 1}`,
        type: "message",
        locked: true,
        properties: {
          label: `Evidence ${index + 1}`,
          text: `Authorized decision ${index + 1} supports bounded chapter ${group + 1}.`,
          combined_context_memberships: [{
            context_set_id: `PRIVATE_INCIDENT_GROUP_${group + 1}`,
            name: `Chapter ${group + 1}`,
            target: targets[group],
            role: "slide_chapter",
            application: "isolate",
            relativity: .95,
            member_order: index,
          }],
        },
      };
    }),
  };

  const plan = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 7 });

  assert.equal(minimumPresentationSlideCount(snapshot),7);
  assert.equal(buildManagedProductionPlan("slides",snapshot).predictedSlideCount,7,"independently authored chapters determine the default without silently merging source groups");
  assert.throws(()=>buildManagedProductionPlan("slides",snapshot,{requestedSlideCount:6}),(error)=>error.code==="presentation_slide_count_conflict");
  assert.equal(plan.authoredSlideCount, 0);
  assert.equal(plan.requestedSlideCount, 7);
  assert.equal(plan.predictedSlideCount, 7);
  assert.equal(plan.scenes.length, 7);
  assert.equal(plan.providerBatchCount, 1);
  assert.deepEqual(plan.providerBatches.map(({ startSlide, endSlide, slideCount }) => [startSlide, endSlide, slideCount]), [[1, 7, 7]]);
  for (const [groupIndex, expectedPosition] of expectedPositions.entries()) {
    const groupId = `PRIVATE_INCIDENT_GROUP_${groupIndex + 1}`;
    const positions = plan.scenes.flatMap((scene) => scene.contextGroupIds.includes(groupId) ? [scene.narrativeOrder] : []);
    assert.deepEqual(positions, [expectedPosition], `Chapter ${groupIndex + 1} must occur only on its explicitly targeted slide`);
    const sourceIds = snapshot.facts.filter((fact) => fact.properties.combined_context_memberships[0].context_set_id === groupId).map((fact) => fact.block_id);
    assert.deepEqual(new Set(plan.scenes[expectedPosition - 1].sourceBlockIds), new Set(sourceIds));
  }
});

test("relationship-authored isolated presentation chapters retain their own source groups throughout planning",()=>{
  const facts=Array.from({length:3},(_,index)=>[
    {block_id:`PRIVATE_RELATION_CHAPTER_${index+1}`,type:"message",locked:true,properties:{label:`Relationship chapter ${index+1}`,text:`Authorized presentation chapter ${index+1}.`,context_group:{name:`Relationship chapter ${index+1}`,role:"slide_chapter",application:"isolate",target:`Slide ${index+1}`}}},
    {block_id:`PRIVATE_RELATION_DECISION_${index+1}`,type:"message",locked:true,properties:{label:`Approved chapter evidence ${index+1}`,text:`Independent approved customer decision ${index+1}.`}},
  ]).flat();
  const relationships=Array.from({length:3},(_,index)=>({relation_id:`relationship-${index+1}`,from_block_id:`PRIVATE_RELATION_CHAPTER_${index+1}`,to_block_id:`PRIVATE_RELATION_DECISION_${index+1}`,kind:"context_contains",properties:{member_order:0}}));
  const snapshot={facts,relationships};
  assert.equal(minimumPresentationSlideCount(snapshot),3);
  const production=buildManagedProductionPlan("slides",snapshot,{requestedSlideCount:3});
  const contract=buildPresentationSourceContract(snapshot,{requestedSlideCount:3,itemCount:3});
  for(const [index,scene]of production.scenes.entries()){
    const expected=new Set([`PRIVATE_RELATION_CHAPTER_${index+1}`,`PRIVATE_RELATION_DECISION_${index+1}`]);
    assert.deepEqual(new Set(scene.sourceBlockIds),expected);
    assert.deepEqual(scene.contextGroupIds,[`PRIVATE_RELATION_CHAPTER_${index+1}`]);
    const scoped=productionSceneSnapshot(snapshot,scene);
    assert.deepEqual(new Set(scoped.facts.map((fact)=>fact.block_id)),expected,"relationship-scoped decisions must never leak into another chapter's provider snapshot");
    for(const sourceId of expected){const source=contract.sources.find((entry)=>entry.sourceKind==="block"&&entry.sourceId===sourceId);assert.deepEqual(source.contextGroupIds,[`PRIVATE_RELATION_CHAPTER_${index+1}`]);}
  }
  const collision=structuredClone(snapshot);
  collision.facts[2].properties.context_group.target="Slide 1";
  assert.throws(()=>buildManagedProductionPlan("slides",collision,{requestedSlideCount:3}),(error)=>error.code==="presentation_context_target_conflict");
});

test("explicit slide targets preserve contiguous ranges and reject ambiguity or conflicting placements", () => {
  const snapshot = {
    facts: [...Array.from({ length: 6 }, (_, index) => ({
      block_id: `PRIVATE_TARGET_SOURCE_${index + 1}`,
      type: "message",
      locked: true,
      properties: {
        text: `Authorized ordered evidence ${index + 1}.`,
        combined_context_memberships: [{
          context_set_id: "PRIVATE_TARGET_GROUP",
          name: "Ordered evidence",
          target: "Slides 3–5",
          role: "slide_chapter",
          application: "ordered",
          member_order: index,
        }],
      },
    })), { block_id: "PRIVATE_TARGET_GLOBAL_SOURCE", type: "message", locked: true, properties: { text: "Approved global presentation context grounds positions outside the isolated chapter." } }],
  };
  const plan = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 7 });
  assert.deepEqual(plan.scenes.flatMap((scene) => scene.contextGroupIds.includes("PRIVATE_TARGET_GROUP") ? [scene.narrativeOrder] : []), [3, 4, 5]);

  for (const target of ["Slide 0", "Slide 8", "Slides 5–3", "Slide 2 or Slide 6"]) {
    const invalid = structuredClone(snapshot);
    for (const fact of invalid.facts) if (fact.properties.combined_context_memberships) fact.properties.combined_context_memberships[0].target = target;
    assert.throws(() => buildManagedProductionPlan("slides", invalid, { requestedSlideCount: 7 }), (error) => error instanceof RangeError && /Combined Context/u.test(error.message), `invalid target ${target} must fail before provider work`);
  }

  const conflicting = structuredClone(snapshot);
  conflicting.facts[0].properties.combined_context_memberships[0].target = "Slide 2";
  conflicting.facts[1].properties.combined_context_memberships[0].target = "Slide 6";
  assert.throws(() => buildManagedProductionPlan("slides", conflicting, { requestedSlideCount: 7 }), /conflicting presentation targets/u);

  const sameFactConflict = structuredClone(snapshot);
  sameFactConflict.facts[0].properties.combined_context_memberships.push({
    ...sameFactConflict.facts[0].properties.combined_context_memberships[0],
    target: "Slide 6",
  });
  assert.throws(() => buildManagedProductionPlan("slides", sameFactConflict, { requestedSlideCount: 7 }), /conflicting presentation targets/u);

  const impossible = { facts: [structuredClone(snapshot.facts[0])] };
  impossible.facts[0].properties.combined_context_memberships[0].target = "Slide 3";
  assert.throws(() => buildManagedProductionPlan("slides", impossible, { requestedSlideCount: 7 }), /no authorized source decision/u);
});

test("a valid explicit slide count is not rejected because unnumbered source evidence exceeds the old baseline", () => {
  const snapshot = {
    facts: Array.from({ length: 201 }, (_, index) => ({
      block_id: `PRIVATE_DENSE_SOURCE_${index + 1}`,
      type: "message",
      locked: true,
      properties: { text: `Distinct approved source evidence ${index + 1}.` },
    })),
  };
  const plan = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 7 });
  assert.equal(plan.predictedSlideCount, 7);
  assert.equal(plan.providerBatchCount, 1);
  assert.equal(plan.scenes.flatMap((scene) => scene.sourceBlockIds).length, 201);
});

test("decomposes arbitrarily long authored context into legal, non-repeating anchor-first scenes", () => {
  const snapshot = productionFixture(40, 20);
  const plan = buildManagedProductionPlan("video", snapshot, { references: approvedReferences([1, 20, 40]) });

  assert.equal(plan.scenes.length, 40, "the legacy twelve-item planner cap must not truncate the production");
  assert.deepEqual(plan.narrativeOrder, plan.scenes.map((scene) => scene.id));
  assert.equal(plan.scenes.find((scene) => scene.id === plan.anchorSceneId)?.narrativeOrder, 20);
  assert.equal(plan.executionOrder[0], plan.anchorSceneId);
  assert.notDeepEqual(plan.executionOrder, plan.narrativeOrder);
  assert.ok(plan.scenes.every((scene) => scene.durationSeconds >= 4 && scene.durationSeconds <= 15));
  assert.ok(plan.scenes.every((scene) => scene.referenceIds.length <= VIDEO_ADAPTER_CONTRACT.maxReferenceImages));
  assert.ok(plan.parallelWaves.every((wave) => wave.length <= 3));
  assert.ok(plan.parallelWaves.some((wave) => wave.length > 1));
  assert.equal(plan.providerCapabilities.nativeBoundaryFrames, false);
  assert.equal(plan.providerCapabilities.finalVideoComposition, false);
  assert.equal(plan.providerCapabilities.assembly, "ordered-scene-reel");

  const positions = new Map(plan.executionOrder.map((id, index) => [id, index]));
  for (const scene of plan.scenes) for (const dependency of scene.dependsOn) {
    assert.ok(positions.get(dependency) < positions.get(scene.id), `${scene.id} starts before ${dependency}`);
  }
  const authoredIds = plan.scenes.flatMap((scene) => scene.sourceBlockIds.filter((id) => id.startsWith("shot-")));
  assert.equal(new Set(authoredIds).size, 40);
  assert.equal(authoredIds.length, 40, "narrative beats cannot be duplicated between independent clips");
  assert.equal(plan.estimatedVideoCostMicrousd, plan.totalDurationSeconds * VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd["720p"]);
});

test("all managed production teams prefer edited generated-image palettes over immutable extraction evidence",()=>{
  const snapshot={facts:[{block_id:"edited-image",type:"reference",properties:{label:"Customized image",text:"Preserve my chosen colors",palette:["#112233","#ff6699"],output_palette:["#112233","#ff6699"],colors:["#aaaaaa"]}}]};
  for(const format of ["image","video","storyboard","slides","scene","short_story"]){const plan=buildManagedProductionPlan(format,snapshot);assert.deepEqual(plan.continuityBible.palette,["#112233","#ff6699"],format);assert.match(JSON.stringify(plan),/#112233/);assert.match(JSON.stringify(plan),/#ff6699/);assert.doesNotMatch(JSON.stringify(plan),/#aaaaaa/);}
});

test("structured adopted outputs preserve every ordered edited beat without leaking neighboring artifact items", () => {
  const items = Array.from({ length: 17 }, (_, offset) => ({
    source_artifact_item_id: `item-${offset + 1}`,
    title: `Authored movement ${offset + 1}`,
    body: offset === 16 ? "THE FINAL CAREFULLY EDITED REVELATION" : `Distinct authored movement ${offset + 1}`,
    notes: `Exact camera movement ${offset + 1}`,
    context_group_ids: [offset % 2 ? "cast-ivo" : "cast-mara"],
  }));
  const snapshot = { facts: [{ block_id: "adopted-film", type: "motion", locked: true, properties: { source_artifact_id: "film-original", text: "A whole imported film must never leak into each individual scene.", artifact_structure: { items } } }] };
  const claims = productionClaims(snapshot);
  const plan = buildManagedProductionPlan("video", snapshot);
  assert.equal(claims.length, 17);
  assert.equal(plan.scenes.length, 17);
  assert.match(plan.scenes.at(-1).action, /FINAL CAREFULLY EDITED REVELATION/);
  assert.deepEqual(plan.scenes[0].contextGroupIds, ["cast-mara"]);
  assert.deepEqual(plan.scenes[1].contextGroupIds, ["cast-ivo"]);

  const first = productionSceneSnapshot(snapshot, plan.scenes[0]);
  assert.equal(first.facts[0].properties.artifact_structure.items.length, 1);
  assert.equal(first.facts[0].properties.artifact_structure.items[0].source_artifact_item_id, "item-1");
  assert.doesNotMatch(JSON.stringify(first), /Distinct authored movement 2|FINAL CAREFULLY EDITED REVELATION/);
});

test("materialized adopted storyboard children replace rather than duplicate their structured parent items", () => {
  const snapshot = { facts: [
    { block_id: "storyboard-root", type: "direction", properties: { source_artifact_id: "source-board", artifact_structure: { items: [
      { source_artifact_item_id: "frame-1", title: "First authored shot", body: "Mara crosses the river." },
      { source_artifact_item_id: "frame-2", title: "Second authored shot", body: "Ivo opens the observatory." },
    ] } } },
    { block_id: "materialized-frame", type: "reference", properties: { source_artifact_id: "source-board", source_artifact_item_id: "frame-1", storyboard_frame_index: 1, storyboard_shot_title: "First authored shot", storyboard_shot_direction: "Mara crosses the river.", text: "Mara crosses the river." } },
  ] };
  const claims = productionClaims(snapshot);
  const plan = buildManagedProductionPlan("video", snapshot);
  assert.equal(claims.length, 2);
  assert.equal(plan.scenes.length, 2);
  assert.equal(claims.filter((claim) => claim.artifactItemId === "frame-1").length, 1);
});

test("nested exclusions remain prohibitions and scoped continuity never enters a different target", () => {
  const snapshot = { facts: [
    { block_id: "mara", type: "subject", locked: true, properties: { text: "Mara wears a silver compass.", combined_context_memberships: [membership("cast-mara", "Mara")] } },
    { block_id: "ivo", type: "subject", locked: true, properties: { text: "Ivo carries a cobalt lantern.", combined_context_memberships: [membership("cast-ivo", "Ivo")] } },
    { block_id: "beats", type: "motion", properties: { source_artifact_id: "owned-film", artifact_structure: { items: [
      { source_artifact_item_id: "mara-shot", title: "Mara enters", body: "Mara discovers the compass.", context_group_ids: ["cast-mara"] },
      { source_artifact_item_id: "ivo-shot", title: "Ivo enters", body: "Ivo opens the observatory.", context_group_ids: ["cast-ivo"] },
      { source_artifact_item_id: "forbidden", type: "exclusion", intent: "prohibit", effect: "must_not_include", title: "NEVER_SHOW_FORBIDDEN_LOGO", body: "No forbidden logo may appear.", context_group_ids: ["cast-mara"] },
    ] } } },
    { block_id: "mara-only-ban", type: "exclusion", effect: "must_not_include", properties: { text: "MARA_ONLY_RED_COAT", combined_context_memberships: [membership("cast-mara", "Mara")] } },
  ], standing_constraints: [{ authority: "authored", axis: "style", polarity: "forbid", value: "No modern cars." }] };
  const plan = buildManagedProductionPlan("video", snapshot);
  const mara = plan.scenes.find((scene) => scene.action.includes("Mara discovers"));
  const ivo = plan.scenes.find((scene) => scene.action.includes("Ivo opens"));
  assert.equal(plan.claims.find((claim) => claim.artifactItemId === "forbidden").negative, true);
  assert.ok(!plan.scenes.some((scene) => scene.action.includes("NEVER_SHOW_FORBIDDEN_LOGO")));
  assert.ok(providerFacingProductionContinuity(plan, mara).prohibitions.some((value) => value.includes("MARA_ONLY_RED_COAT")));
  assert.ok(!providerFacingProductionContinuity(plan, ivo).prohibitions.some((value) => value.includes("MARA_ONLY_RED_COAT")));
  const instructions = productionTeamInstructions(plan, [ivo]);
  assert.doesNotMatch(instructions, /MARA_ONLY_RED_COAT|requiredBlockIds|mara-only-ban/);
  assert.match(instructions, /No modern cars/);
});

test("same-index scoped storyboard references never cross character targets", () => {
  const snapshot = productionFixture(2);
  const references = [
    { referenceId: "mara-image", blockId: "unrelated-mara", sequence: 1, contextGroupIds: ["cast-mara"], label: "Mara frame one" },
    { referenceId: "ivo-image", blockId: "unrelated-ivo", sequence: 1, contextGroupIds: ["cast-ivo"], label: "Ivo frame one" },
  ];
  const plan = buildManagedProductionPlan("video", snapshot, { references });
  assert.ok(plan.scenes[0].referenceIds.includes("mara-image"));
  assert.ok(!plan.scenes[0].referenceIds.includes("ivo-image"));
  assert.ok(!plan.scenes[1].referenceIds.includes("mara-image"));
});

test("provider parallelism is finite, bounded, and safe for malformed values", () => {
  const snapshot = productionFixture(8);
  const references = approvedReferences(Array.from({ length: 8 }, (_, index) => index + 1));
  for (const maximumParallelScenes of [Number.NaN, Number.POSITIVE_INFINITY, 99, 2.7, -8, 0]) {
    const plan = buildManagedProductionPlan("video", snapshot, { references, maximumParallelScenes });
    assert.equal(plan.executionOrder.length, 8);
    assert.ok(plan.parallelWaves.every((wave) => wave.length >= 1 && wave.length <= 3));
  }
});

test("all six reusable production contracts expose legal truthful work graphs", () => {
  const snapshot = productionFixture(3);
  for (const format of ["video", "storyboard", "slides", "short_story", "scene", "image"]) {
    const plan = buildManagedProductionPlan(format, snapshot);
    const system = productionSystemFor(format);
    const units = productionUnitsForPlan(plan);
    assert.equal(system.teamId, plan.team.id);
    assert.equal(system.capabilities.nativeBoundaryFrames, false);
    assert.equal(system.capabilities.videoFrameExtraction, false);
    assert.equal(system.capabilities.finalVideoComposition, false);
    assert.doesNotThrow(() => validateProductionUnits(units));
    assert.ok(units.some((unit) => unit.kind === "review"), `${format} needs a visible production quality checkpoint`);
    if (format === "video") {
      assert.equal(system.capabilities.maxUnitDurationSeconds, 15);
      assert.equal(system.capabilities.maxReferencesPerUnit, 9);
      assert.ok(units.some((unit) => unit.kind === "look-development"));
    } else assert.ok(!units.some((unit) => unit.kind === "look-development"));
  }
});

test("keeps locked global continuity while isolating scoped characters and unrelated storyboard beats", () => {
  const snapshot = productionFixture(8, 4);
  const plan = buildManagedProductionPlan("video", snapshot, { references: approvedReferences([4]) });
  const maraScene = plan.scenes.find((scene) => scene.narrativeOrder === 1);
  const ivoScene = plan.scenes.find((scene) => scene.narrativeOrder === 2);
  const mara = productionSceneSnapshot(snapshot, maraScene);
  const ivo = productionSceneSnapshot(snapshot, ivoScene);
  const maraIds = new Set(mara.facts.map((fact) => fact.block_id));
  const ivoIds = new Set(ivo.facts.map((fact) => fact.block_id));

  assert.ok(maraIds.has("mara"));
  assert.ok(!maraIds.has("ivo"));
  assert.ok(maraIds.has("moonlight"));
  assert.ok(maraIds.has("avoid-crowds"));
  assert.ok(maraIds.has("shot-1"));
  assert.ok(!maraIds.has("shot-2"));
  assert.ok(ivoIds.has("ivo"));
  assert.ok(!ivoIds.has("mara"));
  assert.ok(ivoIds.has("shot-2"));
  assert.ok(!ivoIds.has("shot-1"));
  assert.deepEqual(mara.context_groups.map((group) => group.id), ["cast-mara"]);
  assert.deepEqual(ivo.context_groups.map((group) => group.id), ["cast-ivo"]);
});

test("every production shot retains ungrouped audience, emotion, and message without leaking scoped direction", () => {
  const snapshot = productionFixture(3);
  snapshot.facts.unshift(
    { block_id: "global-audience", type: "audience", properties: { text: "GLOBAL_SLOW_TRAVEL_AUDIENCE" } },
    { block_id: "global-emotion", type: "emotion", properties: { text: "GLOBAL_QUIET_MAGNETIC_FEELING" } },
    { block_id: "global-message", type: "message", properties: { text: "GLOBAL_FIND_THE_QUIETER_WAY" } },
    { block_id: "individual-beat", type: "message", locked: true, properties: { subtype: "Narrative beat", text: "ONLY_ONE_AUTHORED_NARRATIVE_MOVEMENT" } },
    { block_id: "mara-only-emotion", type: "emotion", properties: { text: "MARA_ONLY_RESTORATIVE_MOOD", combined_context_memberships: [membership("cast-mara", "Mara")] } },
  );
  for (const fact of snapshot.facts) if (["shot-1", "shot-3"].includes(fact.block_id)) fact.locked = true;
  for (const format of ["storyboard", "video"]) {
    const plan = buildManagedProductionPlan(format, snapshot);
    for (const scene of plan.scenes) {
      const scoped = productionSceneSnapshot(snapshot, scene);
      const ids = new Set(scoped.facts.map((fact) => fact.block_id));
      for (const id of ["global-audience", "global-emotion", "global-message"]) assert.ok(ids.has(id), `${format} scene ${scene.narrativeOrder}: ${id}`);
      if (!scene.sourceBlockIds.includes("individual-beat")) assert.ok(!ids.has("individual-beat"), `${format} scene ${scene.narrativeOrder} leaked another narrative beat`);
      for (const shot of ["shot-1", "shot-3"]) if (!scene.sourceBlockIds.includes(shot)) assert.ok(!ids.has(shot), `${format} scene ${scene.narrativeOrder} leaked locked ${shot}`);
      if (!scene.contextGroupIds.includes("cast-mara")) assert.ok(!ids.has("mara-only-emotion"), `${format} scene ${scene.narrativeOrder} leaked Mara's mood`);
    }
  }
});

test("independent approved scene references are parallelized without exceeding provider reference limits", () => {
  const snapshot = productionFixture(9, 5);
  const references = approvedReferences(Array.from({ length: 9 }, (_, index) => index + 1));
  const plan = buildManagedProductionPlan("video", snapshot, { references, maximumParallelScenes: 3 });
  assert.equal(plan.parallelWaves[0].length, 1);
  assert.equal(plan.parallelWaves[0][0], plan.anchorSceneId);
  assert.ok(plan.parallelWaves.slice(1).some((wave) => wave.length === 3));
  assert.ok(plan.scenes.every((scene) => scene.referenceIds.includes(`reference-${scene.narrativeOrder}`)));

  const crowded = buildManagedProductionPlan("video", snapshot, {
    references: [...references, ...Array.from({ length: 25 }, (_, index) => ({ referenceId: `shared-${index}`, blockId: `shared-${index}`, sequence: null, contextGroupIds: [], label: `Shared identity reference ${index}` }))],
  });
  assert.ok(crowded.scenes.every((scene) => scene.referenceIds.length <= 9));
});

test("frozen manual-versus-managed benchmark proves tenfold planning-defect reduction without claiming rendered-media quality", () => {
  const plan = buildManagedProductionPlan("video", productionFixture(40, 20), { references: approvedReferences([1, 20, 40]) });
  const baseline = scoreManualVideoBaseline(plan, 15);
  const managed = scoreManagedProductionPlan(plan);
  const reduction = productionDefectReduction(baseline, managed);

  assert.equal(baseline.basis, "deterministic-plan-contract");
  assert.equal(managed.basis, "deterministic-plan-contract");
  assert.ok(baseline.contextCoverage <= .1);
  assert.equal(managed.contextCoverage, 1);
  assert.equal(managed.requiredClaimCoverage, 1);
  assert.equal(managed.nonDuplication, 1);
  assert.ok(managed.score >= .9);
  assert.ok(reduction >= 10, `expected >=10× planning-defect reduction; received ${reduction.toFixed(2)}×`);
  assert.ok(!("renderedMediaReviewed" in managed));
});

const costBudgets = (usedMicrousd, overrides = {}) => ({
  period: "2026-08",
  currency: "USD",
  user: { usedMicrousd, reservedMicrousd: 0, limitMicrousd: 100_000_000, remainingMicrousd: 100_000_000 - usedMicrousd, ...overrides.user },
  workspace: { usedMicrousd: 0, reservedMicrousd: 0, limitMicrousd: 1_000_000_000, remainingMicrousd: 1_000_000_000, ...overrides.workspace },
});

test("monthly dollar gates use strict 60/80 thresholds, every-generation warnings, and mandatory 95% resurfacing", () => {
  assert.equal(generationBudgetGate(costBudgets(59_900_000)).level, "none");
  assert.equal(generationBudgetGate(costBudgets(60_000_000)).level, "none");
  assert.equal(generationBudgetGate(costBudgets(60_000_001)).level, "notice");
  assert.equal(generationBudgetGate(costBudgets(79_999_999)).level, "notice");
  assert.equal(generationBudgetGate(costBudgets(80_000_000)).level, "notice");
  assert.equal(generationBudgetGate(costBudgets(80_000_001)).level, "every-generation");
  assert.equal(generationBudgetGate(costBudgets(94_900_000), { suppressedUntilCritical: true }).level, "none");
  assert.equal(generationBudgetGate(costBudgets(95_000_000), { suppressedUntilCritical: true }).level, "critical");
  assert.equal(generationBudgetGate(costBudgets(95_000_000), { suppressedUntilCritical: true }).dismissible, false);
  assert.equal(generationBudgetGate(costBudgets(60_100_000), { noticeAcknowledged: true }).requiresAcknowledgement, false);
  assert.equal(generationBudgetGate(costBudgets(80_100_000), { noticeAcknowledged: true }).requiresAcknowledgement, true);
  assert.equal(generationBudgetGate(costBudgets(99_900_000), { projectedMicrousd: 200_000 }).level, "blocked");
  assert.equal(generationBudgetGate(costBudgets(59_900_000), { projectedMicrousd: 200_000 }).level, "notice");

  const constrainedOrg = generationBudgetGate(costBudgets(10_000_000, { workspace: { usedMicrousd: 810_000_000 } }));
  assert.equal(constrainedOrg.scope, "workspace");
  assert.equal(constrainedOrg.level, "every-generation");
  assert.notEqual(generationBudgetPreferenceKey("person-one", "2026-08", "suppressed"), generationBudgetPreferenceKey("person-one", "2026-09", "suppressed"));
  assert.notEqual(generationBudgetPreferenceKey("person-one", "2026-08", "suppressed"), generationBudgetPreferenceKey("person-two", "2026-08", "suppressed"));
  assert.notEqual(generationBudgetPreferenceKey("person-one","2026-08","suppressed","organization-a"),generationBudgetPreferenceKey("person-one","2026-08","suppressed","organization-b"));
  assert.equal(generationBudgetPreferenceKey("person-one","2026-08","suppressed",null),generationBudgetPreferenceKey("person-one","2026-08","suppressed"));
});

test("failed managed scene productions remain visibly recoverable without exposing private provider receipts", () => {
  const failure = { code: "fal_result_response_invalid", category: "network", scope: "provider", action: "retry", message: "A paid scene result could not be downloaded.", retryable: true, retryAfterMs: null, requestId: "fal-paid-scene", httpStatus: 502 };
  const base = { kind: "render_document", status: "failed", members: [], result: { artifactKind: "video", recoverableProductionProviderRequest: true }, errorDetail: failure };
  assert.equal(documentJobCanRecoverProviderRender(base), true);
  assert.equal(documentJobCanRecoverProviderRender({ ...base, result: { artifactKind: "video", productionSceneReceipts: { "scene-2": { sceneId: "scene-2", status: "submitted", providerJobId: "fal-paid-scene" } } } }), true);
  assert.equal(documentJobCanRecoverProviderRender({ ...base, result: { artifactKind: "video" } }), false);
  assert.equal(documentJobCanRecoverProviderRender({ ...base, errorDetail: { ...failure, category: "safety", retryable: false, httpStatus: 422 } }), false);

  const progress = documentJobProgress({ ...base, status: "running", stage: "rendering-scenes", progressMessage: "2 of 5 production scenes are safely stored." });
  assert.equal(progress.label, "Render");
  assert.match(progress.detail, /2 of 5 scenes stored/);
});

test("the thirty-decision seven-chapter incident generates seven source-local hero slides in one mocked provider request",async()=>{
  const targets=["last slide","Slide 3","Slide 6","first slide","Slide 2","Slide 4","Slide 5"];
  const snapshot={facts:Array.from({length:30},(_,index)=>{const group=Math.min(6,Math.floor(index*7/30));return{block_id:`PRIVATE_INCIDENT_BLOCK_${index+1}`,type:"message",locked:true,properties:{label:`Evidence ${index+1} key`,text:`Approved source decision ${index+1} supports isolated editorial chapter ${group+1}.`,combined_context_memberships:[{context_set_id:`PRIVATE_INCIDENT_CHAPTER_${group+1}`,name:`Chapter ${group+1}`,target:targets[group],role:"slide_chapter",application:"isolate",relativity:.95,member_order:index}]}};})};
  const production=buildManagedProductionPlan("slides",snapshot,{requestedSlideCount:7});
  const originalFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async(_url,init={})=>{
    const request=JSON.parse(String(init.body));requests.push(request);
    const provider=JSON.parse(request.input);
    const scenes=provider.production.assigned_scenes;
    const items=scenes.map((scene)=>({title:`Bounded editorial position ${scene.narrative_order}`,body:scene.action,notes:`Approved evidence for position ${scene.narrative_order}.`,image_prompt:"",context_group_ids:scene.context_keys,slide:{layout:scene.narrative_order===7?"closing":"statement",kicker:`Independent section ${scene.narrative_order}`,bullets:[],source_ids:scene.source_keys,visual:{kind:"hero-type",label:`Source finding ${scene.narrative_order}`,value:`Bounded editorial position ${scene.narrative_order}`,data:[]}}}));
    items[6].title=provider.presentation_source.sources.find((source)=>source.alias===scenes[0].source_keys[0]).label;
    items[6].slide.visual.value=items[6].title;
    const presentation={aspect_ratio:"16:9",theme:"Seven isolated source chapters",footer_label:"Authorized editorial evidence",style_preset:"field-notes",mode:"light",palette:{background:"#edf1ef",foreground:"#14211d",accent:"#287260",muted:"#586b64",surface:"#d9e3df"}};
    return Response.json({id:"incident-seven-slide-mock",model:"gpt-5.6-terra",output_text:JSON.stringify({title:"Seven bounded editorial positions",summary:"Seven explicitly targeted source chapters remain isolated.",content_markdown:items.map((item,index)=>`## ${index+1}. ${item.title}\n${item.body}`).join("\n\n"),presentation,items}),usage:{input_tokens:900,output_tokens:600,total_tokens:1500}});
  };
  try{
    const generated=await generateManagedArtifactDraft({OPENAI_API_KEY:"test-only",OPENAI_MODEL:"gpt-5.6-terra"},"owner","slides",{documentTitle:"All approved source chapters",snapshot,production,requestedSlideCount:7});
    assert.equal(requests.length,1,"seven explicitly requested slides require exactly one mocked provider request and no paid repair");
    assert.equal(generated.output.items.length,7);
    assert.equal(generated.output.items[6].title,production.contextGroups.find((group)=>group.id===production.scenes[6].contextGroupIds[0]).name,`a duplicated final title must be replaced only with its own authorized chapter label: ${JSON.stringify(generated.output.items.map((item)=>({title:item.title,visual:item.slide.visual.value})))}`);
    assert.equal(new Set(generated.output.items.map((item)=>item.title.toLowerCase())).size,7);
    assert.deepEqual(generated.output.items.map((item)=>item.context_group_ids),production.scenes.map((scene)=>scene.contextGroupIds));
    assert.ok(generated.output.items.every((item)=>item.slide?.visual.kind==="hero-type"&&/^Evidence \d+ key$/u.test(item.slide.visual.value)),"title-duplicating hero values are recovered from exact authorized source labels without another provider call");
    assert.ok(generated.output.items.every((item,index)=>item.slide.sourceIds.every((sourceId)=>production.scenes[index].sourceBlockIds.includes(sourceId))));
    assert.match(requests[0].instructions,/hero-type or metric visual needs exactly one meaningful source-authored visual\.value/u);
    assert.doesNotMatch(JSON.stringify(requests[0]),/PRIVATE_INCIDENT_BLOCK_|PRIVATE_INCIDENT_CHAPTER_/u,"durable source and context identifiers never leave Forma");
    assert.equal(generated.usage.totalTokens,1500);
  }finally{globalThis.fetch=originalFetch;}
});

test("managed provider planning pages long films without inheriting the legacy twelve-scene schema", async () => {
  const snapshot = { facts: Array.from({ length: 17 }, (_, offset) => ({ block_id: `shot-${offset + 1}`, type: "reference", properties: { text: `Unique action ${offset + 1}`, storyboard_frame_index: offset + 1, source_artifact_id: "ordered-storyboard", storyboard_shot_title: `Shot ${offset + 1}`, storyboard_shot_direction: `Unique action ${offset + 1}` } })) };
  const production = buildManagedProductionPlan("video", snapshot);
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    requests.push(request);
    const providerInput = JSON.parse(request.input);
    const scenes = providerInput.production.assigned_scenes;
    const output = { title: "A complete film", summary: "Every source beat has its own scene.", content_markdown: scenes.map((scene) => scene.action).join("\n"), items: scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: scene.camera_direction, image_prompt: scene.action, context_group_ids: [] })) };
    return Response.json({ id: `response-${requests.length}`, model: "gpt-5.6-terra", output_text: JSON.stringify(output), usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 } });
  };
  try {
    const planned = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "owner", "video", { documentTitle: "Complete film", snapshot, production });
    assert.equal(planned.output.items.length, 17);
    assert.deepEqual(requests.map((request) => JSON.parse(request.input).production.assigned_scenes.length), [8, 8, 1]);
    assert.ok(requests.every((request) => request.instructions.includes("separate 4–15 second provider generation")));
    assert.ok(requests.every((request) => !request.instructions.includes("compressing their beats into the available runtime")));
    assert.equal(planned.usage.totalTokens, 540);
  } finally { globalThis.fetch = originalFetch; }
});

test("long-form stories and screenplays retain later-page manuscripts and repair repeated openings once", async () => {
  for (const kind of ["short_story", "scene"]) {
    const snapshot = { facts: Array.from({ length: 10 }, (_, offset) => ({ block_id: `beat-${offset + 1}`, type: "reference", properties: { text: `Unique action ${offset + 1}`, storyboard_frame_index: offset + 1, source_artifact_id: "continuous-story", storyboard_shot_title: `Beat ${offset + 1}`, storyboard_shot_direction: `Unique action ${offset + 1}` } })) };
    const production = buildManagedProductionPlan(kind, snapshot);
    const requests = [];
    const attempts = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init = {}) => {
      const request = JSON.parse(String(init.body));
      const provider = JSON.parse(request.input);
      requests.push({ request, provider });
      const page = provider.production.page;
      const repaired = Boolean(page.repair_issues?.length);
      const scenes = provider.production.assigned_scenes;
      const items = scenes.map((scene, index) => ({ title: scene.title, body: page.page_index === 1 && index === 0 && !repaired ? "Unique action 1" : scene.action, notes: "", image_prompt: scene.action, context_group_ids: [] }));
      const markdown = page.page_index === 0 ? `# Complete work\n\n${items.map((item) => item.body).join("\n")}\n\nFIRST_PAGE_END_SENTINEL` : `# Complete work\n\n${items.map((item) => item.body).join("\n")}\n\nFINAL_MANUSCRIPT_ONLY_SENTINEL`;
      return Response.json({ id: `response-${requests.length}`, model: "gpt-5.6-terra", output_text: JSON.stringify({ title: "Complete work", summary: "A continuous work.", content_markdown: markdown, items }), usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
    };
    try {
      const output = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "owner", kind, { documentTitle: "Complete work", snapshot, production, plannerAttempt: (attempt) => attempts.push(attempt) });
      assert.equal(requests.length, 3, kind);
      assert.equal(output.inputReceipt.whole_work_validation.repaired_pages, 1, kind);
      assert.equal(output.inputReceipt.adapter_reconciliation.status,"pending",kind);
      assert.equal(output.inputReceipt.adapter_reconciliation.self_healed,true,kind);
      assert.ok(output.inputReceipt.whole_work_validation.validation_history.some(({stage,issue_count})=>stage==="review"&&issue_count>0),kind);
      assert.ok(output.inputReceipt.adapter_reconciliation.issue_codes.includes("duplicate_narrative_movement"),kind);
      assert.equal(output.output.items.length, 10, kind);
      assert.match(output.output.content_markdown, /FIRST_PAGE_END_SENTINEL/);
      assert.match(output.output.content_markdown, /FINAL_MANUSCRIPT_ONLY_SENTINEL/);
      assert.equal((output.output.content_markdown.match(/# Complete work/g) ?? []).length, 1, kind);
      assert.match(requests[1].provider.production.page.prior_ending, /FIRST_PAGE_END_SENTINEL/);
      assert.ok(requests[2].provider.production.page.repair_issues.length > 0);
      assert.deepEqual(attempts.map((attempt) => attempt.usage.totalTokens), [150, 300, 450]);
      assert.equal(output.usage.totalTokens, 450);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("multi-page decks retain one cover, correct repeated content, and lock the original presentation", async () => {
  const snapshot = { facts: Array.from({ length: 10 }, (_, offset) => ({ block_id: `slide-${offset + 1}`, type: "reference", properties: { text: `Unique action ${offset + 1}`, storyboard_frame_index: offset + 1, source_artifact_id: "ordered-slides", storyboard_shot_title: `Heading ${offset + 1}`, storyboard_shot_direction: `Unique action ${offset + 1}` } })) };
  const production = buildManagedProductionPlan("slides", snapshot);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const provider = JSON.parse(request.input);
    requests.push({ request, provider });
    const page = provider.production.page;
    const repaired = Boolean(page.repair_issues?.length);
    const presentation = { aspect_ratio: "16:9", theme: page.page_index === 1 && !repaired ? "Theme Beta" : "Theme Alpha", footer_label: "Alpha deck", style_preset: "gallery", mode: "light", palette: { background: "#ffffff", foreground: "#111111", accent: "#112233", muted: "#333333", surface: "#eeeeee" } };
    const items = provider.production.assigned_scenes.map((scene, index) => {
      const position = scene.narrative_order;
      return { title: `Heading ${position}`, body: page.page_index === 1 && index === 0 && !repaired ? "Meaning 1" : `Meaning ${position}`, notes: `Speaker ${position}`, image_prompt: `Frame ${position}`, context_group_ids: [], slide: { layout: position === 1 || page.page_index === 1 && index === 0 && !repaired ? "cover" : "split", kicker: `Kicker ${position}`, bullets: [], visual: { kind: "hero-type", label: `Label ${position}`, value: `Emphasis ${position}`, data: [{ label: `Datum ${position}`, value: `Amount ${position}`, weight: .7 }] } } };
    });
    return Response.json({ id: `slides-${requests.length}`, model: "gpt-5.6-terra", output_text: JSON.stringify({ title: "Alpha deck", summary: "A coherent presentation.", content_markdown: `# Alpha deck\n\n${items.map((item) => item.body).join("\n")}`, presentation, items }), usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
  };
  try {
    const planned = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "owner", "slides", { documentTitle: "Alpha deck", snapshot, production });
    assert.equal(requests.length, 3);
    assert.equal(planned.inputReceipt.planned_provider_request_count, 2);
    assert.equal(planned.inputReceipt.provider_request_count, 3, "the receipt must include the additional bounded whole-work repair call");
    assert.equal(planned.inputReceipt.maximum_provider_request_count, production.maximumProviderCallCount);
    assert.equal(planned.inputReceipt.whole_work_validation.repaired_pages, 1);
    assert.equal(planned.inputReceipt.adapter_reconciliation.status,"pending");
    assert.equal(planned.inputReceipt.adapter_reconciliation.self_healed,true);
    assert.equal(planned.inputReceipt.adapter_reconciliation.adapter_version,PRESENTATION_ADAPTER_VERSION);
    assert.equal(planned.output.items.length, 10);
    assert.equal(planned.output.items.filter((item) => item.slide.layout === "cover").length, 1);
    assert.equal(planned.output.items[8].body, "Meaning 9");
    assert.equal(planned.output.presentation.theme, "Theme Alpha");
    assert.equal(requests[1].provider.production.page.locked_presentation.theme, "Theme Alpha");
    assert.deepEqual(requests[1].request.text.format.schema.properties.presentation.properties.theme.enum, ["Theme Alpha"]);
    assert.equal(planned.usage.totalTokens, 450);
  } finally { globalThis.fetch = originalFetch; }
});

test("a realistic twenty-three-slide managed presentation keeps source-authorized chapters, one theme, all stakeholder evidence, and exact three-page usage", async () => {
  const snapshot = executivePresentationSnapshot(23);
  const production = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 23 });
  const requests = [];
  const attempts = [];
  const progress = [];
  const originalFetch = globalThis.fetch;
  const presentation = {
    aspect_ratio: "16:9",
    theme: "Forma evidence-led executive system",
    footer_label: "Forma responsive product strategy",
    style_preset: "field-notes",
    mode: "light",
    palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" },
  };
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const provider = JSON.parse(request.input);
    requests.push({ request, provider });
    const page = provider.production.page;
    const section = provider.combined_context_plan[0];
    assert.ok(section?.context_key, "the provider must receive a request-local section alias");
    const items = provider.production.assigned_scenes.map((scene) => {
      const position = scene.narrative_order;
      return {
        title: scene.title,
        body: executiveSlideCopy(position),
        notes: `[Sources] ${section.target}; ${scene.title}\n${executiveSlideCopy(position)}`,
        image_prompt: `Responsive presentation evidence for authored position ${position}.`,
        context_group_ids: [section.context_key],
        slide: {
          layout: position === 1 ? "cover" : position === 23 ? "closing" : "split",
          kicker: `Decision ${position}`,
          bullets: [],
          visual: {
            kind: "hero-type",
            label: `Evidence axis ${position}`,
            value: `Distinctive finding ${position}`,
            data: [{ label: `Assessment ${position}`, value: `Outcome ${position}`, weight: .85 }],
          },
        },
      };
    });
    const usage = { input_tokens: 120 + page.page_index * 10, output_tokens: 80 + page.page_index * 10 };
    return Response.json({
      id: `executive-page-${page.page_index + 1}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify({
        title: "Forma responsive product strategy",
        summary: "One coherent, source-grounded executive presentation.",
        content_markdown: `# Forma responsive product strategy\n\n${items.map((item) => `## ${item.title}\n${item.body}`).join("\n\n")}`,
        presentation,
        items,
      }),
      usage: { ...usage, total_tokens: usage.input_tokens + usage.output_tokens },
    });
  };

  try {
    const planned = await generateManagedArtifactDraft(
      { OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" },
      "authorized-actor",
      "slides",
      {
        documentTitle: "10 — Executive Opportunity — Slide-by-Slide Presentation Narrative",
        snapshot,
        production,
        audience: "Product, design, engineering, accessibility, and enterprise decision-makers",
        tone: "Evidence-backed; preserve exact scores, source facts, stakeholder quotes, and authored slide order.",
        presentationStyle: "field-notes",
        presentationFidelity: "faithful",
        requestedSlideCount: 23,
        authoredSlideCount: 23,
        progress: (stage, message) => progress.push({ stage, message }),
        plannerAttempt: (attempt) => attempts.push(structuredClone(attempt)),
      },
    );

    assert.equal(production.authoredSlideCount, 23);
    assert.equal(production.predictedSlideCount, 23);
    assert.equal(production.estimatedPlanningCostMicrousd, 3_000_000);
    assert.equal(requests.length, 3, "a valid twenty-three-slide deck needs exactly three paid provider calls");
    assert.deepEqual(requests.map(({ provider }) => provider.production.assigned_scenes.length), [8, 8, 7]);
    assert.deepEqual(requests.map(({ provider }) => provider.production.page.global_start_index), [0, 8, 16]);
    assert.deepEqual(requests.map(({ provider }) => provider.production.page.phase), ["opening", "continuation", "final"]);
    assert.ok(requests.every(({ provider }) => provider.production.page.page_count === 3 && provider.production.page.total_items === 23));
    assert.ok(requests.every(({ request }) => !/PRIVATE_SOURCE_(?:BLOCK|SECTION|CANVAS)_/.test(JSON.stringify(request))), "provider requests must not reveal durable block, section, or Canvas identifiers");
    assert.ok(requests.every(({ provider }) => provider.combined_context_plan.length === 1 && provider.combined_context_plan[0].context_key === "context_group_1"), "private provenance aliases must be local to the authorized provider page");
    assert.equal(requests[0].provider.production.page.locked_presentation, undefined);
    for (const { request, provider } of requests.slice(1)) {
      assert.equal(provider.production.page.locked_presentation.theme, presentation.theme);
      assert.deepEqual(request.text.format.schema.properties.presentation.properties.theme.enum, [presentation.theme]);
      assert.deepEqual(provider.production.page.locked_presentation.palette, presentation.palette);
    }

    assert.equal(planned.output.items.length, 23);
    assert.deepEqual(planned.output.items.map((item) => item.title), EXECUTIVE_SLIDE_TITLES);
    assert.equal(planned.output.items.filter((item) => item.slide.layout === "cover").length, 1);
    assert.equal(planned.output.items.at(-1).slide.layout, "closing");
    assert.equal(planned.output.presentation.theme, presentation.theme);
    assert.equal(planned.output.presentation.stylePreset, "field-notes");
    assert.ok(planned.output.items.every((item) => item.notes.startsWith("[Sources] ")));
    assert.deepEqual(planned.output.items.map((item) => item.context_group_ids), Array.from({ length: 23 }, (_, index) => [snapshot.facts[Math.floor(index / 8)].properties.combined_context_memberships[0].context_set_id]));
    assert.deepEqual(planned.output.items.map((item) => item.slide.sourceIds), Array.from({ length: 23 }, (_, index) => [snapshot.facts[Math.floor(index / 8)].block_id]), "every slide must retain its exact authorized source even though durable IDs never reach the provider");
    assert.match(planned.output.items[1].body, /Phone: 39\.75[\s\S]*Tablet: 53\.00[\s\S]*Small monitor: 67\.25[\s\S]*Large monitor: 68\.50[\s\S]*Adaptive\/accessibility: 58\.75[\s\S]*Governed creative loop: 79\.50/);
    assert.match(planned.output.items[1].body, /Exact equal-weight average: 61\.125[\s\S]*Rounded display value: 61\.13/);
    for (const quotation of EXECUTIVE_STAKEHOLDER_QUOTES) {
      assert.ok(planned.output.items.some((item) => item.body.includes(quotation)), `stakeholder quotation must remain visibly complete: ${quotation}`);
      assert.ok(planned.output.items.some((item) => item.notes.includes(quotation)), `stakeholder quotation must remain in source-attributed speaker notes: ${quotation}`);
      assert.ok(planned.output.content_markdown.includes(quotation), `stakeholder quotation must remain in readable generated Markdown: ${quotation}`);
    }
    assert.match(planned.output.content_markdown, /Projects \/ Work \/ Explore \/ Activity \/ Deliver/);
    assert.match(planned.output.content_markdown, /Write \/ Shape \/ Present/);
    assert.match(planned.output.content_markdown, /4–6 weeks[\s\S]*12–16 weeks/);

    assert.deepEqual(planned.responseIds, ["executive-page-1", "executive-page-2", "executive-page-3"]);
    assert.deepEqual(planned.usage, { inputTokens: 390, outputTokens: 270, totalTokens: 660 });
    assert.deepEqual(attempts.map((attempt) => attempt.usage.totalTokens), [200, 420, 660]);
    assert.deepEqual(attempts.at(-1).responseIds, planned.responseIds);
    assert.equal(planned.inputReceipt.production_mode, "managed");
    assert.equal(planned.inputReceipt.page_count, 3);
    assert.equal(planned.inputReceipt.planned_page_count, 3);
    assert.equal(planned.inputReceipt.planned_item_count, 23);
    assert.equal(planned.inputReceipt.provider_page_size, 8);
    assert.equal(planned.inputReceipt.planned_provider_request_count, 3);
    assert.equal(planned.inputReceipt.provider_request_count, 3);
    assert.equal(planned.inputReceipt.maximum_provider_request_count, production.maximumProviderCallCount);
    assert.equal(planned.inputReceipt.requested_slide_count, 23);
    assert.equal(planned.inputReceipt.authored_slide_count, 23);
    assert.equal(planned.inputReceipt.presentation_style, "field-notes");
    assert.equal(planned.inputReceipt.presentation_fidelity, "faithful");
    assert.equal(planned.inputReceipt.whole_work_validation.repaired_pages, 0);
    assert.equal(planned.inputReceipt.whole_work_validation.source_coverage_validated, true);
    assert.deepEqual(planned.inputReceipt.whole_work_validation.issues, []);
    assert.deepEqual(planned.inputReceipt.pages.map((page) => [page.page, page.item_count, page.response_id]), [[1, 8, "executive-page-1"], [2, 8, "executive-page-2"], [3, 7, "executive-page-3"]]);
    assert.ok(planned.inputReceipt.pages.every((page) => page.validation.context_group_resolution.initial.unknownAssignments.length === 0));
    assert.equal(progress.length, 3);
    assert.match(progress.at(-1).message, /17–23 of 23/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("twelve authored executive slides deliberately expand into twenty-three grounded, contiguous, complete managed presentation slides", async () => {
  const snapshot = executivePresentationSnapshot();
  const production = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 23 });
  const scoreRows = [
    ["Phone", "39.75"],
    ["Tablet", "53.00"],
    ["Small monitor", "67.25"],
    ["Large monitor", "68.50"],
    ["Adaptive/accessibility", "58.75"],
    ["Governed creative loop", "79.50"],
  ];
  const requests = [];
  const originalFetch = globalThis.fetch;
  const presentation = {
    aspect_ratio: "16:9",
    theme: "Expanded governed editorial presentation",
    footer_label: "Governed executive opportunity",
    style_preset: "field-notes",
    mode: "light",
    palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" },
  };
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const provider = JSON.parse(request.input);
    requests.push({ request, provider });
    assert.ok(provider.production?.assigned_scenes, `unexpected internal provider repair: ${JSON.stringify(provider.validation_issues ?? [])}`);
    const items = provider.production.assigned_scenes.map((scene) => {
      const position = scene.narrative_order;
      const sourceSection = snapshot.facts[position <= 4 ? 0 : position <= 8 ? 1 : 2];
      const providerSection = provider.combined_context_plan.find((section) => section.target === sourceSection.properties.label);
      assert.ok(providerSection, `authored position ${position} needs an authorized request-local source section`);
      const scorecard = position === 2;
      return {
        title: EXECUTIVE_SLIDE_TITLES[position - 1],
        body: scorecard ? "Exact equal-weight average: 61.125. Rounded display value: 61.13." : executiveSlideCopy(position),
        notes: `[Sources] ${sourceSection.properties.label}; ${executiveSlideCopy(position)}`,
        image_prompt: `Source-grounded presentation position ${position}.`,
        context_group_ids: [providerSection.context_key],
        slide: {
          layout: position === 1 ? "cover" : scorecard ? "scorecard" : position === 23 ? "closing" : "split",
          kicker: `Argument ${position}`,
          bullets: [],
          visual: scorecard
            ? {
              kind: "scorecard",
              label: "Equal-weight assessment",
              value: "61.13",
              exact_value: "61.125",
              display_value: "61.13",
              unit: "/100",
              data: scoreRows.map(([label, value]) => ({ label, value, weight: Number(value) / 100 })),
            }
            : {
              kind: "hero-type",
              label: `Evidence category ${position}`,
              value: `Decision emphasis ${position}`,
              data: [{ label: `Measure ${position}`, value: `Reading ${position}`, weight: .8 }],
            },
        },
      };
    });
    return Response.json({
      id: `expanded-executive-page-${requests.length}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify({ title: "Governed executive opportunity", summary: "Twenty-three coherent source-grounded decisions.", content_markdown: items.map((item) => item.body).join("\n"), presentation, items }),
      usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
    });
  };

  try {
    const result = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "authorized-actor", "slides", {
      documentTitle: "10 — Executive Opportunity — Slide-by-Slide Presentation Narrative",
      snapshot,
      production,
      presentationStyle: "field-notes",
      presentationFidelity: "faithful",
      requestedSlideCount: 23,
      authoredSlideCount: 12,
    });

    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map(({ provider }) => provider.production.assigned_scenes.length), [8, 8, 7]);
    assert.ok(requests.every(({ request }) => !/PRIVATE_SOURCE_(?:BLOCK|SECTION|CANVAS)_/.test(JSON.stringify(request))));
    assert.equal(result.output.items.length, 23);
    assert.deepEqual(result.output.items.slice(0, 12).map((item) => item.title), EXECUTIVE_SLIDE_TITLES.slice(0, 12));
    assert.deepEqual(result.output.items.map((item) => item.slide.sourceOrder), Array.from({ length: 23 }, (_, index) => index + 1));
    assert.deepEqual(result.output.items.map((item) => item.slide.sourceIds), Array.from({ length: 23 }, (_, index) => [snapshot.facts[index < 4 ? 0 : index < 8 ? 1 : 2].block_id]));
    assert.deepEqual(result.output.items.map((item) => item.context_group_ids), Array.from({ length: 23 }, (_, index) => [snapshot.facts[index < 4 ? 0 : index < 8 ? 1 : 2].properties.combined_context_memberships[0].context_set_id]));
    const scorecard = result.output.items[1].slide.visual;
    assert.equal(scorecard.kind, "scorecard");
    assert.equal(scorecard.exactValue, "61.125");
    assert.equal(scorecard.displayValue, "61.13");
    assert.deepEqual(scorecard.data.map((datum) => [datum.label, datum.value]), scoreRows);
    for (const [label, value] of scoreRows) assert.match(result.output.content_markdown, new RegExp(`${label.replace("/", "\\/")}: ${value.replace(".", "\\.")}`));
    assert.match(result.output.content_markdown, /\*\*Exact value:\*\* 61\.125/);
    assert.match(result.output.content_markdown, /\*\*Displayed value:\*\* 61\.13/);
    for (const quotation of EXECUTIVE_STAKEHOLDER_QUOTES) assert.ok(result.output.content_markdown.includes(quotation));
    assert.equal(result.inputReceipt.authored_slide_count, 12);
    assert.equal(result.inputReceipt.requested_slide_count, 23);
    assert.equal(result.inputReceipt.planned_item_count, 23);
    assert.equal(result.inputReceipt.provider_request_count, 3);
    assert.equal(result.inputReceipt.whole_work_validation.repaired_pages, 0);
    assert.deepEqual(result.inputReceipt.whole_work_validation.issues, []);
    assert.equal(result.usage.totalTokens, 900);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("managed presentation slides retain exact authorized source blocks when the document has no Combined Context groups", async () => {
  const snapshot = executivePresentationSnapshot();
  snapshot.facts = snapshot.facts.map((fact) => {
    const { combined_context_memberships, ...properties } = fact.properties;
    assert.ok(combined_context_memberships.length > 0);
    return { ...fact, properties };
  });
  const production = buildManagedProductionPlan("slides", snapshot);
  const requests = [];
  const originalFetch = globalThis.fetch;
  const presentation = {
    aspect_ratio: "16:9",
    theme: "Authorized executive source evidence",
    footer_label: "Executive source evidence",
    style_preset: "editorial",
    mode: "light",
    palette: { background: "#f2efe8", foreground: "#171714", accent: "#b8422f", muted: "#625e56", surface: "#ded8ca" },
  };
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const provider = JSON.parse(request.input);
    requests.push({ request, provider });
    assert.deepEqual(provider.combined_context_plan, []);
    const items = provider.production.assigned_scenes.map((scene) => {
      const position = scene.narrative_order;
      return {
        title: scene.title,
        body: executiveSlideCopy(position),
        notes: `[Sources] Authorized authored outline ${position}; ${executiveSlideCopy(position)}`,
        image_prompt: `Authorized outline direction ${position}.`,
        context_group_ids: [],
        slide: {
          layout: position === 1 ? "cover" : position === 12 ? "closing" : "split",
          kicker: `Position ${position}`,
          bullets: [],
          visual: {
            kind: "hero-type",
            label: `Source evidence ${position}`,
            value: `Decision signal ${position}`,
            data: [{ label: `Dimension ${position}`, value: `Assessment ${position}`, weight: .8 }],
          },
        },
      };
    });
    return Response.json({
      id: `ungrouped-page-${requests.length}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify({ title: "Authorized executive source evidence", summary: "Every slide has authorized evidence.", content_markdown: items.map((item) => item.body).join("\n"), presentation, items }),
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
  };

  try {
    const result = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "authorized-actor", "slides", {
      documentTitle: "Executive opportunity",
      snapshot,
      production,
      presentationStyle: "editorial",
      presentationFidelity: "faithful",
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(({ provider }) => provider.production.assigned_scenes.length), [8, 4]);
    assert.ok(requests.every(({ request }) => !/PRIVATE_SOURCE_(?:BLOCK|SECTION|CANVAS)_/.test(JSON.stringify(request))), "even ungrouped source IDs must remain server-side");
    assert.equal(result.output.items.length, 12);
    assert.ok(result.output.items.every((item) => item.context_group_ids.length === 0), "an authored block attribution must not manufacture a Combined Context assignment");
    assert.deepEqual(result.output.items.map((item) => item.slide.sourceIds), Array.from({ length: 12 }, (_, index) => [snapshot.facts[Math.floor(index / 4)].block_id]));
    assert.ok(result.output.items.every((item) => item.notes.startsWith("[Sources] ")));
    assert.equal(result.inputReceipt.provider_request_count, 2);
    assert.equal(result.inputReceipt.whole_work_validation.source_coverage_validated, true);
    assert.deepEqual(result.inputReceipt.whole_work_validation.issues, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("managed presentation receipts count bounded adapter repairs nested inside whole-work page repairs", async () => {
  const movements = [
    "Open the observatory before sunrise.",
    "Map the coastline around the harbor.",
    "Compare mountain geology with river deposits.",
    "Document migrating birds above the wetland.",
    "Record rainfall beneath the forest canopy.",
    "Trace ancestral pathways across the desert.",
    "Inspect coral restoration beyond the reef.",
    "Chart glacier retreat through the valley.",
    "Present the completed fieldwork to the community.",
  ];
  const snapshot = {
    facts: Array.from({ length: 9 }, (_, index) => ({
      block_id: `PRIVATE_REPAIR_SOURCE_BLOCK_${index + 1}_8731`,
      type: "reference",
      properties: {
        text: movements[index],
        storyboard_frame_index: index + 1,
        source_artifact_id: "PRIVATE_REPAIR_ARTIFACT_8731",
        storyboard_shot_title: `Repair-safe heading ${index + 1}`,
        storyboard_shot_direction: movements[index],
      },
    })),
  };
  const production = buildManagedProductionPlan("slides", snapshot);
  const requests = [];
  const attempts = [];
  const originalFetch = globalThis.fetch;
  const presentation = {
    aspect_ratio: "16:9",
    theme: "Repair-safe editorial system",
    footer_label: "Repair-safe production",
    style_preset: "editorial",
    mode: "light",
    palette: { background: "#f2efe8", foreground: "#171714", accent: "#b8422f", muted: "#625e56", surface: "#ded8ca" },
  };
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const provider = JSON.parse(request.input);
    const page = provider.production.page;
    const internalRepair = request.text.format.name === "document_slides_repair";
    const wholeWorkRepair = Boolean(page.repair_issues?.length);
    requests.push({ request, provider, internalRepair, wholeWorkRepair });
    const initialItems = internalRepair
      ? JSON.parse(provider.original_artifact).items
      : provider.production.assigned_scenes.map((scene) => ({ narrative_order: scene.narrative_order, title: scene.title }));
    const items = initialItems.map((source, index) => {
      const position = internalRepair ? page.global_start_index + index + 1 : source.narrative_order;
      const invalidVisual = !internalRepair && (page.page_index === 0 && position === 1 || wholeWorkRepair && page.page_index === 1);
      return {
        title: `Repair-safe heading ${position}`,
        body: movements[position - 1],
        notes: `[Sources] Authored movement ${position}.`,
        image_prompt: `Movement ${position}.`,
        context_group_ids: [],
        slide: {
          layout: position === 1 || page.page_index === 1 && !wholeWorkRepair && !internalRepair ? "cover" : "split",
          kicker: `Chapter ${position}`,
          bullets: [],
          visual: {
            kind: invalidVisual ? "scorecard" : "hero-type",
            label: `Measure ${position}`,
            value: `Signal ${position}`,
            data: [{ label: `Axis ${position}`, value: `Reading ${position}`, weight: .75 }],
          },
        },
      };
    });
    return Response.json({
      id: `nested-repair-provider-request-${requests.length}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify({ title: "Repair-safe production", summary: "One bounded provider repair chain.", content_markdown: items.map((item) => item.body).join("\n"), presentation, items }),
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
  };

  try {
    const result = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "authorized-actor", "slides", {
      documentTitle: "Repair-safe production",
      snapshot,
      production,
      presentationStyle: "editorial",
      presentationFidelity: "faithful",
      plannerAttempt: (attempt) => attempts.push(structuredClone(attempt)),
    });

    assert.equal(requests.length, 5, "two initial page calls, two bounded adapter repairs, and one bounded whole-work retry must all be counted");
    assert.deepEqual(requests.map(({ internalRepair, wholeWorkRepair }) => [internalRepair, wholeWorkRepair]), [[false, false], [true, false], [false, false], [false, true], [true, true]]);
    assert.ok(requests.every(({ request }) => !/PRIVATE_REPAIR_(?:SOURCE_BLOCK|ARTIFACT)_/.test(JSON.stringify(request))), "private block and artifact identifiers must never enter either initial or repair provider requests");
    assert.equal(result.output.items.length, 9);
    assert.equal(result.output.items.filter((item) => item.slide.layout === "cover").length, 1);
    assert.deepEqual(result.output.items.map((item) => item.slide.sourceIds), snapshot.facts.map((fact) => [fact.block_id]));
    assert.equal(result.inputReceipt.planned_provider_request_count, 2);
    assert.equal(result.inputReceipt.provider_request_count, 5);
    assert.ok(result.inputReceipt.maximum_provider_request_count >= result.inputReceipt.provider_request_count);
    assert.equal(result.inputReceipt.whole_work_validation.repaired_pages, 1);
    assert.equal(result.usage.totalTokens, 750);
    assert.deepEqual(attempts.map((attempt) => attempt.usage.totalTokens), [150, 300, 450, 600, 750], "every successful paid provider response, including bounded repairs, is checkpointed immediately");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("visible protected body quotations missing from provider speaker notes are restored locally without another paid provider call", async () => {
  const snapshot = executivePresentationSnapshot(9);
  const production = buildManagedProductionPlan("slides", snapshot);
  const requests = [];
  const originalFetch = globalThis.fetch;
  const presentation = {
    aspect_ratio: "16:9",
    theme: "Source-grounded stakeholder evidence",
    footer_label: "Stakeholder evidence",
    style_preset: "field-notes",
    mode: "light",
    palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" },
  };
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const provider = JSON.parse(request.input);
    requests.push({ request, provider });
    const items = provider.production.assigned_scenes.map((scene) => {
      const position = scene.narrative_order;
      const sourceSection = snapshot.facts[Math.floor((position - 1) / 3)];
      const providerSection = provider.combined_context_plan.find((section) => section.target === sourceSection.properties.label);
      return {
        title: scene.title,
        body: executiveSlideCopy(position),
        notes: position === 7
          ? `[Sources] ${sourceSection.properties.label}; Discuss the pending-work notification opportunity.`
          : `[Sources] ${sourceSection.properties.label}; ${executiveSlideCopy(position)}`,
        image_prompt: `Stakeholder perspective ${position}.`,
        context_group_ids: [providerSection.context_key],
        slide: {
          layout: position === 1 ? "cover" : position === 9 ? "closing" : "split",
          kicker: `Perspective ${position}`,
          bullets: [],
          visual: {
            kind: "hero-type",
            label: `Decision evidence ${position}`,
            value: `Research insight ${position}`,
            data: [{ label: `Dimension ${position}`, value: `Finding ${position}`, weight: .85 }],
          },
        },
      };
    });
    return Response.json({
      id: `stakeholder-notes-page-${requests.length}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify({ title: "Stakeholder evidence", summary: "Protected body quotations retain complete speaker notes.", content_markdown: items.map((item) => item.body).join("\n"), presentation, items }),
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
  };

  try {
    const result = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "authorized-actor", "slides", {
      documentTitle: "Stakeholder source evidence",
      snapshot,
      production,
      presentationStyle: "field-notes",
      presentationFidelity: "faithful",
    });
    const stakeholderSlide = result.output.items[6];

    assert.equal(requests.length, 2, "a deterministic local speaker-note repair must not create an additional paid provider request");
    assert.equal(stakeholderSlide.slide.quote, undefined, "the provider supplied its protected quotation only in visible body copy");
    assert.ok(stakeholderSlide.body.includes(EXECUTIVE_STAKEHOLDER_QUOTES[1]), "the protected quote remains complete in visible slide copy");
    assert.ok(stakeholderSlide.notes.includes(EXECUTIVE_STAKEHOLDER_QUOTES[1]), "the exact quote is restored to its own source-attributed speaker notes");
    assert.match(stakeholderSlide.notes, /— Market Researcher/);
    assert.deepEqual(stakeholderSlide.slide.sourceIds, [snapshot.facts[2].block_id]);
    assert.match(result.output.content_markdown, /\*\*Speaker notes:\*\* \[Sources\]/);
    assert.ok(result.output.content_markdown.includes(EXECUTIVE_STAKEHOLDER_QUOTES[1]));
    assert.match(result.output.content_markdown, /— Market Researcher/);
    assert.equal(result.inputReceipt.provider_request_count, 2);
    assert.equal(result.inputReceipt.whole_work_validation.repaired_pages, 0);
    assert.equal(result.usage.totalTokens, 300);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an unrepaired protected stakeholder quotation fails terminally after one bounded managed page retry", async () => {
  const snapshot = executivePresentationSnapshot(9);
  const production = buildManagedProductionPlan("slides", snapshot);
  const requests = [];
  const attempts = [];
  const originalFetch = globalThis.fetch;
  const presentation = {
    aspect_ratio: "16:9",
    theme: "Governed source fidelity",
    footer_label: "Governed source fidelity",
    style_preset: "field-notes",
    mode: "light",
    palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" },
  };
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const provider = JSON.parse(request.input);
    requests.push({ request, provider });
    const items = provider.production.assigned_scenes.map((scene) => {
      const position = scene.narrative_order;
      const sourceSection = snapshot.facts[Math.floor((position - 1) / 3)];
      const providerSection = provider.combined_context_plan.find((section) => section.target === sourceSection.properties.label);
      const body = position === 7 ? "Make every pending review immediately actionable throughout the product." : executiveSlideCopy(position);
      return {
        title: scene.title,
        body,
        notes: `[Sources] ${sourceSection.properties.label}; ${body}`,
        image_prompt: `Protected source position ${position}.`,
        context_group_ids: [providerSection.context_key],
        slide: {
          layout: position === 1 ? "cover" : position === 9 ? "closing" : "split",
          kicker: `Decision ${position}`,
          bullets: [],
          visual: {
            kind: "hero-type",
            label: `Source dimension ${position}`,
            value: `Editorial finding ${position}`,
            data: [{ label: `Evidence ${position}`, value: `Reading ${position}`, weight: .8 }],
          },
        },
      };
    });
    return Response.json({
      id: `protected-source-attempt-${requests.length}`,
      model: "gpt-5.6-terra",
      output_text: JSON.stringify({ title: "Governed source fidelity", summary: "A protected quote is persistently absent.", content_markdown: items.map((item) => item.body).join("\n"), presentation, items }),
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
  };

  try {
    await assert.rejects(
      generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "authorized-actor", "slides", {
        documentTitle: "Executive source fidelity",
        snapshot,
        production,
        presentationStyle: "field-notes",
        presentationFidelity: "faithful",
        plannerAttempt: (attempt) => attempts.push(structuredClone(attempt)),
      }),
      (error) => {
        assert.equal(error.detail.code, "source_fidelity_validation_failed");
        assert.equal(error.detail.action, "edit_request");
        assert.equal(error.detail.retryable, false, "a repeatedly missing protected quotation must never receive safe-to-retry guidance");
        assert.match(error.detail.message, /missing_protected_quote/);
        assert.doesNotMatch(error.detail.message, /PRIVATE_SOURCE_(?:BLOCK|SECTION|CANVAS)_/);
        assert.ok(!error.detail.message.includes(EXECUTIVE_STAKEHOLDER_QUOTES[1]), "a public failure diagnostic must not echo customer-authored protected source text");
        const missing=error.detail.validationIssues.find((issue)=>issue.code==="missing_protected_quote");
        assert.ok(missing,"whole-production validation must preserve its sanitized slide-level issue instead of collapsing it into a generic failure");
        assert.equal(missing.category,"source-integrity");
        assert.equal(missing.pageIndex,0);
        assert.equal(missing.globalSlideIndex,7);
        assert.equal(missing.providerAttempt,3);
        assert.equal(missing.overridable,false);
        assert.doesNotMatch(JSON.stringify(error.detail.validationIssues),/PRIVATE_SOURCE_|blk_\d+|traceable, editable/u);
        return true;
      },
    );
    assert.equal(requests.length, 3, "two initial provider pages permit exactly one bounded whole-work page repair");
    assert.equal(requests.filter(({ provider }) => provider.production.page.repair_issues?.length).length, 1);
    assert.ok(requests.every(({ request }) => !/PRIVATE_SOURCE_(?:BLOCK|SECTION|CANVAS)_/.test(JSON.stringify(request))), "neither original nor repair provider prompts may receive durable source identifiers");
    assert.deepEqual(attempts.map((attempt) => attempt.usage.totalTokens), [150, 300, 450], "all accepted paid attempts remain accounted for after a terminal fidelity failure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("completed planning pages report billable usage even when a later provider page fails", async () => {
  const snapshot = { facts: Array.from({ length: 17 }, (_, offset) => ({ block_id: `beat-${offset + 1}`, type: "reference", properties: { text: `Unique action ${offset + 1}`, storyboard_frame_index: offset + 1, source_artifact_id: "long-film", storyboard_shot_title: `Beat ${offset + 1}`, storyboard_shot_direction: `Unique action ${offset + 1}` } })) };
  const production = buildManagedProductionPlan("video", snapshot);
  const completed = [];
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    calls += 1;
    if (calls === 3) return Response.json({ error: { code: "provider_temporarily_unavailable", message: "The third page could not be generated." } }, { status: 500 });
    const provider = JSON.parse(JSON.parse(String(init.body)).input);
    const scenes = provider.production.assigned_scenes;
    return Response.json({ id: `paid-page-${calls}`, model: "gpt-5.6-terra", output_text: JSON.stringify({ title: "Long film", summary: "A complete treatment.", content_markdown: scenes.map((scene) => scene.action).join("\n"), items: scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: "", image_prompt: scene.action, context_group_ids: [] })) }), usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 } });
  };
  try {
    await assert.rejects(generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "owner", "video", { documentTitle: "Long film", snapshot, production, plannerAttempt: (attempt) => completed.push(attempt) }));
    assert.equal(completed.length, 2);
    assert.equal(completed.at(-1).usage.totalTokens, 360);
    assert.deepEqual(completed.at(-1).responseIds, ["paid-page-1", "paid-page-2"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("managed storyboards checkpoint exact completed-frame costs and scoped reference provenance before a later failure", async () => {
  const snapshot = productionFixture(3, 2);
  const approved = approvedReferences([1, 2, 3]);
  const production = buildManagedProductionPlan("storyboard", snapshot, { references: approved });
  const sourceBytes = Uint8Array.from([137, 80, 78, 71]);
  const references = approved.map((reference) => ({ ...reference, bytes: sourceBytes, mimeType: "image/png", mode: "preserve_composition", shotDirection: `Direction ${reference.sequence}`, cameraDirection: "Controlled camera.", framePrompt: `Frame ${reference.sequence}`, sourceArtifactId: "board", sourceArtifactItemId: `frame-${reference.sequence}`, sourceArtifactKind: "storyboard", storyboardTitle: "Midnight", contextGroups: reference.contextGroupIds.map((id) => ({ id, name: id, target: id, role: "character", application: "isolate", relativity: 1 })) }));
  const draft = { title: "Storyboard", summary: "A coherent ordered sequence.", content_markdown: "A storyboard.", presentation: null, items: production.scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: scene.cameraDirection, image_prompt: scene.imagePrompt, context_group_ids: scene.contextGroupIds, slide: null })) };
  const media = new Map();
  const checkpoints = [];
  const requests = [];
  let imageRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/moderations")) return Response.json({ id: "moderation-pass", model: "omni-moderation-latest", results: [{ flagged: false, categories: {}, category_scores: {} }] });
    imageRequests += 1;
    requests.push({ url, body: init.body });
    if (imageRequests === 3) return Response.json({ error: { code: "provider_unavailable", message: "The last frame could not be generated." } }, { status: 500 });
    return Response.json({ data: [{ b64_json: btoa("image-bytes") }], usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  };
  const env = { OPENAI_API_KEY: "test-only", OPENAI_IMAGE_MODEL: "gpt-image-2", MEDIA: {
    put: async (key, value, options) => media.set(key, { bytes: new Uint8Array(value), options }),
    get: async (key) => { const value = media.get(key); return value ? { body: value.bytes, customMetadata: value.options.customMetadata, writeHttpMetadata: (headers) => headers.set("content-type", value.options.httpMetadata.contentType) } : null; },
  } };
  try {
    const providerActorId="paying-collaborator",expectedActor=`forma_${createHash("sha256").update(providerActorId).digest("hex").slice(0,32)}`;
    await assert.rejects(renderManagedStoryboardProduction(env, "owner", "board-one", draft, production, { providerActorId,snapshot, references, checkpoint: (value) => checkpoints.push(structuredClone(value)) }));
    const latest = checkpoints.at(-1);
    const completed = Object.values(latest.productionFrameReceipts);
    assert.equal(completed.length, 2, "each successfully paid frame must survive a later failed frame");
    assert.ok(completed.every((receipt) => receipt.status === "completed" && receipt.costMicrousd > 0 && receipt.usage.totalTokens === 200));
    assert.ok(completed.every((receipt) => receipt.referenceInputs.some((reference) => reference.role === "authored-reference")));
    assert.ok(completed.some((receipt) => receipt.referenceInputs.some((reference) => reference.role === "inherited-production-continuity")));
    assert.equal(latest.renderedItems.length, 2);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(({body})=>body instanceof FormData&&body.get("user")===expectedActor),"managed image providers identify the paying collaborator, not the storage owner");
    assert.ok([...media.values()].every(({options})=>options.customMetadata.ownerId==="owner"),"generated shared media remains owned by the project owner");
  } finally { globalThis.fetch = originalFetch; }
});

test("saturated storyboard references retain the highest-ranked authored image and an honest scoped continuity anchor", async () => {
  const { snapshot, production, references, draft } = saturatedContinuityFixture("storyboard", { scopedAlias: true });
  const media = new Map();
  let imageRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/moderations")) return Response.json({ id: "moderation-pass", model: "omni-moderation-latest", results: [{ flagged: false, categories: {}, category_scores: {} }] });
    imageRequests += 1;
    return Response.json({ data: [{ b64_json: btoa("image-bytes") }], usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  };
  const env = { OPENAI_API_KEY: "test-only", OPENAI_IMAGE_MODEL: "gpt-image-2", MEDIA: {
    put: async (key, value, options) => media.set(key, { bytes: new Uint8Array(value), options }),
    get: async (key) => { const value = media.get(key); return value ? { body: value.bytes, customMetadata: value.options.customMetadata, writeHttpMetadata: (headers) => headers.set("content-type", value.options.httpMetadata.contentType) } : null; },
  } };
  try {
    for (const scene of production.scenes) {
      assert.equal(scene.referenceIds.length, 9);
      assert.equal(scene.referenceIds[0], `reference-${scene.narrativeOrder}`, "The authored shot must outrank caller-first generic studies.");
    }
    const result = await renderManagedStoryboardProduction(env, "owner", "saturated-board", draft, production, { snapshot, references });
    assert.equal(imageRequests, 2);
    const first = result.receipts.find((receipt) => receipt.sceneId === production.anchorSceneId);
    const inherited = result.receipts.find((receipt) => receipt.sceneId !== production.anchorSceneId);
    assert.equal(first.authoredReferenceCount, 9, "A first frame without inherited continuity retains all nine authorized references.");
    assert.equal(first.inheritedReferenceCount, 0);
    assert.equal(first.referenceInputs.length, 9);
    assert.equal(inherited.authoredReferenceCount, 8);
    assert.equal(inherited.inheritedReferenceCount, 1);
    assert.equal(inherited.referenceInputs.length, 9);
    assert.equal(inherited.referenceInputs.filter((reference) => reference.role === "authored-reference").length, 8);
    assert.equal(inherited.referenceInputs.filter((reference) => reference.role === "inherited-production-continuity").length, 1);
    assert.ok(inherited.referenceInputs.some((reference) => reference.referenceId === `reference-${inherited.narrativeOrder}`));
    for (const receipt of result.receipts) {
      const expected = receipt.narrativeOrder % 2 ? "mara-alias" : "ivo-alias";
      const forbidden = receipt.narrativeOrder % 2 ? "ivo-alias" : "mara-alias";
      assert.ok(receipt.referenceInputs.some((reference) => reference.blockId === expected), "An allowed duplicate resource must remain bound to its authored block.");
      assert.ok(!receipt.referenceInputs.some((reference) => reference.blockId === forbidden), "A same-id reference from another target must never enter this scene.");
    }
    assert.equal(inherited.referenceInputs.find((reference) => reference.role === "inherited-production-continuity").mode, "preserve_style", "Continuity across unrelated characters must never preserve the prior subject.");
    const returned = result.items.find((item) => item.scene_id === inherited.sceneId);
    assert.equal(returned.authored_reference_count, 8);
    assert.equal(returned.inherited_reference_count, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("managed film rendering submits the chosen anchor first and assembles only an honest ordered scene reel", async () => {
  const snapshot = productionFixture(3, 2);
  const authorized = approvedReferences([1, 2, 3]);
  const production = buildManagedProductionPlan("video", snapshot, { references: authorized });
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  const references = authorized.map((reference) => ({
    ...reference,
    bytes,
    mimeType: "image/png",
    mode: "preserve_composition",
    shotDirection: `Unique action ${reference.sequence}`,
    cameraDirection: "Slow controlled tracking.",
    framePrompt: `Reference frame ${reference.sequence}`,
    sourceArtifactId: "storyboard-midnight",
    sourceArtifactItemId: `frame-${reference.sequence}`,
    sourceArtifactKind: "storyboard",
    storyboardTitle: "The midnight observatory",
    provider: "fal",
    providerMediaUrl: `https://v3b.fal.media/files/test/reference-${reference.sequence}.png`,
    contextGroups: reference.contextGroupIds.map((id) => ({ id, name: id, target: id, role: "character", application: "isolate", relativity: .9 })),
  }));
  const draft = { title: "A complete film", summary: "A source-grounded production.", content_markdown: "A complete film.", presentation: null, items: production.scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: scene.cameraDirection, image_prompt: scene.action, context_group_ids: scene.contextGroupIds, slide: null })) };
  const stored = [];
  const requests = [];
  let providerRequest = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/reference-") && url.endsWith(".png")) return new Response(bytes, { headers: { "content-type": "image/png" } });
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      providerRequest += 1;
      return Response.json({ request_id: `fal-${providerRequest}`, status: "IN_QUEUE" });
    }
    const match = /\/requests\/(fal-\d+)/.exec(url);
    if (url.includes("/status")) return Response.json({ request_id: match?.[1], status: "COMPLETED" });
    if (match) return Response.json({ video: { url: `https://v3b.fal.media/files/test/${match[1]}.mp4`, content_type: "video/mp4" } });
    if (url.endsWith(".mp4")) return new Response(Uint8Array.from([0, 1, 2, 3]), { headers: { "content-type": "video/mp4" } });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const env = { FAL_KEY: "test-only", FORMA_VIDEO_PROVIDER: "fal", MEDIA: { put: async (key, _body, options) => stored.push({ key, options }) } };
    const providerActorId="paying-collaborator",expectedActor=`forma_${createHash("sha256").update(providerActorId).digest("hex").slice(0,32)}`;
    const result = await renderManagedVideoProduction(env, "owner", "film-one", draft, production, { providerActorId,snapshot, references, videoSize: "1280x720", audioMode: "silent" });
    assert.equal(requests.length, 3);
    assert.match(requests[0].prompt, /hidden compass reveals the observatory/i);
    assert.deepEqual(result.receipts.map((scene) => scene.narrativeOrder), [1, 2, 3]);
    assert.deepEqual(result.assembly.narrative_order, production.narrativeOrder);
    assert.deepEqual(result.assembly.generation_order, production.executionOrder);
    assert.equal(result.assembly.composed, false);
    assert.equal(result.assembly.native_boundary_frames, false);
    assert.equal(result.items.length, 3);
    assert.equal(stored.length, 3);
    assert.ok(result.receipts.every((scene) => scene.providerJobId));
    assert.ok(requests.every((request) => request.duration <= 15));
    assert.ok(requests.every((request)=>request.end_user_id===expectedActor),"managed video identifies the paying collaborator at the provider");
    assert.ok(stored.every(({options})=>options.customMetadata.ownerId==="owner"),"collaborator-paid scene media remains owned by the project");

    const anchor = result.receipts.find((scene) => scene.sceneId === production.anchorSceneId);
    const resumedReceipts = Object.fromEntries(result.receipts.map((scene) => [scene.sceneId, scene.sceneId === anchor.sceneId ? { ...scene, status: "submitted", mediaUrl: undefined, mediaType: undefined } : scene]));
    const resumed = await renderManagedVideoProduction(env, "owner", "film-one", draft, production, {
      snapshot,
      providerActorId,
      references,
      videoSize: "1280x720",
      audioMode: "silent",
      existingItems: result.items.filter((item) => item.scene_id !== anchor.sceneId),
      existingSceneReceipts: resumedReceipts,
      prepaidSceneIds: result.receipts.map((scene) => scene.sceneId),
    });
    assert.equal(requests.length, 3, "a previously accepted paid scene cannot be submitted to the provider again");
    assert.equal(resumed.videoCostMicrousd, 0, "scene charges settled by the interrupted attempt cannot be debited twice");
    assert.equal(resumed.items.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("new video continuity anchors render only the selected target's reference pixels when resource IDs overlap", async () => {
  const snapshot = productionFixture(3, 1);
  const unrelatedShot = snapshot.facts.find((fact) => fact.block_id === "shot-3");
  Object.assign(unrelatedShot.properties, {
    text: "Zara discovers a second, unreferenced observatory.",
    storyboard_shot_direction: "Zara discovers a second, unreferenced observatory.",
    storyboard_frame_prompt: "Zara in an unreferenced observatory.",
    combined_context_memberships: [membership("cast-zara", "Zara", 3)],
  });
  snapshot.facts.push({
    block_id: "zara",
    type: "subject",
    locked: true,
    properties: { text: "Zara keeps her amber scarf.", combined_context_memberships: [membership("cast-zara", "Zara")] },
  });
  const authorized = [
    { referenceId: "shared-resource", blockId: "ivo-alias", sequence: null, contextGroupIds: ["cast-ivo"], label: "Ivo-only shared resource" },
    { referenceId: "shared-resource", blockId: "mara-alias", sequence: null, contextGroupIds: ["cast-mara"], label: "Mara-only shared resource" },
  ];
  const production = buildManagedProductionPlan("video", snapshot, { references: authorized });
  const anchorScene = production.scenes.find((scene) => scene.id === production.anchorSceneId);
  assert.ok(anchorScene.contextGroupIds.includes("cast-mara"), "The climax supplies the Mara-scoped anchor.");
  assert.ok(!anchorScene.contextGroupIds.includes("cast-ivo"), `An unrelated character must never enter the anchor scene's eligible targets: ${JSON.stringify(anchorScene.contextGroupIds)}.`);
  assert.ok(production.scenes.some((scene) => !scene.referenceIds.length), "An unreferenced scene must request a generated continuity anchor.");
  const references = authorized.map((reference) => ({
    ...reference,
    bytes: Uint8Array.from([137, 80, 78, 71, reference.blockId === "mara-alias" ? 77 : 73]),
    mimeType: "image/png",
    mode: "preserve_subject",
    shotDirection: `Approved ${reference.label}`,
    cameraDirection: "Controlled tracking.",
    framePrompt: reference.label,
    sourceArtifactId: "approved-board",
    sourceArtifactItemId: null,
    sourceArtifactKind: "storyboard",
    storyboardTitle: "The midnight observatory",
    contextGroups: reference.contextGroupIds.map((id) => ({ id, name: id, target: id, role: "character", application: "isolate", relativity: 1 })),
  }));
  const draft = {
    title: "Isolated continuity",
    summary: "Each character keeps their own visual identity.",
    content_markdown: "A continuous, target-scoped world.",
    presentation: null,
    items: production.scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: scene.cameraDirection, image_prompt: scene.imagePrompt, context_group_ids: scene.contextGroupIds, slide: null })),
  };
  const stored = [];
  const imageInputs = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/moderations")) return Response.json({ id: "moderation-pass", model: "omni-moderation-latest", results: [{ flagged: false, categories: {}, category_scores: {} }] });
    if (url.endsWith("/images/edits")) {
      assert.ok(init.body instanceof FormData);
      for (const image of init.body.getAll("image[]")) imageInputs.push(new Uint8Array(await image.arrayBuffer()));
      return Response.json({ data: [{ b64_json: btoa("anchor-image") }], usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };
  const env = {
    OPENAI_API_KEY: "test-only",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    FAL_KEY: "test-only",
    FORMA_VIDEO_PROVIDER: "fal",
    MEDIA: { put: async (key, value, options) => stored.push({ key, bytes: new Uint8Array(value), options }) },
  };
  try {
    await assert.rejects(renderManagedVideoProduction(env, "owner", "isolated-film", draft, production, {
      snapshot,
      references,
      videoSize: "1280x720",
      audioMode: "silent",
      progress: async (_stage, message) => {
        if (message.startsWith("The reusable production anchor")) throw new Error("anchor-provenance-checked");
      },
    }), /anchor-provenance-checked/);
    assert.equal(imageInputs.length, 1, "The generated anchor must receive exactly one authorized reference.");
    assert.deepEqual([...imageInputs[0]], [137, 80, 78, 71, 77], "Mara's pixels, never the caller-first Ivo alias, define the shared anchor.");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].options.customMetadata.ownerId, "owner");
    assert.equal(stored[0].options.customMetadata.artifactRole, "production-continuity-anchor");
  } finally { globalThis.fetch = originalFetch; }
});

test("saturated video references reserve the scoped continuity anchor without discarding the highest-ranked authored shot", async () => {
  const { snapshot, production, references, draft, bytes } = saturatedContinuityFixture("video", { scopedAlias: true });
  const media = new Map([["owner/continuity-anchor.jpg", {
    bytes,
    options: { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { ownerId: "owner", provider: "fal", providerModel: "fal-test", providerMediaUrl: "https://v3b.fal.media/files/test/owned-anchor.png" } },
  }]]);
  const requests = [];
  let providerRequest = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith(".png")) return new Response(bytes, { headers: { "content-type": "image/png" } });
    if (init.method === "POST") {
      requests.push(JSON.parse(String(init.body)));
      providerRequest += 1;
      return Response.json({ request_id: `fal-capped-${providerRequest}`, status: "IN_QUEUE" });
    }
    const match = /\/requests\/(fal-capped-\d+)/.exec(url);
    if (url.includes("/status")) return Response.json({ request_id: match?.[1], status: "COMPLETED" });
    if (match) return Response.json({ video: { url: `https://v3b.fal.media/files/test/${match[1]}.mp4`, content_type: "video/mp4" } });
    if (url.endsWith(".mp4")) return new Response(Uint8Array.from([0, 1, 2, 3]), { headers: { "content-type": "video/mp4" } });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  const env = { FAL_KEY: "test-only", FORMA_VIDEO_PROVIDER: "fal", MEDIA: {
    put: async (key, value, options) => media.set(key, { bytes: new Uint8Array(value), options }),
    get: async (key) => { const value = media.get(key); return value ? { body: value.bytes, customMetadata: value.options.customMetadata, writeHttpMetadata: (headers) => headers.set("content-type", value.options.httpMetadata.contentType) } : null; },
  } };
  try {
    const anchorScene = production.scenes.find((scene) => scene.id === production.anchorSceneId);
    const result = await renderManagedVideoProduction(env, "owner", "saturated-film", draft, production, {
      snapshot,
      references,
      videoSize: "1280x720",
      audioMode: "silent",
      existingAnchor: { mediaUrl: "/api/media/owner%2Fcontinuity-anchor.jpg", sceneId: anchorScene.id, contextGroupIds: anchorScene.contextGroupIds, source: "account-generated", rights: "account-generated" },
      prepaidAnchor: true,
    });
    assert.equal(requests.length, 2);
    for (const receipt of result.receipts) {
      assert.equal(receipt.referenceIds.length, 9);
      assert.ok(receipt.referenceIds.includes(`reference-${receipt.narrativeOrder}`), "The scene-specific authored reference must survive the cap.");
      assert.ok(receipt.referenceIds.includes("production-anchor:saturated-film"), "The owned continuity reference must occupy its reserved slot.");
      assert.equal(receipt.videoInputReceipt.reference_inputs.length, 9);
      assert.equal(receipt.referenceIds.filter((id) => id === "production-anchor:saturated-film").length, 1);
      const expected = receipt.narrativeOrder % 2 ? "mara-alias" : "ivo-alias";
      const forbidden = receipt.narrativeOrder % 2 ? "ivo-alias" : "mara-alias";
      assert.ok(receipt.videoInputReceipt.reference_inputs.some((reference) => reference.block_id === expected));
      assert.ok(!receipt.videoInputReceipt.reference_inputs.some((reference) => reference.block_id === forbidden), "A duplicate resource ID must not bypass authored target isolation.");
    }
    const unrelated = result.receipts.find((receipt) => receipt.sceneId !== production.anchorSceneId);
    const inherited = unrelated.videoInputReceipt.reference_inputs.find((reference) => reference.reference_id === "production-anchor:saturated-film" || reference.referenceId === "production-anchor:saturated-film");
    assert.equal(inherited.mode, "preserve_style", "An unrelated character can inherit only treatment, never the previous subject.");
  } finally { globalThis.fetch = originalFetch; }
});
