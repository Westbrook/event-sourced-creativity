import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssistantActions, assistantActionEvents, ASSISTANT_SUPPORTED_BLOCK_TYPES } from "../src/model/assistant-proposals.ts";
import { BLOCK_TYPES } from "../src/model/block-types.ts";

const context = {
  scope: { projectId: "project-a", documentId: "document-a" },
  decisionAtoms: [
    { id: "direction-a", type: "direction", text: "Current direction", locked: false, immutable: false },
    { id: "verified-source", type: "message", text: "Protected source", locked: false, immutable: true },
    { id: "locked-a", type: "brand", text: "Locked identity", locked: true, immutable: false },
  ],
  relationships: [],
};

test("decomposes user intent into the smallest separately approvable typed decisions", () => {
  const actions = normalizeAssistantActions("Add audience: urban gardeners; Add palette: forest green; Add audio: warm analog score; Never include fire", context);
  assert.deepEqual(actions.map((action) => action.blockType), ["audience", "palette", "audio", "exclusion"]);
  assert.equal(actions[3].intent, "prohibit");
  assert.deepEqual(ASSISTANT_SUPPORTED_BLOCK_TYPES, BLOCK_TYPES.filter((definition)=>definition.type!=="reference"&&definition.type!=="model3d").map((definition)=>definition.type));
});

test("natural conversational conjunctions and separate sentences produce independently approvable decisions", () => {
  const conversational = normalizeAssistantActions("Add an audience of urban gardeners and a forest-green palette and warm analog audio", context);
  assert.deepEqual(conversational.map((action) => action.blockType), ["audience", "palette", "audio"]);
  assert.equal(conversational.every((action) => !/gardeners.+palette|palette.+audio/iu.test(action.text)), true);
  const sentences = normalizeAssistantActions("Add palette forest green. Add audience urban gardeners. Add audio warm score.", context);
  assert.deepEqual(sentences.map((action) => action.blockType), ["palette", "audience", "audio"]);
});

test("explicit block labels take precedence over ambiguous descriptive words for every authorable kind", () => {
  for (const kind of ASSISTANT_SUPPORTED_BLOCK_TYPES.filter((item) => item !== "reference")) {
    const [action] = normalizeAssistantActions(`Add ${kind}: clear direction for a music campaign without clutter`, context);
    assert.equal(action?.blockType, kind, kind);
  }
  const collisions = [
    ["Add format: portrait", "format"],
    ["Add scale: intimate portrait", "scale"],
    ["Add composition: use negative space without clutter", "composition"],
    ["Add accessibility: captions without flashing", "accessibility"],
    ["Add brand: logo with audio signature", "brand"],
    ["Add direction: launch a music campaign", "direction"],
  ];
  for (const [message, expected] of collisions) assert.equal(normalizeAssistantActions(message, context)[0]?.blockType, expected, message);
});

test("French, Arabic, and Japanese requests classify meaningful non-Latin context decisions", () => {
  for (const [message, expected] of [
    ["أضف إضاءة ذهبية دافئة", "lighting"],
    ["أضف رسالة واضحة للعلامة", "message"],
    ["أضف كاميرا بزاوية واسعة", "camera"],
    ["照明を追加してください", "lighting"],
    ["メッセージを追加してください", "message"],
    ["カメラを追加してください", "camera"],
    ["Ajouter un éclairage chaleureux", "lighting"],
    ["Ajouter une émotion calme", "emotion"],
  ]) assert.equal(normalizeAssistantActions(message, context)[0]?.blockType, expected, message);
});

test("questions never mutate and references cannot be fabricated from a text prompt", () => {
  assert.deepEqual(normalizeAssistantActions("What is the current direction?", context), []);
  assert.deepEqual(normalizeAssistantActions("Add reference: uploaded source image", context), []);
  assert.deepEqual(normalizeAssistantActions("Add model3d: a ceramic vase", context), []);
  for (const blockType of ["reference", "model3d"]) {
    assert.deepEqual(assistantActionEvents({ kind: "context.create", blockType, text: "A ceramic vase", intent: "include" }, context,
      { blockId: "unverified-source", relationId: "relation", turnId: "turn" }), []);
  }
  assert.deepEqual(normalizeAssistantActions("Add a warm color", { ...context, scope: { projectId: "project-a", documentId: null } }), []);
});

test("verified sources and locked decisions cannot be edited or removed", () => {
  assert.deepEqual(normalizeAssistantActions("Change message verified-source", context), []);
  assert.deepEqual(normalizeAssistantActions("Remove brand locked-a", context), []);
  assert.deepEqual(assistantActionEvents({ kind: "context.edit", targetBlockId: "verified-source", text: "forged" }, context, { blockId: "new", relationId: "relation", turnId: "turn" }), []);
  assert.deepEqual(assistantActionEvents({ kind: "context.remove", targetBlockId: "locked-a" }, context, { blockId: "new", relationId: "relation", turnId: "turn" }), []);
});

