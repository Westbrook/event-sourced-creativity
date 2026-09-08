import assert from "node:assert/strict";
import test from "node:test";
import { adaptDocumentToModel3d, MODEL3D_PROMPT_ADAPTER_VERSION, model3dAdaptationReceipt } from "../src/model/model3d-prompt-adapter.ts";

const fact = (id, type, text, properties = {}, fields = {}) => ({
  block_id: id, type, role: type, active: true, intent: properties.intent ?? (type === "exclusion" ? "avoid" : "include"),
  properties: { text, ...properties }, ...fields,
});
const snapshot = (...facts) => ({ facts });
const issue = (result, code) => result.issues.find(item => item.code === code);
const suggestion = (result, code) => result.suggestions.find(item => item.code === code);

test("derives a complete prompt from document subject, materials and style without manual prompt input", () => {
  const source = snapshot(
    fact("chair", "subject", "A low lounge chair with a curved back"),
    fact("wood", "material", "Oiled walnut and brushed brass"),
    fact("style", "style", "Scandinavian simplicity"),
  );
  const before = structuredClone(source);
  const result = adaptDocumentToModel3d(source);
  assert.equal(result.valid, true);
  assert.equal(result.prompt, "subject: A low lounge chair with a curved back\nmaterial: Oiled walnut and brushed brass\nstyle: Scandinavian simplicity");
  assert.deepEqual(result.includedBlockIds, ["chair", "wood", "style"]);
  assert.deepEqual(result.omittedBlockIds, []);
  assert.equal(result.adapterVersion, MODEL3D_PROMPT_ADAPTER_VERSION);
  assert.equal(result.promptCharacters, Array.from(result.prompt).length);
  assert.deepEqual(source, before);
});

test("a clear Direction is sufficient and document titles never invent a subject", () => {
  const source = { title: "PRIVATE_DOCUMENT_TITLE", document_title: "OTHER_PRIVATE_TITLE", ...snapshot(fact("brief", "direction", "A small wooden treasure chest with brass trim")) };
  const result = adaptDocumentToModel3d(source);
  assert.equal(result.valid, true);
  assert.equal(result.prompt, "direction: A small wooden treasure chest with brass trim");
  assert.ok(suggestion(result, "model3d_suggest_subject"));
  assert.doesNotMatch(result.prompt, /PRIVATE|OTHER/);
  assert.equal(adaptDocumentToModel3d({ title: "A chair" }).valid, false);
});

test("explicit image-only input accepts an empty prompt without inventing a file-derived subject", () => {
  const source = snapshot(fact("view", "model3d", "", { label: "private-model.glb", model_url: "/api/media/secret", model_view: { camera: "secret" } }));
  for (const referenceCount of [1, 5]) {
    const result = adaptDocumentToModel3d(source, { referenceCount });
    assert.equal(result.valid, true);
    assert.equal(result.prompt, "");
    assert.equal(result.promptCharacters, 0);
    assert.deepEqual(result.includedBlockIds, []);
    assert.equal(suggestion(result, "model3d_suggest_reference_view"), undefined);
  }
  assert.ok(issue(adaptDocumentToModel3d(source), "model3d_document_prompt_empty"));
});

test("invalid image counts and malformed contexts never claim a valid adaptation", () => {
  for (const referenceCount of [-1, 6, 0.5, NaN, Infinity]) {
    assert.ok(issue(adaptDocumentToModel3d(snapshot(fact("subject", "subject", "Chair")), { referenceCount }), "model3d_document_reference_count_invalid"));
  }
  for (const source of [{ facts: {} }, { facts: [null] }, null]) {
    assert.ok(issue(adaptDocumentToModel3d(source, { referenceCount: 1 }), "model3d_document_context_invalid"));
  }
  const duplicate = snapshot(fact("same", "subject", "Chair"), fact("same", "subject", "Table"));
  assert.ok(issue(adaptDocumentToModel3d(duplicate), "model3d_document_context_invalid"));
});

