import test from "node:test";
import assert from "node:assert/strict";
import {
  creativePromptGuardrails,
  promptFactIsActive,
  providerFacingCreativeContext,
  providerFacingRenderingContext,
} from "../src/model/prompt-policy.ts";

const differentiationQuote = "The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";
const marketResearchQuote = "An asynchronous job without a global, actionable inbox is just work the customer has to remember to check.";
const productOwnerScreenQuote = "Every extra inch of screen should reveal a useful relationship, not another column of product chrome.";
const leadDesignerScreenQuote = "A smaller screen is not a smaller product; it is a stricter argument about what deserves the next square inch.";

test("experience context retains semantic instructions without private recipe metadata", () => {
  const properties = { text: "Secret known by: Participant A", experience_origin: "default", experience_release: "private-release-hash", experience_binding: "knowledge", experience_value: "a" };
  const result = providerFacingRenderingContext({ facts: [{ block_id: "private-block", type: "direction", properties }] });
  assert.equal(result.facts[0].properties.text, properties.text);
  assert.doesNotMatch(JSON.stringify(result), /experience_|private-release-hash|private-block/);
});

test("authored text-only audio direction remains usable while private or opted-out references stay local", () => {
  const authored = { block_id: "authored-audio", type: "audio", properties: { text: "Warm piano beneath distant waves.", label: "Soundtrack", subtype: "direction", weight: 1, spatial_scope: { kind: "document" } } };
  assert.equal(promptFactIsActive(authored), true);
  assert.deepEqual(providerFacingCreativeContext({ facts: [authored] }).facts, [authored]);

  for (const properties of [
    { inform_generation: false },
    { media_url: "" },
    { source_mime_type: "audio/mpeg" },
    { source_content_hash: "PRIVATE_HASH" },
    { contentRef: "PRIVATE_REFERENCE" },
    { reference_id: "PRIVATE_REFERENCE" },
    { transcript: "PRIVATE_TRANSCRIPT" },
    { lyrics: "PRIVATE_LYRICS" },
    { rights_class: "licensed" },
    { include_in_output: false },
    { allow_provider_audio_transfer: false },
    { nested: { providerMediaUrl: "/private/theme.mp3" } },
  ]) {
    const privateReference = { ...authored, properties: { ...authored.properties, ...properties } };
    assert.equal(promptFactIsActive(privateReference), false, Object.keys(properties)[0]);
    assert.deepEqual(providerFacingCreativeContext({ facts: [privateReference] }), { facts: [] });
  }

  for (const privateReference of [
    { ...authored, locked: true, properties: { ...authored.properties, inform_generation: false, transcript: "PRIVATE_LOCKED_TRANSCRIPT" } },
    { ...authored, properties: { ...authored.properties, required: true, lyrics: "PRIVATE_REQUIRED_LYRICS" } },
    { ...authored, properties: { ...authored.properties, audio_role: "silence", inform_generation: false, transcript: "PRIVATE_SILENCE_TRANSCRIPT" } },
    { ...authored, inform_generation: false },
    { ...authored, source_artifact_id: "PRIVATE_ARTIFACT" },
    { ...authored, properties: { ...authored.properties, text: " " } },
  ]) {
    assert.equal(promptFactIsActive(privateReference), false);
    assert.deepEqual(providerFacingCreativeContext({ facts: [privateReference] }), { facts: [] });
  }

  assert.equal(promptFactIsActive({ ...authored, properties: { ...authored.properties, inform_generation: true, media_url: "/private/theme.mp3" } }), true);
});

