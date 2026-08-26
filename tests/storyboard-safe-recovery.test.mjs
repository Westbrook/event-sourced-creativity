import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  storyboardSafeRecoveryProviderPrompt,
  storyboardSafeRecoveryRenderingInput,
} from "../worker/storyboard-safe-recovery.ts";

const rejectedPrompt = [
  "Create one fast, readable study composed specifically for a 1536 × 1024 pixel frame.",
  "CREATIVE GOAL: Landscape 3:2. warm dusk-lit over-the-shoulder product UX review at the same desk and laptop. A complete structured pitch narrative is visible beside an abstract visual shapes reference. while an expanded navigation panel obscures the primary output area. Show a crowded type-selection interface and a broken-image-style preview treatment beside the textual source. The exact phrase appears clearly in the narrative. Reviewer hand hovering over trackpad. thoughtful and uncertain. realistic editorial product photography. 50mm lens. no completed deck. Use abstract shapes and blank, unmarked surfaces. Communicate every idea visually without words, letters, numbers, labels, captions, or interface text.",
  "MANDATORY AUTHORED DECISION — PALETTE: dusk-warm.",
  "TEXT: Do not render words, letters, numbers, labels, signatures, captions, borders, or interface chrome. Deliver clean, unmarked, unsigned artwork and keep both lower corners visually quiet.",
  "No reference pixels are attached.",
  "DELIVERY: One complete image only; no contact sheet, split-screen comparison, inset, footer, border, annotation, or presentation mockup.",
].join("\n");

const rejectedPromptHash = "04edc6eae7ea141308fd844cb0ebad7d17fec784f61c590a15ac6dce21124410";
const digest = (text) => createHash("sha256").update(text).digest("hex");

function fixture() {
  return {
    prepared: {
      snapshot: {
        facts: [
          { block_id: "palette-source", type: "palette", intent: "prefer", properties: { text: "warm amber and soft charcoal", colors: ["#d29a52", "#27252b"], weight: .8 } },
          { block_id: "lighting-source", type: "lighting", intent: "prefer", properties: { text: "gentle dusk glow", weight: .8 } },
          { block_id: "safe-style", type: "style", intent: "prefer", properties: { text: "geometric vector illustration", weight: .8 } },
          { block_id: "unsafe-style", type: "style", intent: "prefer", properties: { text: "realistic editorial photography", weight: .8 } },
          { block_id: "unsafe-subject", type: "subject", intent: "include", properties: { text: "Reviewer hand hovering over trackpad and over-the-shoulder view", weight: 1 } },
          { block_id: "safe-exclusion", type: "exclusion", intent: "avoid", effect: "must_not_include", properties: { text: "watermarks, logos, signatures, decorative borders", weight: 1 } },
          { block_id: "unsafe-exclusion", type: "exclusion", intent: "avoid", effect: "must_not_include", properties: { text: "private identifiers, failed provider charges, payment receipts", weight: 1 } },
          { block_id: "private-reference", type: "reference", properties: { media_url: "/api/media/PRIVATE_REFERENCE", reference_id: "PRIVATE_IDENTIFIER" } },
          { block_id: "full-message", type: "message", properties: { text: "7/10, 2/10, and 3/10. Your content. One context. Infinite paths to your target. .doc .ppt .mov .mp3 .psd" } },
        ],
        standing_constraints: [
          { axis: "palette", polarity: "affirm", value: "dusk-warm" },
          { axis: "payment", polarity: "avoid", value: "PRIVATE_PROVIDER_CHARGE" },
        ],
      },
      direction: {
        title: "Reviewer hand and failed provider request",
        rationale: "Paid provider rejection and private diagnostics.",
        scene: "over-the-shoulder product photography, reviewer hand hovering, broken-image-style preview, exact phrase appears clearly, uncertain",
        palette: [],
        next_moves: [],
      },
      size: "1536x1024",
      ideogramCaptionStrategy: "compact_literal",
    },
    frames: [
      { title: "Shot 1 — Fragmented handoffs, one living context", body: "Legacy .doc, .ppt, .mov, .mp3, and .psd formats converge into one living context." },
      { title: "Shot 2 — A strong brief meets a difficult workflow", body: "Context 7/10; slideshow adaptation 2/10; intended message 3/10. Your content. One context. Infinite paths to your target.", image_prompt: "over-the-shoulder, reviewer hand hovering, broken-image-style, exact phrase appears clearly, uncertain realistic photography" },
      { title: "Shot 3 — Paid submission stalls; the failure stays visible", body: "Provider charge uncertain; a private identifier must never be shown." },
      { title: "Shot 4 — Fix the friction. Keep the promise.", body: "P0 provider execution; P1 navigation fixes; P2 recipient-selected paths." },
    ],
  };
}