test("disabled, removed, zero-weight, inactive audio and Output control facts cannot influence the prompt", () => {
  const result = adaptDocumentToModel3d(snapshot(
    fact("keep", "subject", "Ceramic bowl"),
    fact("disabled", "style", "DISABLED", { active: false }),
    fact("removed", "material", "REMOVED", {}, { removed: true }),
    fact("zero", "palette", "ZERO", { weight: 0 }),
    fact("output", "output", "OUTPUT_QUANTITY_SECRET"),
    fact("audio", "audio", "AUDIO_SECRET", { inform_generation: false }),
  ));
  assert.equal(result.valid, true);
  assert.equal(result.prompt, "subject: Ceramic bowl");
  assert.deepEqual(result.includedBlockIds, ["keep"]);
  assert.deepEqual(result.omittedBlockIds, []);
});

test("all subject facts and prohibitions survive optional packing with their intent intact", () => {
  const result = adaptDocumentToModel3d(snapshot(
    fact("decor", "lighting", "OPTIONAL_DECORATIVE_MOONLIGHT ".repeat(60)),
    fact("hero", "subject", "A small treasure chest"),
    fact("prop", "subject", "One iron key next to the chest"),
    fact("ban", "exclusion", "Plastic fittings", { intent: "prohibit" }),
    fact("soft", "material", "Weathered oak", { intent: "prefer" }),
  ));
  assert.equal(result.valid, true);
  assert.match(result.prompt, /subject: A small treasure chest/);
  assert.match(result.prompt, /subject: One iron key next to the chest/);
  assert.match(result.prompt, /Never include exclusion: Plastic fittings/);
  assert.match(result.prompt, /Prefer material: Weathered oak/);
  assert.doesNotMatch(result.prompt, /OPTIONAL_DECORATIVE/);
  assert.deepEqual(result.omittedBlockIds, ["decor"]);
  assert.ok(suggestion(result, "model3d_document_optional_context_omitted"));
});

test("the 1024 boundary counts Unicode code points including the whole generated clause", () => {
  const prefix = "subject: ";
  for (const glyph of ["🪑", "椅"]) {
    const exact = glyph.repeat(1024 - prefix.length);
    const result = adaptDocumentToModel3d(snapshot(fact("boundary", "subject", exact)));
    assert.equal(result.valid, true);
    assert.equal(result.prompt, prefix + exact);
    assert.equal(result.promptCharacters, 1024);
    const over = adaptDocumentToModel3d(snapshot(fact("boundary", "subject", exact + glyph)));
    assert.equal(over.valid, false);
    assert.equal(over.promptCharacters, 1025);
    assert.deepEqual(issue(over, "model3d_document_required_context_too_long").blockIds, ["boundary"]);
    assert.equal(over.prompt, prefix + exact + glyph, "invalid authored content remains intact for correction");
  }
});

test("canonical Avoid remains distinct from Never despite their shared derived effect", () => {
  const result = adaptDocumentToModel3d(snapshot(
    fact("hero", "subject", "Chair"),
    fact("avoid", "material", "Plastic", { intent: "avoid" }, { intent: "avoid", effect: "must_not_include" }),
    fact("never", "palette", "Crimson", { intent: "prohibit" }, { intent: "prohibit", effect: "must_not_include" }),
  ));
  assert.equal(result.valid, true);
  assert.match(result.prompt, /Avoid material: Plastic/);
  assert.doesNotMatch(result.prompt, /Never include material: Plastic/);
  assert.match(result.prompt, /Never include palette: Crimson/);
  assert.deepEqual(result.includedBlockIds, ["hero", "avoid", "never"]);
  const legacy = adaptDocumentToModel3d(snapshot({
    block_id: "legacy", type: "material", effect: "must_not_include", properties: { text: "Asbestos" },
  }), { referenceCount: 1 });
  assert.match(legacy.prompt, /Never include material: Asbestos/);
});