test("approved audio creation never enables listening, output inclusion, or provider transfer", () => {
  const [action] = normalizeAssistantActions("Add audio: warm analog soundtrack", context);
  const [event] = assistantActionEvents(action, context, { blockId: "audio-created", relationId: "relation", turnId: "turn-a" });
  assert.equal(event.type, "BlockCreated");
  assert.equal(event.payload.type, "audio");
  assert.equal(event.payload.properties.inform_generation, false);
  assert.equal(event.payload.properties.include_in_output, false);
  assert.equal(event.payload.properties.allow_provider_audio_transfer, false);
});

test("an assistant cannot invert an exclusion into an inclusion",()=>{
  const identifiers={blockId:"protected",relationId:"relation",turnId:"turn"};
  assert.deepEqual(assistantActionEvents({kind:"context.create",blockType:"exclusion",text:"Never disclose customer information",intent:"include"},context,identifiers),[]);
  for(const intent of ["avoid","prohibit"]){
    const [accepted]=assistantActionEvents({kind:"context.create",blockType:"exclusion",text:"Never disclose customer information",intent},context,identifiers);
    assert.equal(accepted.payload.properties.intent,intent);
  }
});

test("unlocked exact wording and prohibitions remain read-only to assistant proposals and forged actions",()=>{
  const guarded={...context,decisionAtoms:[
    {id:"exact-message",type:"message",text:"Revenue  growth\nwithout alteration",locked:false,immutable:false,protected:true},
    {id:"hard-boundary",type:"exclusion",text:"Never disclose contractual pricing",locked:false,immutable:false,protected:true,intent:"prohibit"},
  ]};
  const identifiers={blockId:"new",relationId:"relation",turnId:"turn"};
  assert.deepEqual(normalizeAssistantActions("Change the message to a weaker promise",guarded),[]);
  assert.deepEqual(normalizeAssistantActions("Remove exclusion",guarded),[]);
  assert.deepEqual(assistantActionEvents({kind:"context.edit",targetBlockId:"exact-message",text:"Compromised wording"},guarded,identifiers),[]);
  assert.deepEqual(assistantActionEvents({kind:"context.remove",targetBlockId:"hard-boundary"},guarded,identifiers),[]);
  assert.deepEqual(assistantActionEvents({kind:"context.relation.add",fromBlockId:"exact-message",toBlockId:"hard-boundary",relationKind:"context_contains"},guarded,identifiers),[]);
});

test("relationships use exact editable endpoints and remove only an existing server-owned edge", () => {
  const editable = { ...context, decisionAtoms: [...context.decisionAtoms, { id: "palette-a", type: "palette", text: "Ocean cobalt", locked: false, immutable: false }] };
  const [added] = normalizeAssistantActions("Connect direction-a to palette-a", editable);
  assert.equal(added.kind, "context.relation.add");
  const [addition] = assistantActionEvents(added, editable, { blockId: "new", relationId: "server-edge", turnId: "turn" });
  assert.equal(addition.payload.relation_id, "server-edge");
  const connected = { ...editable, relationships: [{ id: "existing-edge", from: "direction-a", to: "palette-a", kind: "context_contains" }] };
  const [removed] = normalizeAssistantActions("Disconnect direction-a from palette-a", connected);
  const [removal] = assistantActionEvents(removed, connected, { blockId: "new", relationId: "fabricated-edge", turnId: "turn" });
  assert.equal(removal.payload.relation_id, "existing-edge");
  assert.deepEqual(normalizeAssistantActions("Connect direction-a to locked-a", editable), []);
});

test("relationship proposals reject unsupported edge kinds and cycles in the known context graph", () => {
  const graph = {
    ...context,
    decisionAtoms: [
      { id: "a", type: "direction", text: "First decision", locked: false, immutable: false },
      { id: "b", type: "palette", text: "Second decision", locked: false, immutable: false },
      { id: "c", type: "emotion", text: "Third decision", locked: false, immutable: false },
    ],
    relationships: [{ id: "ab", from: "a", to: "b", kind: "context_contains" }, { id: "bc", from: "b", to: "c", kind: "context_contains" }],
  };
  assert.deepEqual(assistantActionEvents({ kind: "context.relation.add", fromBlockId: "c", toBlockId: "a", relationKind: "context_contains" }, graph,
    { blockId: "block", relationId: "ca", turnId: "turn" }), []);
  assert.deepEqual(assistantActionEvents({ kind: "context.relation.add", fromBlockId: "a", toBlockId: "c", relationKind: "invented_unrestricted_edge" }, graph,
    { blockId: "block", relationId: "ac", turnId: "turn" }), []);
});