const forbiddenVisualTerms = /\b(?:people|persons?|humans?|faces?|hands?|shoulders?|bodies|body|anatom\w*|reviewers?|colleagues?|photograph\w*|photorealis\w*|realistic|broken|fail(?:ed|ure)?|uncertain\w*|providers?|charges?|payments?|billing|private|identif\w*|credentials?|secrets?|receipts?|distress|violence|weapons?|nudity|over-the-shoulder)\b/i;
const forbiddenAuthoredCopy = /7\/10|2\/10|3\/10|\.doc\b|\.ppt\b|\.mov\b|\.mp3\b|\.psd\b|Your content\. One context\.|\bP[012]\b|PRIVATE_[A-Z_]+/i;

test("replaces the exact terminally rejected storyboard frame prompt with a materially different people-free geometric visual", () => {
  assert.equal(rejectedPrompt.length, 1215);
  assert.equal(digest(rejectedPrompt), rejectedPromptHash);

  const source = fixture();
  const original = structuredClone(source);
  const prepared = storyboardSafeRecoveryRenderingInput(source.prepared, source.frames[1], 1);
  const prompt = storyboardSafeRecoveryProviderPrompt(prepared);

  assert.deepEqual(source, original, "the original context, authored frame captions, and failed provider direction remain immutable");
  assert.equal(prepared.size, "1536x1024");
  assert.equal(prepared.ideogramCaptionStrategy, "compact_literal");
  assert.notEqual(digest(prompt), rejectedPromptHash, "a terminally rejected image prompt must never be submitted unchanged");
  assert.doesNotMatch(prepared.direction.scene, forbiddenVisualTerms);
  assert.doesNotMatch(prompt, forbiddenVisualTerms);
  assert.doesNotMatch(prompt, forbiddenAuthoredCopy);
  assert.match(prompt, /flat-vector editorial product illustration/i);
  assert.match(prompt, /rounded.*context cards/i);
  assert.match(prompt, /sidebar partly overlaps/i);
  assert.match(prompt, /three plain horizontal indicator bars/i);
  assert.match(prompt, /long amber bar.*short charcoal bar.*longer warm gray bar/i);
  assert.match(prompt, /TEXT: Do not render words, letters, numbers, labels/i);
  assert.match(prompt, /No reference pixels are attached/i);
  assert.match(source.frames[1].body, /7\/10.*2\/10.*3\/10/);
  assert.match(source.frames[1].body, /Your content\. One context\. Infinite paths to your target\./);
});

test("gives every retained storyboard beat a distinct safe visual without changing its authored meaning", () => {
  const source = fixture();
  const prepared = source.frames.map((frame, index) => storyboardSafeRecoveryRenderingInput(source.prepared, frame, index));
  const prompts = prepared.map(storyboardSafeRecoveryProviderPrompt);

  assert.equal(new Set(prompts.map(digest)).size, 4, "four narrative beats need four genuinely distinct provider image requests");
  for (const [index, prompt] of prompts.entries()) {
    assert.notEqual(digest(prompt), rejectedPromptHash, `frame ${index + 1} must not reuse the blocked image prompt`);
    assert.doesNotMatch(prompt, forbiddenVisualTerms);
    assert.doesNotMatch(prompt, forbiddenAuthoredCopy);
    assert.match(prompt, /1536\s*[×x]\s*1024/);
    assert.match(prompt, /warm amber/i);
    assert.match(prompt, /soft charcoal/i);
    assert.match(prompt, /flat-vector/i);
    assert.match(prompt, /Objects-only still-life/i);
  }

  assert.match(prompts[0], /separate blank document-shaped cards.*central context tile/is);
  assert.match(prompts[1], /sidebar partly overlaps.*horizontal indicator bars/is);
  assert.match(prompts[2], /progress path interrupted.*outlined destination panel/is);
  assert.match(prompts[3], /Three clean vertical planning columns.*branching curved paths/is);
});

test("retains only safe authored visual constraints and never forwards body, source, or payment context", () => {
  const source = fixture();
  const prepared = storyboardSafeRecoveryRenderingInput(source.prepared, source.frames[2], 2);

  assert.deepEqual(prepared.snapshot.facts.map((fact) => fact.type), ["palette", "lighting", "style", "exclusion"]);
  assert.deepEqual(prepared.snapshot.standing_constraints, [{ axis: "palette", polarity: "affirm", value: "dusk-warm" }]);
  assert.doesNotMatch(JSON.stringify({ snapshot: prepared.snapshot, direction: prepared.direction }), forbiddenVisualTerms);
  assert.doesNotMatch(JSON.stringify({ snapshot: prepared.snapshot, direction: prepared.direction }), forbiddenAuthoredCopy);
  const prompt = storyboardSafeRecoveryProviderPrompt(prepared);
  assert.match(prompt, /EXCLUDE:.*watermarks.*logos.*signatures.*borders/i);
  assert.match(prompt, /MANDATORY AUTHORED DECISION — PALETTE: dusk-warm/i);
});