test("required context cannot disappear through an image-only fallback or sentence truncation", () => {
  const authored = "A required structural detail. ".repeat(60);
  const result = adaptDocumentToModel3d(snapshot(fact("long", "material", authored, { required: true })), { referenceCount: 1 });
  assert.equal(result.valid, false);
  assert.equal(result.prompt, "material: " + authored.trim());
  assert.ok(issue(result, "model3d_document_required_context_too_long"));
  assert.ok(issue(adaptDocumentToModel3d(snapshot(fact("empty", "subject", "")), { referenceCount: 1 }), "model3d_document_required_context_missing"));
});

test("optional clauses are included whole or omitted whole with a review disclosure", () => {
  const large = "First optional sentence. " + "SECOND_SENTENCE_MUST_NOT_BE_PARTLY_SENT ".repeat(40);
  const result = adaptDocumentToModel3d(snapshot(fact("hero", "subject", "Chair"), fact("large", "emotion", large), fact("small", "palette", "Crimson")));
  assert.equal(result.valid, true);
  assert.match(result.prompt, /palette: Crimson/);
  assert.doesNotMatch(result.prompt, /First optional|SECOND_SENTENCE/);
  assert.deepEqual(result.omittedBlockIds, ["large"]);
  assert.ok(suggestion(result, "model3d_document_optional_context_omitted"));
});