test("provider-facing rendering retains complete authored slide outlines, exact quotes, numerical precision, and protected product vocabulary", () => {
  const outline = [
    "SECTION I — Executive opportunity",
    "Slide 1. Projects / Work / Explore / Activity / Deliver",
    "Slide 2. Write / Shape / Present across four device postures",
    "Slide 3. Phone: 39.75",
    "Slide 4. Tablet: 53.00",
    "Slide 5. Small monitor: 67.25",
    "Slide 6. Large monitor: 68.50",
    "SECTION II — Source-backed execution",
    "Slide 7. Adaptive/accessibility: 58.75",
    "Slide 8. Governed creative loop: 79.50",
    "Slide 9. Exact equal-weight average: 61.125; rounded display value: 61.13",
    `Slide 10. “${differentiationQuote}” — Product Owner`,
    `Slide 11. “${marketResearchQuote}” — Market Researcher`,
    `Slide 12. “${productOwnerScreenQuote}” — Product Owner. “${leadDesignerScreenQuote}” — Lead Designer. Deliver a 4–6 week roadmap and a 12–16 week dependency-aware roadmap.`,
  ].join("\n");

  const rendered = providerFacingRenderingContext({
    facts: [{ block_id: "private-executive-outline", type: "narrative", properties: { text: outline } }],
  }, [{ alias: "blk_001", sourceId: "private-executive-outline", sourceKind: "block" }]);

  assert.equal(rendered.facts.length, 1);
  assert.equal(rendered.facts[0].decision_key, "decision_1");
  assert.equal(rendered.facts[0].source_key, "blk_001");
  assert.equal(rendered.facts[0].properties.text, outline);
  assert.equal(rendered.facts[0].properties.text.match(/^Slide \d+\./gm)?.length, 12);
  assert.ok(rendered.facts[0].properties.text.indexOf("SECTION I") < rendered.facts[0].properties.text.indexOf("SECTION II"));
  assert.ok(rendered.facts[0].properties.text.includes(`“${differentiationQuote}” — Product Owner`));
  assert.ok(rendered.facts[0].properties.text.includes(`“${marketResearchQuote}” — Market Researcher`));
  assert.ok(rendered.facts[0].properties.text.includes(`“${productOwnerScreenQuote}” — Product Owner`));
  assert.ok(rendered.facts[0].properties.text.includes(`“${leadDesignerScreenQuote}” — Lead Designer`));
  assert.ok(rendered.facts[0].properties.text.includes("Exact equal-weight average: 61.125; rounded display value: 61.13"));
  for (const value of ["39.75", "53.00", "67.25", "68.50", "58.75", "79.50"])
    assert.ok(rendered.facts[0].properties.text.includes(value));
  assert.doesNotMatch(JSON.stringify(rendered), /private-executive-outline/);
  assert.match(creativePromptGuardrails(), /numbered slide outlines/);
  assert.match(creativePromptGuardrails(), /exact values with rounded display values/);
  assert.match(creativePromptGuardrails(), /speaker, and role/);
});

test("a realistic managed 23-slide outline survives every authored section and active block without arbitrary truncation", () => {
  const sections = [
    { label: "Executive opportunity", start: 1, end: 8 },
    { label: "Evidence, devices, and source fidelity", start: 9, end: 16 },
    { label: "Governed delivery and dependency-aware roadmap", start: 17, end: 23 },
  ].map(({ label, start, end }, index) => ({
    block_id: `private-managed-outline-${index + 1}`,
    type: "direction",
    properties: {
      text: [
        `SECTION ${index + 1} — ${label}`,
        ...Array.from({ length: end - start + 1 }, (_, offset) => {
          const slide = start + offset;
          return `Slide ${slide}. ${slide === 23
            ? `“${leadDesignerScreenQuote}” — Lead Designer; deliver the 4–6 week and 12–16 week roadmaps.`
            : `Preserve authored argument ${slide} across phone portrait, phone landscape, tablet, and large monitor.`}`;
        }),
      ].join("\n"),
    },
  }));
  const aliases = sections.map((section, index) => ({
    alias: `blk_${String(index + 1).padStart(3, "0")}`,
    sourceId: section.block_id,
    sourceKind: "block",
  }));

  const rendered = providerFacingRenderingContext({ facts: sections }, aliases);
  const outline = rendered.facts.map((fact) => fact.properties.text).join("\n");

  assert.equal(outline.match(/^Slide \d+\./gm)?.length, 23);
  assert.deepEqual(rendered.facts.map((fact) => fact.source_key), ["blk_001", "blk_002", "blk_003"]);
  assert.deepEqual(rendered.facts.map((fact) => fact.decision_key), ["decision_1", "decision_2", "decision_3"]);
  for (const [index, section] of sections.entries()) assert.equal(rendered.facts[index].properties.text, section.properties.text);
  assert.ok(outline.indexOf("SECTION 1") < outline.indexOf("SECTION 2"));
  assert.ok(outline.indexOf("SECTION 2") < outline.indexOf("SECTION 3"));
  assert.ok(outline.includes(`“${leadDesignerScreenQuote}” — Lead Designer`));
  assert.ok(outline.includes("4–6 week and 12–16 week roadmaps"));
  assert.doesNotMatch(JSON.stringify(rendered), /private-managed-outline-/);
});

