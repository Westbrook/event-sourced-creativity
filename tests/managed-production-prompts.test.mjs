import assert from "node:assert/strict";
import test from "node:test";

import { buildBoundedPromptRepresentation, buildPromptRepresentation, buildReferencePromptDirectives, PROMPT_TECHNIQUES } from "../src/model/prompt-structures.ts";
import { buildIdeogramCaption, validateIdeogramCaption } from "../worker/ideogram-caption-adapter.ts";
import { buildIdeogramPrompt } from "../worker/ideogram-prompt-adapter.ts";

function managedSnapshot() {
  return {
    facts: [{
      block_id: "PRIVATE_BLOCK_IDENTIFIER_8731",
      type: "subject",
      locked: true,
      properties: {
        text: "Mara studies a silver compass beneath moonlight",
        preference_id: "PRIVATE_PREFERENCE_IDENTIFIER_8731",
        evidenceRefs: ["PRIVATE_EVIDENCE_IDENTIFIER_8731"],
        requiredBlockIds: ["PRIVATE_REQUIRED_IDENTIFIER_8731"],
        document_id: "PRIVATE_DOCUMENT_IDENTIFIER_8731",
      },
    }],
    production_brief: {
      team: [{ role: "CREATIVE_DIRECTOR_SENTINEL", responsibility: "PRESERVE_CHARACTER_CONTINUITY_SENTINEL" }],
      continuity_bible: {
        subjects: ["Mara studies a silver compass"],
        prohibitions: ["Never include a forbidden modern vehicle"],
        requiredBlockIds: ["PRIVATE_BIBLE_IDENTIFIER_8731"],
      },
      required_source_coverage: Array.from({ length: 12 }, (_, index) => `COVERAGE_SENTINEL_${index + 1}`),
    },
  };
}

test("all actual managed image prompt adapters retain every authored production decision without private IDs", () => {
  const snapshot = managedSnapshot();
  const direction = { title: "Midnight observatory", scene: "Mara studies the compass in a moonlit observatory." };
  const canonical = buildPromptRepresentation("prose", snapshot, direction);
  const actual = [
    ...PROMPT_TECHNIQUES.map((technique) => ({ name: technique, prompt: buildPromptRepresentation(technique, snapshot, direction), valid: true })),
    { name: "ideogram-expanded", ...buildIdeogramPrompt(snapshot, direction, canonical, [], { ideogramCaptionStrategy: "production_director" }) },
    { name: "ideogram-native", ...buildIdeogramCaption(snapshot, direction, canonical, [], { ideogramCaptionStrategy: "balanced" }) },
  ];
  for (const representation of actual) {
    assert.equal(representation.valid, true, `${representation.name}: ${(representation.issues ?? []).join(", ")}`);
    assert.match(representation.prompt, /CREATIVE_DIRECTOR_SENTINEL/, representation.name);
    assert.match(representation.prompt, /PRESERVE_CHARACTER_CONTINUITY_SENTINEL/, representation.name);
    assert.match(representation.prompt, /forbidden modern vehicle/i, representation.name);
    assert.doesNotMatch(representation.prompt, /PRIVATE_(?:BLOCK|PREFERENCE|EVIDENCE|REQUIRED|DOCUMENT|BIBLE)_IDENTIFIER_8731/, representation.name);
    for (let index = 1; index <= 12; index += 1) assert.match(representation.prompt, new RegExp(`COVERAGE_SENTINEL_${index}\\b`), representation.name);
  }
  const caption = actual.find((representation) => representation.name === "ideogram-native");
  assert.equal(validateIdeogramCaption(caption.caption).valid, true);
});

test("manual image prompts do not accidentally receive managed production roles", () => {
  const snapshot = managedSnapshot();
  delete snapshot.production_brief;
  const direction = { scene: "A careful moonlight study." };
  for (const technique of PROMPT_TECHNIQUES) assert.doesNotMatch(buildPromptRepresentation(technique, snapshot, direction), /CREATIVE_DIRECTOR_SENTINEL|COVERAGE_SENTINEL/);
});

