import assert from "node:assert/strict";
import test from "node:test";
import { boundAssistantContext, compileAssistantContext, ASSISTANT_CONTEXT_LIMITS, ASSISTANT_OUTPUT_KINDS } from "../src/model/conversation-context.ts";
import { foldEvents } from "../src/model/events.ts";
import { deriveIntentTrajectories } from "../src/model/intent-trajectories.ts";
import { DOCUMENT_ARTIFACT_KINDS } from "../src/model/document-artifacts.ts";

function event(sequence, type, payload = {}, actor = "user") {
  return { eventId: `event-${sequence}`, streamId: "creative:owner", sequence, occurredAt: "2026-01-01T00:00:00.000Z", recordedAt: "2026-01-01T00:00:00.000Z", actor, clientId: "test", correlationId: `correlation-${sequence}`, causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload };
}

function fixture() {
  const events = [
    event(1, "ProjectCreated", { project_id: "project-a", name: "Launch project" }),
    event(2, "DocumentCreated", { project_id: "project-a", document_id: "document-a", title: "Launch direction" }),
    event(3, "BlockCreated", { project_id: "project-a", document_id: "document-a", block_id: "direction-a", type: "direction", handle: "Direction", position: "a0", properties: { text: "Launch a greenhouse" } }),
    event(4, "BlockCreated", { project_id: "project-a", document_id: "document-a", block_id: "audio-a", type: "audio", handle: "Soundtrack", position: "a1", properties: { text: "Warm analog soundtrack", media_url: "https://private.example/secret.wav", allow_provider_audio_transfer: true } }),
    event(5, "BlockCreated", { project_id: "project-a", document_id: "document-a", block_id: "boundary-a", type: "exclusion", handle: "Never use flames", position: "a2", properties: { text: "No fire", intent: "prohibit" } }),
  ];
  return { events, projection: foldEvents(events, Number.POSITIVE_INFINITY, "document-a") };
}

test("prioritizes exact current document, hard boundaries, and atomic audio without leaking media", () => {
  const { events, projection } = fixture();
  const context = compileAssistantContext({ route: "/document/document-a/launch", events, projection, actorUserId: "owner" });
  assert.equal(context.scope.documentId, "document-a");
  assert.equal(context.documentTitle, "Launch direction");
  assert.equal(context.decisionAtoms[0].id, "boundary-a");
  assert.ok(context.decisionAtoms.some((item) => item.type === "audio"));
  assert.ok(context.availableOutputKinds.includes("audio"));
  assert.equal(JSON.stringify(context).includes("secret.wav"), false);
  assert.equal(JSON.stringify(context).includes("allow_provider_audio_transfer"), false);
});

test("unlocked exact authored wording remains verbatim, protected, and prioritized above ordinary context",()=>{
  const {events}=fixture();
  const exact="Revenue  growth\nrequires  exact spacing";
  events.push(event(6,"BlockCreated",{project_id:"project-a",document_id:"document-a",block_id:"mandatory-message",type:"message",handle:"Mandatory exact message",position:"z9",properties:{text:`Keep precisely:\n${exact}`,exact_text:exact,exact_placements:["opening","closing"],protected_phrases:[{text:exact,placement:"opening_and_closing"}]}}));
  for(let index=0;index<24;index+=1)events.push(event(7+index,"BlockCreated",{project_id:"project-a",document_id:"document-a",block_id:`ordinary-${index}`,type:"direction",handle:`Ordinary ${index}`,position:`a${index}`,properties:{text:`Ordinary replaceable decision ${index}`}}));
  const context=compileAssistantContext({route:"/document/document-a",events,projection:foldEvents(events,Number.POSITIVE_INFINITY,"document-a"),actorUserId:"owner"});
  const required=context.decisionAtoms.find((item)=>item.id==="mandatory-message");
  assert.ok(required,"mandatory first-party exact wording cannot disappear behind ordinary decisions");
  assert.equal(required.protected,true);
  assert.equal(required.text,`Keep precisely:\n${exact}`);
  assert.equal(context.totals.protectedDecisions,2);
});