test("trusted source aliases preserve authorized block, group, and claim grounding without leaking restricted identifiers", () => {
  const privateBlock = "5caf6b36-13e4-4890-af09-private-block";
  const privateGroup = "22d366c3-390b-49b1-a340-private-group";
  const privateClaim = "8cf42d34-eabf-4774-bdd9-private-claim";
  const privateHash = "4a8ad6d9-private-content-hash";
  const snapshot = {
    tenant_id: "private-tenant",
    organization_id: "private-organization",
    actor_id: "private-actor",
    project_id: "private-project",
    document_id: "private-document",
    source_alias_map: { blk_001: privateBlock },
    private_inputs: [{ event_id: "private-event" }],
    facts: [
      {
        block_id: privateBlock,
        type: "evidence",
        source_claim_ids: [privateClaim],
        properties: {
          text: "Adaptive/accessibility: 58.75; governed creative loop: 79.50.",
          source_ref: "/private/source/document.pdf",
          source_url: "https://private.example/source.pdf",
          source_content_hash: privateHash,
          source_evidence_hash: "private-evidence-hash",
          source_fingerprint: "private-source-fingerprint",
          context_fingerprint: "private-context-fingerprint",
          source_event_id: "private-source-event",
          organization_context_source_block_id: "private-package-source-block",
          organization_context_package_id: "private-package",
          organization_context_package_version_id: "private-package-version",
          organization_context_package_binding_id: "private-package-binding",
          combined_context_memberships: [{ context_set_id: privateGroup }],
          claims: [{ source_claim_id: privateClaim, text: "Every governed score remains visible." }],
          nested: {
            sourceRef: "private-nested-ref",
            sha256: "private-nested-digest",
            authorization: "private-nested-authorization",
            api_key: "private-nested-api-key",
            access_token: "private-nested-access-token",
            refresh_token: "private-nested-refresh-token",
            client_secret: "private-nested-client-secret",
            credentials: "private-nested-credentials",
            password: "private-nested-password",
            private_content: "private-nested-content",
            input_receipt: "private-nested-receipt",
            provider_input: "private-nested-provider-input",
            frozen_inputs: ["private-nested-frozen-input"],
            tenantId: "private-nested-tenant",
            sourceIds: ["private-nested-source"],
            source_block_id: "private-nested-source-block",
            from_block_id: "private-nested-from",
            to_block_id: "private-nested-to",
            private_group_id: "private-nested-group",
            evidence_id: "private-nested-evidence",
            source_evidence_id: "private-nested-source-evidence",
            resource_id: "private-nested-resource",
            actor_user_id: "private-nested-actor",
          },
        },
      },
      { block_id: "private-inactive-block", active: false, properties: { text: "Do not transmit inactive source material." } },
    ],
    context_groups: [{ id: privateGroup, name: "Private group" }],
    blocks: [
      { block_id: privateBlock, type: "evidence", properties: { text: "Authorized source block only." } },
      { block_id: "private-foreign-block", properties: { text: "private-foreign-block-secret" } },
      { block_id: "private-inactive-block", active: false, properties: { text: "private-muted-block-secret" } },
    ],
    claims: [
      { id: privateClaim, block_id: privateBlock, label: "Authorized source-backed assessment" },
      { id: "private-foreign-claim", block_id: "private-foreign-block", label: "private-foreign-customer-secret" },
    ],
  };
  const aliases = [
    { alias: "blk_001", sourceId: privateBlock, sourceKind: "block", contextGroupIds: [privateGroup] },
    { alias: "grp_001", sourceId: privateGroup, sourceKind: "context-group" },
    { alias: "clm_001", sourceId: privateClaim, sourceKind: "claim", blockId: privateBlock },
    { alias: "blk_002", sourceId: "private-inactive-block", sourceKind: "block" },
  ];

  const rendered = providerFacingRenderingContext(snapshot, aliases);
  assert.deepEqual(rendered.facts.map(({ decision_key, source_key, source_group_keys, source_claim_keys }) => ({
    decision_key,
    source_key,
    source_group_keys,
    source_claim_keys,
  })), [{ decision_key: "decision_1", source_key: "blk_001", source_group_keys: ["grp_001"], source_claim_keys: ["clm_001"] }]);
  assert.equal(rendered.facts[0].properties.text, snapshot.facts[0].properties.text);
  assert.deepEqual(rendered.facts[0].properties.claims, [{ text: "Every governed score remains visible." }]);
  assert.deepEqual(rendered.claims, [{
    source_key: "clm_001",
    source_block_key: "blk_001",
    label: "Authorized source-backed assessment",
  }]);
  assert.deepEqual(rendered.blocks, [{
    source_key: "blk_001",
    type: "evidence",
    properties: { text: "Authorized source block only." },
  }]);
  assert.doesNotMatch(JSON.stringify(rendered), /private-|5caf6b36|22d366c3|8cf42d34|4a8ad6d9|https:\/\/private/);
  assert.deepEqual(rendered, providerFacingRenderingContext(snapshot, aliases));
  assert.equal(providerFacingCreativeContext(snapshot).facts.length, 1);
});