test("subject-scoped bullet directions retain the named authored target without durable identifiers", () => {
  const snapshot = { facts: [
    { block_id: "PRIVATE_SUBJECT_IDENTIFIER_8731", type: "subject", properties: { text: "MARA_SCOPED_TARGET_8731" } },
    { block_id: "PRIVATE_PALETTE_IDENTIFIER_8731", type: "palette", properties: { text: "MARA_ONLY_CRIMSON_8731", spatial_scope: { kind: "subject", subject_block_id: "PRIVATE_SUBJECT_IDENTIFIER_8731", subject_relation: "around", polarity: "inside", falloff: "soft", feather: .2 } } },
  ] };
  const prompt = buildPromptRepresentation("bullets", snapshot, { scene: "A moonlit character study." });
  assert.match(prompt, /MARA_ONLY_CRIMSON_8731[\s\S]*around the subject “MARA_SCOPED_TARGET_8731”/);
  assert.doesNotMatch(prompt, /PRIVATE_(?:SUBJECT|PALETTE)_IDENTIFIER_8731/);
});

test("target-specific production requirements and prohibitions remain attached to the correct character", () => {
  const snapshot = managedSnapshot();
  snapshot.production_brief.required_source_coverage = [];
  snapshot.production_brief.scoped_targets = [
    { target: "Mara", role: "character", required: ["ONLY_MARA_CRIMSON_COAT_8731"], prohibitions: ["MARA_FORBIDDEN_RED_LOGO_8731"], private_group_id: "PRIVATE_MARA_GROUP_8731" },
    { target: "Ivo", role: "character", required: ["ONLY_IVO_COBALT_LANTERN_8731"], prohibitions: [] },
  ];
  const direction = { scene: "Mara and Ivo explore the observatory without exchanging identity details." };
  const canonical = buildPromptRepresentation("prose", snapshot, direction);
  const adapted = [
    ...PROMPT_TECHNIQUES.map((technique) => ({ name: technique, prompt: buildPromptRepresentation(technique, snapshot, direction), valid: true })),
    { name: "ideogram-expanded", ...buildIdeogramPrompt(snapshot, direction, canonical, [], { ideogramCaptionStrategy: "production_director" }) },
    { name: "ideogram-native", ...buildIdeogramCaption(snapshot, direction, canonical, []) },
  ];
  for (const representation of adapted) {
    assert.equal(representation.valid, true, `${representation.name}: ${(representation.issues ?? []).join(", ")}`);
    assert.match(representation.prompt, /Mara[\s\S]*ONLY_MARA_CRIMSON_COAT_8731/);
    assert.match(representation.prompt, /Mara[\s\S]*MARA_FORBIDDEN_RED_LOGO_8731/);
    assert.match(representation.prompt, /Ivo[\s\S]*ONLY_IVO_COBALT_LANTERN_8731/);
    assert.doesNotMatch(representation.prompt, /PRIVATE_MARA_GROUP_8731/);
  }
});

test("provider prompt compaction rejects oversized mandatory copy instead of silently deleting authored requirements", () => {
  const required = `${"authored detail ".repeat(2_500)}EXACT_LOCKED_LEGAL_COPY_END_8731`;
  const forbidden = `${"forbidden detail ".repeat(2_300)}FORBIDDEN_HARD_BOUNDARY_END_8731`;
  const snapshot = { facts: [
    { block_id: "locked-copy", type: "typography", locked: true, properties: { text: required, exact_text: required } },
    { block_id: "hard-exclusion", type: "exclusion", locked: true, intent: "prohibit", effect: "must_not_include", properties: { text: forbidden } },
  ] };
  for (const technique of PROMPT_TECHNIQUES) {
    const bounded = buildBoundedPromptRepresentation(technique, snapshot, { scene: "Keep all exact locked requirements." });
    assert.equal(bounded.fits, false, technique);
    assert.match(bounded.prompt, /EXACT_LOCKED_LEGAL_COPY_END_8731/, technique);
    assert.match(bounded.prompt, /FORBIDDEN_HARD_BOUNDARY_END_8731/, technique);
  }
});

test("accepted style and composition studies do not silently turn into identity-preserving references", () => {
  const style = buildReferencePromptDirectives([{ source: "locked-study", mode: "preserve_style", label: "Shared palette" }]);
  const composition = buildReferencePromptDirectives([{ source: "locked-study", mode: "preserve_composition", label: "Shared framing" }]);
  assert.match(style, /visual style and material language/i);
  assert.doesNotMatch(style, /preserve its established identity/i);
  assert.match(composition, /composition, framing, balance/i);
  assert.doesNotMatch(composition, /preserve its established identity/i);
});