test("missing and revoked authoritative source-rights receipts always block paid specialist eligibility",()=>{
  for(const classification of [null,"revoked"]){
    const {events}=fixture();
    events.push(event(6,"BlockCreated",{project_id:"project-a",document_id:"document-a",block_id:"licensed-reference",type:"reference",handle:"Licensed reference",position:"a6",properties:{text:"Private source remains withheld",reference_id:"strict-reference",rights_class:"owned_or_licensed"}}));
    if(classification)events.push(event(7,"RightsAsserted",{project_id:"project-a",document_id:"document-a",reference_id:"strict-reference",rights_class:classification}));
    const context=compileAssistantContext({route:"/document/document-a",events,projection:foldEvents(events,Number.POSITIVE_INFINITY,"document-a"),actorUserId:"owner"});
    assert.equal(context.totals.unsafeRightsDecisions,1,String(classification));
    assert.equal(context.decisionAtoms.find((item)=>item.id==="licensed-reference")?.providerEligible,false,String(classification));
  }
});

test("multilingual protected context always fits its byte budget and outranks hydrated conversation history",()=>{
  for(const count of [8,12,16]){
    const events=[event(1,"ProjectCreated",{project_id:"project-a",name:"Launch project"}),event(2,"DocumentCreated",{project_id:"project-a",document_id:"document-a",title:"Launch direction"})];
    for(let index=0;index<count;index+=1)events.push(event(index+3,"BlockCreated",{project_id:"project-a",document_id:"document-a",block_id:`required-${index}`,type:"exclusion",handle:`Required ${index}`,position:`a${index}`,properties:{text:"必".repeat(320),intent:"prohibit"}}));
    const context=compileAssistantContext({route:"/document/document-a",events,projection:foldEvents(events,Number.POSITIVE_INFINITY,"document-a"),actorUserId:"owner"});
    assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength<=ASSISTANT_CONTEXT_LIMITS.maxBytes,count);
    context.recentTurns=Array.from({length:6},(_,index)=>({id:`history-${index}`,role:index%2?"assistant":"user",text:"語".repeat(index%2?2400:1200),sequence:index}));
    boundAssistantContext(context);
    assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength<=ASSISTANT_CONTEXT_LIMITS.maxBytes,count);
    assert.equal(context.totals.protectedDecisions,count);
    if(count<=12){assert.equal(context.decisionAtoms.length,count,"protected context survives before any optional private history");assert.equal(context.totals.truncatedProtectedDecisions,0);}
    else assert.ok(context.decisionAtoms.length<count,"impossible protected coverage remains honestly incomplete and blocks paid specialist dispatch");
  }
});

test("protected text beyond the complete specialist boundary is disclosed and never treated as safe",()=>{
  const {events}=fixture();
  events.push(event(6,"BlockCreated",{project_id:"project-a",document_id:"document-a",block_id:"long-protected",type:"message",handle:"Exact contractual text",position:"a9",properties:{text:`${"a".repeat(350)} FORBIDDEN AFTER THE LIMIT`,exact_text:"FORBIDDEN AFTER THE LIMIT"}}));
  const context=compileAssistantContext({route:"/document/document-a",events,projection:foldEvents(events,Number.POSITIVE_INFINITY,"document-a"),actorUserId:"owner"});
  assert.equal(context.totals.truncatedProtectedDecisions,1);
  assert.equal(context.decisionAtoms.find((item)=>item.id==="long-protected")?.text.length,ASSISTANT_CONTEXT_LIMITS.decisionChars);
});