test("malformed, ambiguous, foreign, and authored-forged source aliases fail closed", () => {
  const snapshot = {
    facts: [{
      block_id: "authorized-block",
      source_key: "blk_999",
      source_group_keys: ["grp_999"],
      source_claim_keys: ["clm_999"],
      properties: {
        text: "The only authorized factual claim.",
        source_key: "blk_998",
        combined_context_memberships: [{ context_set_id: "unknown-group" }],
        source_claim_ids: ["unknown-claim"],
      },
    }],
  };

  const rendered = providerFacingRenderingContext(snapshot, [
    { alias: "blk_001", sourceId: "authorized-block", sourceKind: "block" },
    { alias: "blk_001", sourceId: "another-block", sourceKind: "block" },
    { alias: "claim_001", sourceId: "unknown-claim", sourceKind: "claim" },
    { alias: "grp_001", sourceId: "foreign-group", sourceKind: "context-group" },
    { alias: "clm_002", sourceId: "foreign-claim", sourceKind: "claim", blockId: "foreign-block" },
  ]);

  assert.equal(rendered.facts[0].decision_key, "decision_1");
  assert.equal("source_key" in rendered.facts[0], false);
  assert.equal("source_group_keys" in rendered.facts[0], false);
  assert.equal("source_claim_keys" in rendered.facts[0], false);
  assert.equal("source_key" in rendered.facts[0].properties, false);
  assert.doesNotMatch(JSON.stringify(rendered), /blk_999|blk_998|grp_999|clm_999|foreign-|unknown-|authorized-block/);

  const foreignClaim = providerFacingRenderingContext({
    facts: [{ block_id: "authorized-block", source_claim_ids: ["foreign-claim"], properties: { text: "Locally authorized source." } }],
  }, [
    { alias: "blk_001", sourceId: "authorized-block", sourceKind: "block" },
    { alias: "clm_001", sourceId: "foreign-claim", sourceKind: "claim", blockId: "foreign-block" },
  ]);
  assert.equal(foreignClaim.facts[0].source_key, "blk_001");
  assert.equal("source_claim_keys" in foreignClaim.facts[0], false);
  assert.doesNotMatch(JSON.stringify(foreignClaim), /foreign-|clm_001/);
});

