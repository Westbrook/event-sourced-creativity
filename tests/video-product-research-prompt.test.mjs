import assert from "node:assert/strict";
import test from "node:test";

import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { adaptVideoPrompt, videoPlannerCreativeContext } from "../worker/video-prompt-adapter.ts";

const tagline = "Your content. One context. Infinite paths to your target.";
const privateIdentifier = "3fc14a89-1ce0-44b1-9d33-b08c313859ae";
const operationalCopy = /provider\s+(?:charge|submission|request)|paid\s+generation|payment\s+settlement|private\s+identifiers?|failed\s+request|transfer\s+reference\s+pixels|\bP[012]\b/i;

const feedbackSnapshot = () => ({
  document: { title: "pitch context feedback" },
  facts: [
    {
      block_id: "feedback-direction",
      type: "direction",
      properties: {
        text: "Turn a firsthand attempt to create Forma’s one-context/infinite-paths pitch into an evidence-based end-user UX review and prioritized product improvement plan; demonstrate the same honest feedback context as a slideshow, storyboard, and silent video without hiding delivery failure.",
      },
    },
    {
      block_id: "feedback-audience",
      type: "audience",
      properties: {
        text: "Forma product managers, designers, engineers, reliability owners, founders, and end users deciding whether to trust reusable creative context and paid generation.",
      },
    },
    {
      block_id: "feedback-format",
      type: "format",
      properties: {
        text: "Six-slide faithful field-notes research readout, four-frame storyboard, and four-second silent landscape video; visualize legacy file chaos, coherent shared context, real workflow/reliability friction, and prioritized fixes plus the exact Forma tagline.",
      },
    },
    {
      block_id: "feedback-exclusion",
      type: "exclusion",
      intent: "avoid",
      properties: {
        text: "Never claim the failed original slideshow was completed, its provider charge was settled, or recipient-controlled consumption was demonstrated. Do not invent metrics, conceal the failed request, transfer reference pixels, expose private identifiers, or weaken human review.",
      },
    },
    {
      block_id: "feedback-message",
      type: "message",
      properties: {
        text: [
          "Forma promises to replace fragmented .doc, .ppt, .mov, .mp3, and .psd handoffs with one living context that adapts to the storyteller, recipient, moment, and medium.",
          "A real nine-slide pitch was fully authored, but its paid generation failed during provider submission.",
          "Gathering and managing context: 7/10.",
          "Adapting context into a slideshow: 2/10.",
          "Capturing the intended message: 3/10.",
          `The failed request kept payment settlement uncertain; never disclose private identifiers such as ${privateIdentifier}.`,
          "The provider_submission_uncertain incident produced P0, P1, and P2 remediation work.",
          tagline,
        ].join("\n"),
      },
    },
  ],
});

const feedbackPlan = () => ({
  title: "Firsthand product feedback and delivery reliability",
  summary: "A continuous editorial camera move connects one shared context and the creator/recipient workflow. A failed request involved provider charge, payment settlement, and private identifiers.",
  items: [
    {
      body: "The storyteller and recipient each choose the most useful medium.",
      notes: `Retain real workflow friction without disclosing provider submission, transfer reference pixels, ${privateIdentifier}, P0, P1, or P2.`,
    },
  ],
});

const feedbackPrompt = [
  "Animate an editorial visual scorecard as scattered creative files converge into one shared context and delivery paths branch toward the storyteller and recipient.",
  "Internal notes: failed request, provider submission, provider charge, payment settlement, private identifiers, transfer reference pixels, P0, P1, and P2.",
].join("\n");

const options = (patch = {}) => ({
  snapshot: feedbackSnapshot(),
  plan: feedbackPlan(),
  references: [],
  seconds: 4,
  size: "1280x720",
  model: VIDEO_ADAPTER_CONTRACT.model,
  promptProfile: "positive-only",
  audioMode: "silent",
  generateAudio: false,
  ...patch,
});

const pixelReference = () => ({
  bytes: Uint8Array.from([137, 80, 78, 71, 1]),
  mimeType: "image/png",
  blockId: "authorized-reference",
  referenceId: "authorized-reference-1",
  label: "Authorized editorial composition",
  mode: "preserve_composition",
  sequence: null,
  shotDirection: "A shared editorial context remains centered.",
  cameraDirection: "A restrained left-to-right movement.",
  framePrompt: "A sparse editorial product composition.",
  sourceArtifactKind: "storyboard",
  storyboardTitle: "Visual feedback sequence",
});