test("known structured colors, material descriptions, dimensions and safe-area values remain semantic", () => {
  const result = adaptDocumentToModel3d(snapshot(
    fact("hero", "subject", "Toy robot"),
    fact("palette", "palette", "", { colors: ["#aa2211", { name: "Ocean", hex: "#0088cc", api_key: "COLOR_SECRET" }] }),
    fact("material", "material", "", { materials: [{ name: "Shell", texture: "brushed", finish: "matte", provider_receipt: "MATERIAL_SECRET" }] }),
    fact("scale", "scale", "", { dimensions: { height: 12, width: 4, unit: "cm", owner_id: "DIMENSION_SECRET" } }),
    fact("required", "composition", "", { required: true, safe_area: { left: "keep clear", right: "do not crop" } }),
  ));
  assert.equal(result.valid, true);
  assert.match(result.prompt, /#aa2211.*Ocean.*#0088cc/);
  assert.match(result.prompt, /Shell.*brushed.*matte/);
  assert.match(result.prompt, /width: 4.*height: 12.*unit: cm/);
  assert.match(result.prompt, /right: do not crop.*left: keep clear/);
  assert.doesNotMatch(result.prompt, /SECRET|\{|api_key|owner_id/);
});

test("actual character-profile fields preserve authored identity, appearance and wardrobe without arbitrary fields", () => {
  const result = adaptDocumentToModel3d(snapshot(fact("person", "subject", "", {
    label: "Mara", character_context: true, character_profile: {
      identity: { name: "Mara", pronouns: "she/her", token: "IDENTITY_SECRET" },
      face: { nose: "straight bridge" }, eyes: { eye_color: "amber" },
      hair: { hair_style: "braided crown" }, body: { posture: "upright" },
      wardrobe: { fabric: "linen", accessories: "copper clasp" },
      shot: { expression: "thoughtful" }, unknown: { text: "UNKNOWN_SECRET" },
    },
  })));
  assert.equal(result.valid, true);
  for (const text of ["Mara", "Pronouns: she/her", "Nose: straight bridge", "Eye color: amber", "Hair style: braided crown", "Posture: upright", "Fabric: linen", "Accessories: copper clasp", "Expression: thoughtful"]) assert.ok(result.prompt.includes(text), text);
  assert.doesNotMatch(result.prompt, /SECRET|\[object Object\]/);
});

test("unrepresentable required values fail closed and optional ones disclose their omission", () => {
  const required = adaptDocumentToModel3d(snapshot(fact("hard", "material", "Authored material", { required: true, value: { unknown: "DO_NOT_SERIALIZE" } })), { referenceCount: 1 });
  assert.equal(required.valid, false);
  assert.ok(issue(required, "model3d_document_required_context_missing"));
  assert.doesNotMatch(required.prompt, /DO_NOT_SERIALIZE/);
  const optional = adaptDocumentToModel3d(snapshot(fact("hero", "subject", "Chair"), fact("optional", "material", "Authored material", { value: { unknown: "DO_NOT_SERIALIZE" } })));
  assert.equal(optional.valid, true);
  assert.deepEqual(optional.omittedBlockIds, ["optional"]);
  assert.ok(suggestion(optional, "model3d_document_optional_context_omitted"));
});

test("private metadata and arbitrary nested object content never become provider prompt JSON", () => {
  const result = adaptDocumentToModel3d(snapshot(fact("PRIVATE_BLOCK_ID", "subject", "A brass lamp", {
    api_key: "API_SECRET", authorization: "BEARER_SECRET", media_url: "/api/media/MEDIA_SECRET",
    model_url: "https://fal.media/MODEL_SECRET", model_view: { description: "VIEW_SECRET" },
    reference_composition: { prompt: "COMPOSITION_SECRET" }, artifact_markdown: "ARTIFACT_SECRET",
    source_excerpt: "EXCERPT_SECRET", providerInput: { text: "PROVIDER_SECRET" }, unknown: { text: "UNKNOWN_SECRET" },
  }, { source_event_refs: ["EVENT_SECRET"], handle: "HANDLE_SECRET" })));
  assert.equal(result.prompt, "subject: A brass lamp");
  assert.doesNotMatch(result.prompt, /PRIVATE|SECRET|api\/|\{|handle/);
});

test("embedded source locations are removed from semantic text and the omission is disclosed", () => {
  const result = adaptDocumentToModel3d(snapshot(fact("hero", "subject",
    "A copper kettle. See https://example.test/a?token=REMOTE_SECRET and /api/media/LOCAL_SECRET or data:image/png;base64,DATA_SECRET for details."
  )));
  assert.equal(result.valid, true);
  assert.match(result.prompt, /copper kettle/);
  assert.doesNotMatch(result.prompt, /SECRET|https:|\/api\/media|data:image/);
  assert.ok(suggestion(result, "model3d_document_source_links_omitted"));
  assert.equal(adaptDocumentToModel3d(snapshot(fact("source", "subject", "https://example.test/ONLY_SECRET"))).valid, false);
});

test("membership-scoped negative and positive facts never become global rules", () => {
  const membership = target => ({ contextSetId: "PRIVATE_GROUP_" + target, name: target, target, role: "object", application: "isolate", memberOrder: 0 });
  const result = adaptDocumentToModel3d(snapshot(
    fact("two", "subject", "Two chairs"),
    fact("left", "palette", "Crimson", { combined_context_memberships: [membership("left chair")] }),
    fact("right", "palette", "Crimson", { intent: "prohibit", combined_context_memberships: [membership("right chair")] }),
  ));
  assert.equal(result.valid, true);
  assert.match(result.prompt, /palette \[only for "left chair"\]: Crimson/);
  assert.match(result.prompt, /Never include palette \[only for "right chair"\]: Crimson/);
  assert.doesNotMatch(result.prompt, /PRIVATE_GROUP/);
});

test("actual context_contains relationships preserve nested target identity and authored member order", () => {
  const source = snapshot(
    fact("character", "subject", "Mara", { context_group: { target: "Mara", application: "isolate" } }),
    fact("wardrobe", "style", "Traveling clothes", { label: "Mara's wardrobe", context_group: { target: "Mara's wardrobe", application: "ordered" } }),
    fact("fabric", "material", "Indigo linen"),
  );
  source.relationships = [
    { relation_id: "PRIVATE_REL_A", from_block_id: "character", to_block_id: "wardrobe", kind: "context_contains", properties: { member_order: 0 } },
    { relation_id: "PRIVATE_REL_B", from_block_id: "wardrobe", to_block_id: "fabric", kind: "context_contains", properties: { member_order: 2 } },
  ];
  const result = adaptDocumentToModel3d(source);
  assert.equal(result.valid, true);
  assert.match(result.prompt, /material \[only for "Mara's wardrobe", ordered member 3; only for "Mara"\]: Indigo linen/);
  assert.doesNotMatch(result.prompt, /PRIVATE_REL/);
  assert.deepEqual(result.includedBlockIds, ["character", "wardrobe", "fabric"]);
});

test("action participants resolve to current authored labels instead of private IDs or stale handles", () => {
  const source = snapshot(
    fact("person-id", "subject", "Mara", { label: "Mara" }),
    fact("object-id", "subject", "An iron key", { label: "Key" }),
    fact("action-id", "action", "Holds at shoulder height", { block_references: [{ block_id: "person-id", role: "actor", handle: "STALE_HANDLE" }] }),
  );
  source.relationships = [{ from_block_id: "action-id", to_block_id: "object-id", kind: "action_participant", properties: { participant_role: "target" } }];
  const result = adaptDocumentToModel3d(source);
  assert.equal(result.valid, true);
  assert.match(result.prompt, /action \[actor: "Mara"; target: "Key"\]: Holds at shoulder height/);
  assert.doesNotMatch(result.prompt, /STALE_HANDLE|person-id|object-id|action-id/);
});

test("missing or cyclic context targets and malformed scopes fail instead of becoming global instructions", () => {
  const missing = snapshot(fact("material", "material", "Red lacquer"));
  missing.relationships = [{ from_block_id: "missing", to_block_id: "material", kind: "context_contains" }];
  assert.ok(issue(adaptDocumentToModel3d(missing, { referenceCount: 1 }), "model3d_document_scope_unavailable"));
  const cycle = snapshot(fact("a", "subject", "Chair"), fact("b", "material", "Walnut"));
  cycle.relationships = [{ from_block_id: "a", to_block_id: "b", kind: "context_contains" }, { from_block_id: "b", to_block_id: "a", kind: "context_contains" }];
  assert.ok(issue(adaptDocumentToModel3d(cycle), "model3d_document_scope_unavailable"));
  for (const spatial_scope of [{ kind: "unknown" }, { kind: "subject", subject_block_id: "missing" }, { kind: "path", path: [{ x: 0, y: 0 }] }]) {
    assert.ok(issue(adaptDocumentToModel3d(snapshot(fact("bad", "subject", "Chair", { spatial_scope }))), "model3d_document_scope_unavailable"));
  }
});

test("subject-relative and document-normalized spatial scope keep their authored polarity", () => {
  const result = adaptDocumentToModel3d(snapshot(
    fact("hero", "subject", "Tree", { label: "Tree" }),
    fact("flowers", "subject", "Wildflowers", { spatial_scope: { kind: "subject", subject_block_id: "hero", subject_relation: "around", polarity: "outside", falloff: "hard", feather: 0 } }),
    fact("paint", "palette", "Gold", { spatial_scope: { kind: "aabb", aabb: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, polarity: "inside" } }),
  ));
  assert.equal(result.valid, true);
  assert.match(result.prompt, /outside the area around "Tree"; hard boundary/);
  assert.match(result.prompt, /inside document-normalized rectangle \(x=0.1, y=0.2, width=0.3, height=0.4\)/);
  assert.doesNotMatch(result.prompt, /subject_block_id|hero/);
});

test("standing authorial constraints remain mandatory and URLs are not introduced by their values", () => {
  const source = snapshot(fact("hero", "subject", "Chair"));
  source.standing_constraints = [
    { axis: "material", polarity: "forbid", value: "Plastic" },
    { axis: "palette", polarity: "affirm", value: "Deep indigo" },
    { axis: "secret", active: false, value: "DISABLED_SECRET" },
  ];
  const result = adaptDocumentToModel3d(source);
  assert.equal(result.valid, true);
  assert.match(result.prompt, /Never include material: Plastic/);
  assert.match(result.prompt, /Require palette: Deep indigo/);
  assert.doesNotMatch(result.prompt, /DISABLED_SECRET/);
  source.standing_constraints.push({ axis: "required", value: "A".repeat(1025) });
  assert.ok(issue(adaptDocumentToModel3d(source), "model3d_document_required_context_too_long"));
});

test("audio and motion context never acquire a claim that meshes generate sound or animation", () => {
  const result = adaptDocumentToModel3d(snapshot(
    fact("hero", "subject", "A bronze bell"),
    fact("sound", "audio", "Low and resonant", { inform_generation: true }),
    fact("movement", "motion", "Leaning forward"),
  ));
  assert.equal(result.valid, true);
  assert.match(result.prompt, /bronze bell/);
  assert.match(result.prompt, /Leaning forward/);
  assert.match(suggestion(result, "model3d_static_context_only").message, /sound and animation are not generated/);
});

test("missing enrichment blocks produce optional suggestions without preventing a usable request", () => {
  const result = adaptDocumentToModel3d(snapshot(fact("brief", "direction", "A small clay owl")));
  assert.equal(result.valid, true);
  for (const code of ["model3d_suggest_subject", "model3d_suggest_material", "model3d_suggest_scale", "model3d_suggest_reference_view"]) assert.ok(suggestion(result, code));
  assert.deepEqual(result.issues, []);
});

test("review provenance is deterministic, has exact membership and cannot mutate the adaptation", () => {
  const source = snapshot(fact("hero", "subject", "Chair"), fact("omitted", "style", "Optional ".repeat(200)));
  const result = adaptDocumentToModel3d(source);
  const first = model3dAdaptationReceipt(result);
  assert.deepEqual(Object.keys(first), ["adapterVersion", "includedBlockIds", "omittedBlockIds"]);
  assert.deepEqual(first, { adapterVersion: MODEL3D_PROMPT_ADAPTER_VERSION, includedBlockIds: ["hero"], omittedBlockIds: ["omitted"] });
  assert.equal(JSON.stringify(first), JSON.stringify(model3dAdaptationReceipt(adaptDocumentToModel3d(structuredClone(source)))));
  first.includedBlockIds.push("UNREVIEWED");
  first.omittedBlockIds.length = 0;
  assert.deepEqual(result.includedBlockIds, ["hero"]);
  assert.deepEqual(result.omittedBlockIds, ["omitted"]);
  assert.equal(Object.hasOwn(first, "prompt"), false);
});

test("converging context paths preserve first-seen scope and distinct shared-parent member orders", () => {
  const source = snapshot(
    fact("root", "style", "", { context_group: { target: "Root" } }),
    fact("left", "style", "", { context_group: { target: "Left shell" } }),
    fact("leaf", "subject", "A brass lamp"),
    fact("shared", "style", "", { context_group: { target: "Assembly", application: "ordered" } }),
    fact("right", "style", "", { context_group: { target: "Right shell" } }),
  );
  source.relationships = [
    { from_block_id: "left", to_block_id: "leaf", kind: "context_contains" },
    { from_block_id: "right", to_block_id: "leaf", kind: "context_contains" },
    { from_block_id: "shared", to_block_id: "left", kind: "context_contains", properties: { member_order: 0 } },
    { from_block_id: "shared", to_block_id: "right", kind: "context_contains", properties: { member_order: 4 } },
    { from_block_id: "root", to_block_id: "shared", kind: "context_contains" },
  ];
  const result = adaptDocumentToModel3d(source);
  assert.equal(result.valid, true);
  assert.equal(result.prompt, 'subject [only for "Left shell"; only for "Assembly", ordered member 1; only for "Root"; only for "Right shell"; only for "Assembly", ordered member 5]: A brass lamp');
  assert.deepEqual(result.includedBlockIds, ["root", "left", "leaf", "shared", "right"]);
  assert.deepEqual(result.omittedBlockIds, []);
});

test("a layered converging context DAG reads shared ancestors in proportion to its edges", () => {
  const layers = 10;
  const source = snapshot(fact("leaf", "subject", "A brass lamp"));
  source.relationships = [];
  let children = ["leaf"], parentReads = 0;
  for (let layer = 0; layer < layers; layer++) {
    const parents = ["group-" + layer + "-left", "group-" + layer + "-right"];
    for (const parentId of parents) {
      source.facts.push(fact(parentId, "style", "", { context_group: { target: "Assembly" } }));
      for (const childId of children) {
        // Count source-edge reads, not elapsed time. The getter returns the
        // same authored ID on every read and performs no graph work itself.
        source.relationships.push({
          get from_block_id() { parentReads++; return parentId; },
          to_block_id: childId,
          kind: "context_contains",
        });
      }
    }
    children = parents;
  }
  const result = adaptDocumentToModel3d(source);
  assert.equal(source.facts.length, 21);
  assert.equal(source.relationships.length, 38);
  assert.equal(result.valid, true);
  assert.equal(result.prompt, 'subject [only for "Assembly"]: A brass lamp');
  assert.deepEqual(result.includedBlockIds, source.facts.map(item => item.block_id));
  assert.deepEqual(result.omittedBlockIds, []);
  assert.ok(parentReads >= source.relationships.length, "every distinct ancestor edge is read");
  assert.ok(parentReads <= source.relationships.length * 2, "shared ancestors are not re-expanded for every path");
});

test("a deep chain of scope-only groups preserves all provenance without recursive stack growth", () => {
  const depth = 8192;
  const source = { facts: [], relationships: [] };
  for (let index = 0; index < depth; index++) {
    const id = "group-" + index;
    source.facts.push(fact(id, "style", "", { context_group: { target: "Assembly" } }));
    source.relationships.push({ from_block_id: id, to_block_id: index === 0 ? "leaf" : "group-" + (index - 1), kind: "context_contains" });
  }
  // Only the leaf has semantic text; repeated scope labels keep the provider
  // prompt constant while the finite chain exercises traversal depth.
  source.facts.push(fact("leaf", "subject", "A brass lamp"));
  const result = adaptDocumentToModel3d(source);
  assert.equal(source.facts.length, depth + 1);
  assert.equal(source.relationships.length, depth);
  assert.equal(result.valid, true);
  assert.equal(result.prompt, 'subject [only for "Assembly"]: A brass lamp');
  assert.deepEqual(result.includedBlockIds, source.facts.map(item => item.block_id));
  assert.deepEqual(result.omittedBlockIds, []);
});

test("cycles and missing parents reached through converging paths remain fail-closed", () => {
  for (const invalidEdge of [
    { from_block_id: "right", to_block_id: "top", kind: "context_contains" },
    { from_block_id: "missing", to_block_id: "right", kind: "context_contains" },
  ]) {
    const source = snapshot(
      ...["left", "right", "shared", "top"].map(id => fact(id, "style", "", { context_group: { target: "Assembly" } })),
      fact("leaf", "subject", "A brass lamp"),
    );
    source.relationships = [
      { from_block_id: "left", to_block_id: "leaf", kind: "context_contains" },
      { from_block_id: "right", to_block_id: "leaf", kind: "context_contains" },
      { from_block_id: "shared", to_block_id: "left", kind: "context_contains" },
      { from_block_id: "shared", to_block_id: "right", kind: "context_contains" },
      { from_block_id: "top", to_block_id: "shared", kind: "context_contains" },
      invalidEdge,
    ];
    const result = adaptDocumentToModel3d(source, { referenceCount: 1 });
    assert.equal(result.valid, false);
    assert.deepEqual(issue(result, "model3d_document_scope_unavailable")?.blockIds, ["leaf"]);
    assert.equal(result.prompt, "");
    assert.deepEqual(result.includedBlockIds, []);
    assert.deepEqual(result.omittedBlockIds, source.facts.map(item => item.block_id));
  }
});