test("block-only source snapshots retain authorized claims while excluding foreign tenant blocks", () => {
  const rendered = providerFacingRenderingContext({
    blocks: [
      { block_id: "private-approved-block", properties: { text: "The approved sourced argument." } },
      { block_id: "private-foreign-block", properties: { text: "private-foreign-block-secret" } },
    ],
    claims: [
      { id: "private-approved-claim", block_id: "private-approved-block", label: "Approved source claim" },
      { id: "private-foreign-claim", block_id: "private-foreign-block", label: "private-foreign-claim-secret" },
    ],
  }, [
    { alias: "blk_001", sourceId: "private-approved-block", sourceKind: "block" },
    { alias: "clm_001", sourceId: "private-approved-claim", sourceKind: "claim", blockId: "private-approved-block" },
  ]);

  assert.deepEqual(rendered.blocks, [{ source_key: "blk_001", properties: { text: "The approved sourced argument." } }]);
  assert.deepEqual(rendered.claims, [{ source_key: "clm_001", source_block_key: "blk_001", label: "Approved source claim" }]);
  assert.doesNotMatch(JSON.stringify(rendered), /private-/);
});

test("legacy rendering prompts remain byte-compatible without explicit source contracts", () => {
  const snapshot = {
    facts: [
      { block_id: "first-private-block", type: "subject", properties: { text: "Lead subject" } },
      { block_id: "second-private-block", type: "setting", properties: { text: "A private observatory" } },
    ],
    relationships: [{ from_block_id: "first-private-block", to_block_id: "second-private-block", kind: "occupies" }],
    pins: ["second-private-block"],
    claims: [{ id: "private-legacy-claim", block_id: "first-private-block", label: "A legacy authored claim" }],
  };

  const rendered = providerFacingRenderingContext(snapshot);
  assert.deepEqual(rendered.facts.map(({ decision_key, order }) => ({ decision_key, order })), [
    { decision_key: "decision_1", order: 1 },
    { decision_key: "decision_2", order: 2 },
  ]);
  assert.deepEqual(rendered.relationships, [{
    from_decision: "decision_1",
    from_label: "Lead subject",
    to_decision: "decision_2",
    to_label: "A private observatory",
    kind: "occupies",
  }]);
  assert.deepEqual(rendered.pins, ["decision_2"]);
  assert.deepEqual(rendered.claims, [{ label: "A legacy authored claim" }]);
  assert.equal("source_key" in rendered.facts[0], false);
  assert.doesNotMatch(JSON.stringify(rendered), /first-private-block|second-private-block/);
});

test("rich composed decisions preserve full authored text while compacting redundant provider labels",()=>{
  const source="A complete licensed creative source. ".repeat(140);
  const context=providerFacingRenderingContext({
    facts:[
      {block_id:"rich-parent",type:"reference",properties:{text:source,context_group:{name:source,target:source,role:"custom",application:"isolate"}}},
      {block_id:"focused-child",type:"message",properties:{label:"Focused workflow",text:"Focused workflow"}},
    ],
    relationships:[{from_block_id:"rich-parent",to_block_id:"focused-child",kind:"context_contains"}],
  },[
    {alias:"blk_001",sourceId:"rich-parent",sourceKind:"block"},
    {alias:"blk_002",sourceId:"focused-child",sourceKind:"block"},
  ]);

  assert.equal(context.facts[0].properties.text,source,"full evidence must remain available for exact grounding");
  assert.equal(context.facts[0].source_key,"blk_001");
  assert.equal("context_group" in context.facts[0].properties,false,
    "group semantics belong in the explicit Combined Context plan, not duplicated block metadata");
  assert.ok(Array.from(context.relationships[0].from_label).length<=160);
  assert.equal(context.relationships[0].to_label,"Focused workflow");
  assert.deepEqual([context.relationships[0].from_decision,context.relationships[0].to_decision],["decision_1","decision_2"]);
});
