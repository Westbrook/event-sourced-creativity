import assert from "node:assert/strict";
import test from "node:test";
import { providerFacingAssistantViews,requestAssistantProvider } from "../worker/assistant-provider.ts";

test("provider views use current page and recent actor-owned work without source transcripts or disabled audio", () => {
  const safe = providerFacingAssistantViews({
    surface: { page: "canvas", canonicalFamily: "/canvas/:canvas" },
    scope: { actorUserId: "SECRET-ACTOR", organizationId: "SECRET-ORG", projectAccessId: "SECRET-ACCESS", projectId: "SECRET-PROJECT", documentId: "SECRET-DOCUMENT" },
    playbook: ["inspect-selected-items", "explain-board"],
    documentTitle: "Visible campaign direction",
    selectedItems: [{ id: "SECRET-CANVAS-ITEM", kind: "document", title: "Chosen campaign", sourceId: "SECRET-SOURCE", documentId: "SECRET-DOCUMENT" }],
    recentActions: [{ id: "SECRET-EVENT", type: "BlockCreated", sequence: 88 }],
    recentTurns: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `Recent ${index}` })),
    decisionAtoms: [
      { id: "allowed-direction", type: "direction", text: "A warm inclusive product launch", intent: "include", locked: false, immutable: false, providerEligible: true },
      { id: "private-source", type: "reference", text: "SECRET LICENSED SOURCE TRANSCRIPT", intent: "include", locked: true, immutable: true, providerEligible: true },
      { id: "private-audio", type: "audio", text: "SECRET PRIVATE AUDIO RECORDING", intent: "include", locked: false, immutable: false, providerEligible: false },
    ],
    relationships: [{ id: "SECRET-EDGE", from: "allowed-direction", to: "private-source", kind: "context_contains" }],
    unfinishedIntents: [{ id: "SECRET-INTENT", kind: "audio", status: "pending", nextAction: "Review the existing audio", route: "/private" }],
    availableOutputKinds: ["image", "slides", "audio"],
    availableOutputs: [{ id: "SECRET-OUTPUT", kind: "audio", title: "Approved music", status: "ready", documentId: "SECRET-DOCUMENT" }],
  }, "What audio already exists?");

  assert.equal(safe.page, "canvas");
  assert.deepEqual(safe.page_playbook, ["inspect-selected-items", "explain-board"]);
  assert.equal(safe.available_formats.includes("audio"), true);
  assert.equal(safe.blocks.length, 1);
  assert.equal(safe.blocks[0].text, "A warm inclusive product launch");
  assert.equal(safe.relationships.length, 0);
  assert.equal(safe.recent_conversation.length, 6);
  assert.doesNotMatch(JSON.stringify(safe), /SECRET-|source transcript|PRIVATE AUDIO/iu);
});

test("approved immutable organizational decisions remain readable without exposing durable identifiers or source text",()=>{
  const context={
    surface:{page:"document",canonicalFamily:"/document/:document"},
    playbook:[],documentTitle:"Approved campaign",selectedItems:[],recentActions:[],recentTurns:[],
    decisionAtoms:[
      {id:"SECRET-EDITABLE-ID",type:"direction",text:"Use a calm tone",intent:"include",locked:false,immutable:false,providerEligible:true,providerVisibility:"editable"},
      {id:"SECRET-GOVERNED-ID",type:"brand",text:"Always use the approved cobalt identity",intent:"include",locked:true,immutable:true,providerEligible:true,providerVisibility:"governed"},
      {id:"SECRET-SOURCE-ID",type:"reference",text:"SECRET RAW CUSTOMER TRANSCRIPT",intent:"include",locked:true,immutable:true,providerEligible:true,providerVisibility:"restricted"},
    ],
    relationships:[{id:"SECRET-EDGE",from:"SECRET-EDITABLE-ID",to:"SECRET-GOVERNED-ID",kind:"context_contains"}],
    unfinishedIntents:[],availableOutputKinds:[],availableOutputs:[],totals:{decisions:3},truncated:false,
  };
  const safe=providerFacingAssistantViews(context,"Which approved brand direction applies?");
  assert.deepEqual(safe.blocks.map((item)=>item.id),["decision_1","decision_2"]);
  assert.equal(safe.blocks.find((item)=>item.type==="brand").read_only,true);
  assert.deepEqual(safe.relationships,[{from:"decision_1",to:"decision_2",kind:"context_contains"}]);
  assert.doesNotMatch(JSON.stringify(safe),/SECRET-|RAW CUSTOMER TRANSCRIPT/);
});

test("provider adapter aliases returned block actions and rejects input receipts beyond the approved token envelope",async()=>{
  const context={surface:{page:"document",canonicalFamily:"/document/:document"},playbook:[],documentTitle:"Approved campaign",
    selectedItems:[],recentActions:[],recentTurns:[],decisionAtoms:[{id:"SECRET-DURABLE-BLOCK",type:"direction",text:"Approved direction",intent:"include",locked:false,immutable:false,providerEligible:true}],
    relationships:[],unfinishedIntents:[],availableOutputKinds:[],availableOutputs:[],totals:{decisions:1},truncated:false};
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>{
      assert.doesNotMatch(init.body,/SECRET-DURABLE-BLOCK/);
      return Response.json({id:"safe-response",model:"gpt-5.6-luna",output_text:JSON.stringify({reply:"Approved",actions:[{kind:"context.edit",block_type:"direction",target_block_id:"decision_1",from_block_id:null,to_block_id:null,relation_kind:"",intent:"include",text:"Corrected approved direction"}]}),usage:{input_tokens:30,output_tokens:10,total_tokens:40}});
    };
    const safe=await requestAssistantProvider({OPENAI_API_KEY:"test"},"actor",{model:"gpt-5.6-luna",context,message:"Improve this",locale:"en",maximumInputTokens:100,maximumOutputTokens:100});
    assert.equal(safe.actions[0].target_block_id,"SECRET-DURABLE-BLOCK");

    globalThis.fetch=async()=>Response.json({id:"overrun",model:"gpt-5.6-luna",output_text:JSON.stringify({reply:"Approved",actions:[]}),usage:{input_tokens:5_000_000,output_tokens:2,total_tokens:5_000_002}});
    await assert.rejects(()=>requestAssistantProvider({OPENAI_API_KEY:"test"},"actor",{model:"gpt-5.6-luna",context,message:"Hi",locale:"en",maximumInputTokens:100,maximumOutputTokens:100}),/assistant_provider_usage_unverified/);
  }finally{globalThis.fetch=original;}
});