test("retired protected boundaries never displace an active exact creative promise",()=>{
  const events=[event(1,"ProjectCreated",{project_id:"project-a",name:"Launch project"}),event(2,"DocumentCreated",{project_id:"project-a",document_id:"document-a",title:"Launch direction"})];
  for(let index=0;index<17;index+=1)events.push(event(index+3,"BlockCreated",{project_id:"project-a",document_id:"document-a",block_id:`retired-${index}`,type:"exclusion",handle:`Historical boundary ${index}`,position:`a${index}`,properties:{text:`Retired boundary ${index}`,intent:"prohibit",weight:0}}));
  events.push(event(21,"BlockCreated",{project_id:"project-a",document_id:"document-a",block_id:"active-promise",type:"message",handle:"Live protected promise",position:"z9",properties:{text:"Revenue  growth",exact_text:"Revenue  growth",weight:.8}}));
  const context=compileAssistantContext({route:"/document/document-a",events,projection:foldEvents(events,Number.POSITIVE_INFINITY,"document-a"),actorUserId:"owner"});
  assert.equal(context.totals.protectedDecisions,1);
  assert.equal(context.decisionAtoms[0].id,"active-promise");
  assert.equal(context.decisionAtoms[0].text,"Revenue  growth");
  assert.equal(context.decisionAtoms[0].providerEligible,true);
  assert.equal(context.decisionAtoms.filter((decision)=>decision.providerEligible&&decision.protected).length,1);
});

test("never uses a stale selected document on a projects or activity page", () => {
  const { events, projection } = fixture();
  for (const route of ["/projects", "/activity", "/deliver"]) {
    const context = compileAssistantContext({ route, events, projection, actorUserId: "owner" });
    assert.equal(context.scope.documentId, null, route);
    assert.equal(context.documentTitle, null, route);
    assert.deepEqual(context.decisionAtoms, [], route);
  }
});

test("bounds long histories and includes only current actor private chat references", () => {
  const { events, projection } = fixture();
  const actorContent = {};
  for (let index = 0; index < 100; index += 1) {
    const ownerRef = `owner-${index}`;
    const strangerRef = `stranger-${index}`;
    actorContent[ownerRef] = `OWN-${index}`;
    actorContent[strangerRef] = `FOREIGN-${index}`;
    events.push(event(10 + index * 2, "ChatMessageSent", { project_id: "project-a", document_id: "document-a", content_ref: ownerRef }, "user:owner"));
    events.push(event(11 + index * 2, "ChatMessageSent", { project_id: "project-a", document_id: "document-a", content_ref: strangerRef }, "user:another"));
  }
  const context = compileAssistantContext({ route: "/document/document-a", events, projection, actorUserId: "owner", actorContent });
  assert.equal(context.recentTurns.length, ASSISTANT_CONTEXT_LIMITS.turns);
  assert.equal(context.recentTurns.at(-1).text, "OWN-99");
  assert.equal(JSON.stringify(context).includes("FOREIGN-"), false);
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength <= ASSISTANT_CONTEXT_LIMITS.maxBytes);
});

test("only includes explicit authorized selection from the current canvas", () => {
  const { events, projection } = fixture();
  const canvasProjection = { projectId: "project-a", selectedCanvasId: "canvas-a", canvases: [], items: [
    { id: "selected", canvasId: "canvas-a", projectId: "project-a", sourceKind: "document", sourceId: "document-a", title: "Actual selection", visible: true, removed: false },
    { id: "foreign", canvasId: "canvas-b", projectId: "project-a", sourceKind: "document", sourceId: "document-b", title: "Foreign board", visible: true, removed: false },
  ], arrangements: [], contextSets: [], proposals: [], memberships: [] };
  const context = compileAssistantContext({ route: "/canvas/canvas-a/launch", events, projection, actorUserId: "owner", canvasProjection, selectedItemIds: ["selected", "foreign"] });
  assert.deepEqual(context.selectedItems.map((item) => item.title), ["Actual selection"]);
  assert.equal(context.scope.documentId, null);
});

test("caps attacker-controlled routes and always enforces the serialized context ceiling", () => {
  const { events, projection } = fixture();
  const context = compileAssistantContext({ route: `/document/document-a?search=${"x".repeat(40_000)}#context=${"y".repeat(20_000)}`, events, projection, actorUserId: "owner" });
  assert.ok(context.surface.route.length <= 768);
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength <= ASSISTANT_CONTEXT_LIMITS.maxBytes);
  assert.equal(context.surface.focusedBlockId, null);
  assert.ok(context.decisionAtoms.some((atom) => atom.type === "exclusion"));
});