test("prompt-only product research video projects the five real feedback decisions into safe visual meaning", () => {
  const snapshot = feedbackSnapshot();
  const plan = feedbackPlan();
  const originalSnapshot = structuredClone(snapshot);
  const originalPlan = structuredClone(plan);
  const plannerBefore = videoPlannerCreativeContext(snapshot);

  const adapted = adaptVideoPrompt(feedbackPrompt, options({ snapshot, plan }));

  assert.equal(adapted.compilation.valid, true);
  assert.doesNotMatch(adapted.prompt, operationalCopy);
  assert.doesNotMatch(adapted.prompt, /provider_submission_uncertain|receipt|3fc14a89-1ce0-44b1-9d33-b08c313859ae/i);
  for (const format of [".doc", ".ppt", ".mov", ".mp3", ".psd"]) assert.ok(adapted.prompt.includes(format), format);
  for (const score of ["7/10", "2/10", "3/10"]) assert.ok(adapted.prompt.includes(score), score);
  assert.ok(adapted.prompt.includes(tagline));
  assert.match(adapted.prompt, /(?:storyteller|creator)[\s\S]*recipient/i);
  assert.match(adapted.prompt, /(?:anonymous|readable personal details)/i);
  assert.match(adapted.prompt, /(?:show no additional numerical claims|unauthored numerical claims)/i);
  assert.match(adapted.prompt, /exactly 4 seconds of 16:9 landscape video/i);
  assert.match(adapted.prompt, /silent visual-only motion/i);
  assert.doesNotMatch(adapted.prompt, /@Image\d|<IMAGE_REF_\d+>/);
  assert.deepEqual(adapted.referenceBindings, []);
  assert.equal(adapted.audio.effectiveMode, "silent");
  assert.equal(adapted.audio.generateAudio, false);

  assert.deepEqual(snapshot, originalSnapshot);
  assert.deepEqual(plan, originalPlan);
  assert.deepEqual(videoPlannerCreativeContext(snapshot), plannerBefore);
  assert.match(JSON.stringify(plannerBefore), /provider charge|paid generation|failed request/);
  assert.ok(JSON.stringify(plannerBefore).includes(privateIdentifier));
});

test("research projection preserves locked typography and both global and scoped authored visual exclusions", () => {
  const snapshot = feedbackSnapshot();
  const membership = {
    context_set_id: "participant-boundaries",
    name: "Research participant",
    target: "Research participant",
    role: "character",
    application: "isolate",
    relativity: 1,
    member_order: 0,
  };

  snapshot.facts.push(
    {
      block_id: "locked-tagline",
      type: "typography",
      locked: true,
      properties: { exact_text: tagline, font_family: "LOCKED_EDITORIAL_SANS_8842" },
    },
    {
      block_id: "locked-global-exclusion",
      type: "direction",
      intent: "avoid",
      locked: true,
      properties: { text: "FORBIDDEN_GLOBALLY_VISIBLE_WEAPONS_8843" },
    },
    {
      block_id: "locked-scoped-exclusion",
      type: "direction",
      intent: "avoid",
      locked: true,
      properties: {
        text: "FORBIDDEN_SCOPED_CRIMSON_BADGE_8844",
        combined_context_memberships: [membership],
      },
    },
  );
  snapshot.standing_constraints = [{
    axis: "visual privacy",
    polarity: "forbid",
    value: "FORBIDDEN_CONFIDENTIAL_DOCUMENT_SCREEN_8845",
  }];

  const adapted = adaptVideoPrompt(feedbackPrompt, options({ snapshot }));

  for (const required of [
    tagline,
    "LOCKED_EDITORIAL_SANS_8842",
    "FORBIDDEN_GLOBALLY_VISIBLE_WEAPONS_8843",
    "FORBIDDEN_SCOPED_CRIMSON_BADGE_8844",
    "FORBIDDEN_CONFIDENTIAL_DOCUMENT_SCREEN_8845",
  ]) assert.ok(adapted.prompt.includes(required), required);
  assert.match(adapted.prompt, /FORBIDDEN_SCOPED_CRIMSON_BADGE_8844 only from character “Research participant”/);
  assert.doesNotMatch(adapted.prompt, operationalCopy);
});

