import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { BLOCK_TYPES } from "../src/model/block-types.ts";
import { buildAdaptivePlanningRequest, decodeAdaptivePlanningResponse, MAX_ADAPTIVE_PLANNING_RESPONSE_BYTES, structureAdaptiveContext } from "../worker/openai-adapter.ts";

const suggestion=(type="subject")=>({type,subtype:"Custom authored subtype",label:"Mara",instruction:" Preserve “Mara” exactly. ",reason:"Keep the authored subject.",relationship_to:"the harbor"});
const validPlan=()=>({interpretation:" Préserver le contexte. ",active_decision:{type:"subject",label:"Mara",prompt:"Who arrives?",why:"Retain the same subject."},suggested_blocks:[suggestion(),suggestion("lighting")],hidden_until_later:[" Later. "]});
function sourceFixture(){
  const active=Array.from({length:61},(_,index)=>({id:`authored-${index}`,type:index===0?"direction":"subject",locked:true,properties:{label:`Decision ${index}`,text:`Protected row ${index}: ${"完整の引用 — exact 61.125; display 61.13.\n".repeat(20)}`,intent:"prohibit",required:true,weight:1}}));
  Object.assign(active[0].properties,{context_group:{name:"Opening sequence",role:"sequence",target:"Mara enters",application:"ordered",relativity:.9},content_ref:"PRIVATE_CONTENT",private_content:"PRIVATE_SECRET",nested:{api_key:"PRIVATE_KEY",source_content_hash:"PRIVATE_HASH"}});
  active.push({id:"authored-audio",type:"audio",locked:true,properties:{label:"Original sound",text:"An original warm piano texture.",intent:"include",required:true,weight:1}});
  const excluded=[{id:"muted",type:"subject",active:false,properties:{text:"EXCLUDED_MUTED"}},{id:"removed",type:"subject",removed:true,properties:{text:"EXCLUDED_REMOVED"}},{id:"property-muted",type:"subject",properties:{active:false,text:"EXCLUDED_PROPERTY_MUTED"}},{id:"weightless",type:"subject",properties:{weight:0,text:"EXCLUDED_WEIGHTLESS"}},{id:"private-audio",type:"audio",locked:true,properties:{text:"EXCLUDED_PRIVATE_AUDIO",required:true,inform_generation:false,transcript:"EXCLUDED_TRANSCRIPT"}},{id:"unapproved-audio",type:"audio",properties:{text:"EXCLUDED_AUDIO_MEDIA",media_url:"EXCLUDED_MEDIA_URL"}}];
  return{active,input:{intent:" Preserve every protected row. ",documentTitle:" Étude de Mara ",locale:"fr-ca",blocks:[...active,...excluded],relationships:[{relation_id:"PRIVATE_RELATION_2",from_block_id:"authored-0",to_block_id:"authored-2",kind:"context_contains",properties:{member_order:0}},{relation_id:"PRIVATE_RELATION_1",from_block_id:"authored-0",to_block_id:"authored-1",kind:"context_contains",properties:{member_order:1}},{relation_id:"PRIVATE_RELATION_MUTED",from_block_id:"authored-0",to_block_id:"muted",kind:"context_contains",properties:{member_order:2}}]}};
}
test("free adaptive builder retains all active protected source and compiles exact context boundaries",async(t)=>{
  const network=t.mock.method(globalThis,"fetch",async()=>assert.fail("A free builder must not fetch")),{input,active}=sourceFixture(),original=structuredClone(input);
  const request=await buildAdaptivePlanningRequest("fixture-actor",input,"gpt-fixture"),provider=JSON.parse(request.input);
  assert.equal(network.mock.callCount(),0);assert.deepEqual(input,original);assert.equal(provider.intent,input.intent);assert.equal(provider.documentTitle,input.documentTitle);assert.equal(provider.blocks.length,active.length);
  for(const[index,block]of provider.blocks.entries()){assert.equal(block.id,active[index].id);assert.equal(block.properties.text,active[index].properties.text);assert.equal(block.locked,true);assert.equal(block.properties.required,true);assert.equal(block.properties.intent,active[index].properties.intent);}
  assert.match(provider.blocks[60].properties.text,/Protected row 60/);assert.equal(provider.blocks.at(-1).id,"authored-audio");assert.equal(Object.hasOwn(provider,"relationships"),false);assert.doesNotMatch(request.input,/PRIVATE_CONTENT|PRIVATE_SECRET|PRIVATE_KEY|PRIVATE_HASH|PRIVATE_RELATION|EXCLUDED_/);
  assert.equal(provider.combined_context_plan.length,1);const group=provider.combined_context_plan[0];
  assert.equal(group.context_key,"context_group_1");assert.equal(group.name,"Opening sequence");assert.equal(group.target,"Mara enters");assert.equal(group.role,"sequence");assert.equal(group.application,"ordered");assert.equal(group.relativity,.9);assert.deepEqual(group.members.map((member)=>member.label),["Decision 0","Decision 2","Decision 1"]);assert.deepEqual(group.members.map((member)=>member.order),[0,1,2]);assert.match(group.instruction,/binding chronology/);assert.match(group.instruction,/Preserve the listed member order/);assert.doesNotMatch(JSON.stringify(group),/authored-\d|PRIVATE_RELATION|muted/);
  assert.deepEqual(provider.block_vocabulary,BLOCK_TYPES.map(({type,description,subtypes})=>({type,description,subtypes})));
  assert.match(request.instructions,/selected language \(fr-CA\)/);assert.match(request.instructions,/Preserve user-authored titles, quoted text, names, and creative decisions verbatim/);assert.match(request.instructions,/never translate machine identifiers, block type values, or structured field names/);assert.match(request.instructions,/Do not claim proposals were authored and do not mutate anything/);assert.match(request.instructions,/Work only from active, authorized creative decisions/);
  assert.equal(request.model,"gpt-fixture");assert.equal(request.max_output_tokens,1400);assert.equal(request.store,false);assert.deepEqual(request.reasoning,{effort:"low"});assert.equal(request.text.verbosity,"low");assert.equal(request.text.format.name,"forma_adaptive_structure");assert.equal(request.text.format.strict,true);
  const schema=request.text.format.schema;assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,["interpretation","active_decision","suggested_blocks","hidden_until_later"]);assert.deepEqual(schema.properties.active_decision.properties.type.enum,BLOCK_TYPES.map(({type})=>type));assert.deepEqual(schema.properties.suggested_blocks.items.properties.type.enum,BLOCK_TYPES.map(({type})=>type));assert.equal(schema.properties.suggested_blocks.minItems,2);assert.equal(schema.properties.suggested_blocks.maxItems,6);assert.equal(schema.properties.hidden_until_later.maxItems,5);
  assert.equal(request.safety_identifier,`forma_${createHash("sha256").update("fixture-actor").digest("hex").slice(0,32)}`);assert.deepEqual(await buildAdaptivePlanningRequest("fixture-actor",input,"gpt-fixture"),request);
});
test("free adaptive builder preserves typed reference and participant roles without durable relation IDs",async()=>{
  const input={intent:"Preserve the precise relationship roles.",documentTitle:"Harbor",blocks:[
    {id:"authored-style",type:"style",handle:"Same label",properties:{text:"Grain and restrained contrast."}},
    {id:"authored-subject",type:"subject",handle:"Same label",properties:{text:"Mara at the harbor."}},
    {id:"authored-action",type:"action",handle:"Arrival",properties:{text:"Mara steps onto the pier."}},
    {id:"authored-reference",type:"reference",handle:"Harbor plate",properties:{text:"Licensed appearance study."}},
    {id:"excluded-reference",type:"reference",properties:{active:false,text:"EXCLUDED_REFERENCE"}},
  ],relationships:[
    {id:"PRIVATE_RELATION_STYLE",from_block_id:"authored-style",to_block_id:"authored-reference",kind:"style_reference",properties:{purpose:"treatment only",content_ref:"PRIVATE_CONTENT"}},
    {id:"PRIVATE_RELATION_SUBJECT",from_block_id:"authored-subject",to_block_id:"authored-reference",kind:"subject_reference",properties:{purpose:"appearance only"}},
    {id:"PRIVATE_RELATION_ACTION",from_block_id:"authored-action",to_block_id:"authored-subject",kind:"action_participant",properties:{participant_role:"performer",member_order:0}},
    {id:"PRIVATE_RELATION_INACTIVE",from_block_id:"authored-style",to_block_id:"excluded-reference",kind:"style_reference"},
    {id:"PRIVATE_RELATION_REMOVED",from_block_id:"authored-subject",to_block_id:"authored-style",kind:"style_reference",removed:true},
  ]};
  const request=await buildAdaptivePlanningRequest("fixture-actor",input,"gpt-fixture"),provider=JSON.parse(request.input);
  assert.equal(provider.relationship_plan.length,3);assert.deepEqual(provider.blocks.map((block)=>block.decision_key),["decision_1","decision_2","decision_3","decision_4"]);
  assert.deepEqual(provider.relationship_plan.map(({from_decision,to_decision,kind})=>({from_decision,to_decision,kind})),[
    {from_decision:"decision_1",to_decision:"decision_4",kind:"style_reference"},
    {from_decision:"decision_2",to_decision:"decision_4",kind:"subject_reference"},
    {from_decision:"decision_3",to_decision:"decision_2",kind:"action_participant"},
  ]);
  assert.equal(provider.relationship_plan[0].properties.purpose,"treatment only");assert.equal(provider.relationship_plan[1].properties.purpose,"appearance only");
  assert.deepEqual(provider.relationship_plan[2].properties,{participant_role:"performer",member_order:0});
  assert.equal(Object.hasOwn(provider,"relationships"),false);assert.doesNotMatch(JSON.stringify(provider.relationship_plan),/authored-|PRIVATE_|EXCLUDED_/u);
  assert.doesNotMatch(request.input,/PRIVATE_|EXCLUDED_/u);assert.match(request.instructions,/Treat relationship_plan as binding/u);
  const unrelated=await buildAdaptivePlanningRequest("fixture-actor",{...input,relationships:[]},"gpt-fixture");assert.notEqual(unrelated.input,request.input);
});
test("free adaptive builder canonicalizes supported response locales and retains explicit model selection",async(t)=>{
  const network=t.mock.method(globalThis,"fetch",async()=>assert.fail("Locale selection must not fetch"));
  for(const[locale,expected]of[[undefined,"en"],["fr-ca","fr-CA"],["ja-jp","ja-JP"],["ar-eg","ar-EG"],["EN-us","en-US"],["de-DE","en"],["bad_locale!","en"]]){const request=await buildAdaptivePlanningRequest("locale-actor",{intent:"Keep “原文”.",documentTitle:"原文",blocks:[],...(locale===undefined?{}:{locale})},"explicit-fixture-model");assert.ok(request.instructions.includes(`selected language (${expected})`));assert.equal(request.model,"explicit-fixture-model");assert.equal(JSON.parse(request.input).documentTitle,"原文");}
  assert.equal(network.mock.callCount(),0);
});
test("legacy adaptive dispatch sends the identical builder payload and awaits its guard before fetching",async(t)=>{
  const requests=[],order=[];t.mock.method(globalThis,"fetch",async(url,init)=>{order.push("fetch");requests.push({url,init});return Response.json({id:`fixture-response-${requests.length}`,model:JSON.parse(init.body).model,output_text:JSON.stringify(validPlan()),usage:{input_tokens:100,output_tokens:40,total_tokens:140}});});
  const base={intent:"Retain Mara.",documentTitle:"Harbor",blocks:[],locale:"ja-JP"};
  for(const controlled of[false,true]){
    order.length=0;const signal=new AbortController().signal;
    // Match the original transport object, including its historical empty signal serialization.
    const input=controlled?{...base,signal,onBeforeProviderRequest:async()=>{await Promise.resolve();order.push("guard");}}:base;
    const env={OPENAI_API_KEY:"fixture-only",...(controlled?{OPENAI_MODEL:"explicit-fixture-model"}:{})},approved=await buildAdaptivePlanningRequest("fixture-actor",input,env.OPENAI_MODEL??"gpt-5.6-terra"),before=requests.length;
    const result=await structureAdaptiveContext(env,"fixture-actor",input);assert.equal(requests.length,before+1);const request=requests.at(-1);assert.equal(request.url,"https://api.openai.com/v1/responses");assert.equal(request.init.method,"POST");assert.equal(request.init.body,JSON.stringify(approved));assert.equal(request.init.signal,controlled?signal:undefined);assert.deepEqual(order,controlled?["guard","fetch"]:["fetch"]);assert.deepEqual(result.output,validPlan());assert.deepEqual(result.usage,{inputTokens:100,outputTokens:40,totalTokens:140});
  }
  const before=requests.length;await assert.rejects(structureAdaptiveContext({OPENAI_API_KEY:"fixture-only"},"fixture-actor",{...base,onBeforeProviderRequest:async()=>{await Promise.resolve();throw new Error("source_no_longer_current");}}),/source_no_longer_current/);assert.equal(requests.length,before,"A rejected predispatch guard cannot submit");
});
test("strict adaptive decoder preserves every valid 2–6 suggestion result and supported block type verbatim",()=>{
  for(let count=2;count<=6;count++){const value={...validPlan(),suggested_blocks:Array.from({length:count},()=>suggestion()),hidden_until_later:Array(count-1).fill(" Later. ")};assert.deepEqual(decodeAdaptivePlanningResponse(JSON.stringify(value)),value);}
  for(const{type}of BLOCK_TYPES){const value=validPlan();value.active_decision.type=type;value.suggested_blocks[0].type=type;assert.deepEqual(decodeAdaptivePlanningResponse(JSON.stringify(value)),value);}
  const emptyStrings={interpretation:"",active_decision:{type:"subject",label:"",prompt:"",why:""},suggested_blocks:Array.from({length:2},()=>({type:"subject",subtype:"",label:"",instruction:"",reason:"",relationship_to:""})),hidden_until_later:[]};assert.deepEqual(decodeAdaptivePlanningResponse(JSON.stringify(emptyStrings)),emptyStrings,"Existing schema permits empty strings; no invented validator semantics");
});
const malformed=[
  ["null root",()=>null],["array root",()=>[]],["missing required root fields",()=>({})],
  ["extra root field",value=>({...value,extra:true})],["numeric interpretation",value=>({...value,interpretation:5})],
  ["null active decision",value=>({...value,active_decision:null})],["unknown active type",value=>({...value,active_decision:{...value.active_decision,type:"unknown"}})],["null active copy",value=>({...value,active_decision:{...value.active_decision,why:null}})],["extra active field",value=>({...value,active_decision:{...value.active_decision,extra:true}})],
  ["zero suggestions",value=>({...value,suggested_blocks:[]})],["one suggestion",value=>({...value,suggested_blocks:[suggestion()]})],["seven suggestions",value=>({...value,suggested_blocks:Array.from({length:7},()=>suggestion())})],["non-array suggestions",value=>({...value,suggested_blocks:{length:2}})],
  ["unknown suggestion type",value=>({...value,suggested_blocks:[suggestion("unknown"),suggestion()]})],["numeric suggestion copy",value=>({...value,suggested_blocks:[{...suggestion(),instruction:7},suggestion()]})],["null subtype",value=>({...value,suggested_blocks:[{...suggestion(),subtype:null},suggestion()]})],
  ["missing suggestion field",value=>{const first=suggestion();delete first.relationship_to;return{...value,suggested_blocks:[first,suggestion()]};}],["extra suggestion field",value=>({...value,suggested_blocks:[{...suggestion(),extra:true},suggestion()]})],
  ["non-string future suggestion",value=>({...value,hidden_until_later:[{}]})],["six future suggestions",value=>({...value,hidden_until_later:Array(6).fill("Later")})],["null future suggestions",value=>({...value,hidden_until_later:null})],
];
for(const[label,change]of malformed)test(`strict adaptive decoder rejects ${label} without coercion or truncation`,()=>assert.throws(()=>decodeAdaptivePlanningResponse(JSON.stringify(change(validPlan()))),/provider_returned_invalid_adaptive_structure/));
test("strict adaptive decoder rejects non-text inputs and invalid JSON without repair",()=>{
  for(const value of[undefined,null,1,true,{},[]])assert.throws(()=>decodeAdaptivePlanningResponse(value),/provider_returned_invalid_adaptive_structure/);
  assert.throws(()=>decodeAdaptivePlanningResponse(""),/provider_returned_no_output/);for(const raw of["{"," ","```json\n{}\n```","{} trailing"])assert.throws(()=>decodeAdaptivePlanningResponse(raw),/provider_returned_invalid_json/);
});
test("strict adaptive decoder accepts the exact byte ceiling and rejects ASCII or UTF-8 overflow",()=>{
  const value=validPlan(),before=JSON.stringify(value);value.interpretation+="x".repeat(MAX_ADAPTIVE_PLANNING_RESPONSE_BYTES-new TextEncoder().encode(before).byteLength);const atLimit=JSON.stringify(value);assert.equal(new TextEncoder().encode(atLimit).byteLength,MAX_ADAPTIVE_PLANNING_RESPONSE_BYTES);assert.deepEqual(decodeAdaptivePlanningResponse(atLimit),value);value.interpretation+="x";assert.throws(()=>decodeAdaptivePlanningResponse(JSON.stringify(value)),/provider_returned_adaptive_structure_too_large/);
  const unicode=JSON.stringify({...validPlan(),interpretation:"あ".repeat(23_000)});assert.ok(unicode.length<MAX_ADAPTIVE_PLANNING_RESPONSE_BYTES);assert.ok(new TextEncoder().encode(unicode).byteLength>MAX_ADAPTIVE_PLANNING_RESPONSE_BYTES);assert.throws(()=>decodeAdaptivePlanningResponse(unicode),/provider_returned_adaptive_structure_too_large/);
});