test("counts authorized images alongside all existing document-output formats", () => {
  const { events, projection } = fixture();
  const image = { id: "image-a", documentId: "document-a", variant: 1, sequence: 9, discarded: false };
  projection.outputs.push(image);
  projection.libraryOutputs.push(image);
  const document = compileAssistantContext({ route: "/document/document-a", events, projection, actorUserId: "owner" });
  const delivery = compileAssistantContext({ route: "/deliver", events, projection, actorUserId: "owner" });
  assert.equal(document.availableOutputs.find((output) => output.kind === "image")?.id, "image-a");
  assert.equal(delivery.availableOutputs.find((output) => output.kind === "image")?.id, "image-a");
});

test("3D assets are scoped assistant context and outputs without exposing model or saved-view transport", () => {
  const { events } = fixture();
  events.push(event(6, "BlockCreated", {
    project_id: "project-a", document_id: "document-a", block_id: "model-a", type: "model3d",
    handle: "Ceramic vessel", position: "a3", properties: {
      text: "Use the vessel silhouette and handle proportions", rights_class: "owned",
      model_url: "/api/media/private-model.glb", model_sha256: "private-model-hash",
      reference_image_url: "/api/media/private-view.png", model3d_view: { position: [1, 2, 3] },
    },
  }));
  events.push(event(7, "DocumentRenderCompleted", {
    project_id: "project-a", document_id: "document-a", artifact_id: "model-output", artifact_kind: "model3d",
    title: "Generated vessel", media_url: "/api/media/private-output.glb", provider: "fal", model_id: "rodin",
  }, "worker:renderer"));
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, "document-a");
  const context = compileAssistantContext({ route: "/document/document-a", events, projection, actorUserId: "owner" });
  const atom = context.decisionAtoms.find(item => item.id === "model-a");
  assert.equal(atom?.type, "model3d");
  assert.equal(atom?.text, "Use the vessel silhouette and handle proportions");
  assert.equal(atom?.providerVisibility, "restricted", "text-only specialists cannot edit source model evidence");
  assert.equal(context.availableOutputs.find(output => output.id === "model-output")?.kind, "model3d");
  assert.equal(context.totals.outputsByKind.model3d, 1);
  assert.deepEqual(context.availableOutputKinds, ["image", ...DOCUMENT_ARTIFACT_KINDS]);
  assert.doesNotMatch(JSON.stringify(context), /private-model|private-view|private-output|model3d_view/);

  const delivery = compileAssistantContext({ route: "/deliver", events, projection, actorUserId: "owner" });
  assert.equal(delivery.totals.outputsByKind.model3d, 1);
  assert.deepEqual(delivery.decisionAtoms, []);
});

test("never exposes output titles whose source document is absent or belongs to another project", () => {
  const { events, projection } = fixture();
  projection.libraryArtifacts.push({ id: "foreign-artifact", documentId: "foreign-document", kind: "slides", title: "CONFIDENTIAL OTHER PROJECT TITLE", sequence: 99 });
  projection.libraryOutputs.push({ id: "foreign-image", documentId: "foreign-document", variant: 1, sequence: 100, discarded: false });
  const context = compileAssistantContext({ route: "/deliver", events, projection, actorUserId: "owner" });
  assert.equal(context.availableOutputs.length, 0);
  assert.doesNotMatch(JSON.stringify(context), /CONFIDENTIAL|foreign-image|foreign-artifact/u);
});

test("audio is an existing output kind with pending and ready event-derived guidance", () => {
  const scope = { project_id: "project-a", document_id: "document-a" };
  const requested = [event(1, "ProjectCreated", scope), event(2, "DocumentCreated", scope), event(3, "DocumentRenderRequested", { ...scope, artifact_id: "audio-a", artifact_kind: "audio" })];
  const pending = deriveIntentTrajectories(requested)[0];
  assert.equal(pending.expectedOutputKind, "audio");
  assert.match(pending.nextAction.label, /audio/i);
  const ready = deriveIntentTrajectories([...requested, event(4, "DocumentRenderCompleted", { ...scope, artifact_id: "audio-a", artifact_kind: "audio" }, "worker:renderer")])[0];
  assert.equal(ready.expectedOutputKind, "audio");
  assert.deepEqual(ASSISTANT_OUTPUT_KINDS, ["image", ...DOCUMENT_ARTIFACT_KINDS]);
});