test("research projection fails closed when locked exact typography exceeds the provider budget", () => {
  const snapshot = feedbackSnapshot();
  snapshot.facts.push({
    block_id: "oversized-locked-legal-copy",
    type: "typography",
    locked: true,
    properties: { exact_text: "REQUIRED_AUTHORED_LEGAL_COPY ".repeat(1_200) },
  });

  assert.throws(
    () => adaptVideoPrompt(feedbackPrompt, options({ snapshot })),
    (error) => error.detail.code === "video_required_context_exceeds_budget",
  );
});

test("ordinary authored creative work is never silently rewritten merely because it mentions operational language", () => {
  const snapshot = {
    document: { title: "Woodland noticeboard" },
    facts: [{
      block_id: "authored-woodland-copy",
      type: "direction",
      properties: { text: "Display the exact authored phrase provider charge on the woodland noticeboard." },
    }],
  };
  const authoredPrompt = "Reveal the visibly printed provider charge notice beside a moss-covered path.";

  const adapted = adaptVideoPrompt(authoredPrompt, options({ snapshot, plan: undefined }));

  assert.match(adapted.prompt, /provider charge/i);
  assert.match(adapted.prompt, /moss-covered path/i);
  assert.doesNotMatch(adapted.prompt, /scattered creative-format tiles converge/i);
});

test("unrelated healthcare product feedback preserves its original caregiver and provider workflow", () => {
  const snapshot = {
    document: { title: "Healthcare product feedback" },
    facts: [
      {
        block_id: "healthcare-direction",
        type: "direction",
        properties: {
          text: "Research end-user feedback for a healthcare product workflow where the provider requested an accessible dialysis appointment calendar.",
        },
      },
      {
        block_id: "healthcare-subject",
        type: "subject",
        properties: {
          text: "A caregiver chooses a dialysis appointment in a high-contrast accessible calendar.",
        },
      },
    ],
  };
  const authoredMotion = "A caregiver calmly chooses a dialysis appointment in a high-contrast accessible calendar.";

  const adapted = adaptVideoPrompt(authoredMotion, options({ snapshot, plan: undefined }));

  assert.match(adapted.prompt, /caregiver calmly chooses a dialysis appointment/i);
  assert.match(adapted.prompt, /provider requested an accessible dialysis appointment calendar/i);
  assert.doesNotMatch(adapted.prompt, /scattered creative-format tiles converge|shared living context|storyteller and the recipient/i);
});

test("authorized pixel-backed references bypass the narrow prompt-only research projection", () => {
  const adapted = adaptVideoPrompt(feedbackPrompt, options({ references: [pixelReference()] }));

  assert.equal(adapted.referenceBindings.length, 1);
  assert.equal(adapted.referenceBindings[0].token, "@Image1");
  assert.match(adapted.prompt, /@Image1/);
  assert.match(adapted.prompt, /COMPOSITION ONLY/);
  assert.match(adapted.prompt, /provider charge/i);
  assert.equal(adapted.audio.effectiveMode, "silent");
});

test("explicit managed-production continuity and authorized soundtrack bypass research projection", () => {
  const managed = adaptVideoPrompt(feedbackPrompt, options({
    productionContinuity: {
      prohibitions: ["PROTECTED_CONTINUITY_PROHIBITION_8846"],
      scopedTargets: [{
        target: "Research participant",
        role: "character",
        prohibitions: ["PROTECTED_SCOPED_CONTINUITY_8847"],
      }],
    },
  }));

  assert.match(managed.prompt, /PROTECTED_CONTINUITY_PROHIBITION_8846/);
  assert.match(managed.prompt, /PROTECTED_SCOPED_CONTINUITY_8847/);
  assert.match(managed.prompt, /provider charge/i);

  const soundtrack = adaptVideoPrompt(feedbackPrompt, options({ providedSoundtrack: true }));
  assert.match(soundtrack.prompt, /AUTHORIZED SOUNDTRACK/);
  assert.match(soundtrack.prompt, /provider charge/i);
  assert.equal(soundtrack.audio.generateAudio, false);
});
