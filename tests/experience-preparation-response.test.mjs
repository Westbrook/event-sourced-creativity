import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Exercise the actual response branch; the built browser continuation covers
// the full Store/component and real Worker instead of substituting its response.
const source=readFileSync(new URL("../src/components/forma-experience-host.ts",import.meta.url),"utf8");
const command=source.slice(source.indexOf("  async #command("),source.indexOf("  #snapshotMatches("));
const branch=command.match(/if \(!\("draftId" in response\)[^\n]+\n\s*else if[^\n]+/);
assert(branch,"Actual command response branch must be present");
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const dispatch=new AsyncFunction("response","host","binding","operation",branch[0].replaceAll("this.#","host."));
for(const fixture of [
  {name:"verified unavailable preparation refreshes its recorded identity",response:{draftId:"retained",status:"unavailable",disposition:"prepared"},visible:true,reads:1},
  {name:"verified available preparation refreshes",response:{draftId:"retained",status:"review",disposition:"prepared"},visible:true,reads:1},
  {name:"unknown admission remains unconfirmed without automatic recovery",response:{status:"unavailable",originalIntent:"unknown_or_retained"},visible:true,reads:0,status:"Submission unconfirmed"},
  {name:"withdrawn Document never refreshes",response:{draftId:"retained",status:"unavailable",disposition:"prepared"},visible:false,reads:0}
]){
  test(fixture.name,async()=>{
    let reads=0;const binding={},operation={},host={status:"Recording",visible:value=>{assert.equal(value,binding);return fixture.visible;},
      refreshAndRead:async(b,o)=>{assert.equal(b,binding);assert.equal(o,operation);reads++;}};
    await dispatch(fixture.response,host,binding,operation);
    assert.equal(reads,fixture.reads);assert.equal(host.status,fixture.status??"Recording");
  });
}

// These are display guards only; they never grant permission or authorize work.
const render=source.slice(source.indexOf("  override render()"));
const disclosure=render.slice(render.indexOf("    const target ="),render.indexOf("    return html"));
assert(disclosure.includes("const unconfiguredPreparation ="));
const showUnconfigured=new Function("state","available",disclosure+"\nreturn Boolean(unconfiguredPreparation);");
const prepared=()=>({status:"unavailable",disposition:"prepared",original:null,grant:null,
  permitted:{prepare:false,authorize:false,run:false,resumeRun:false},
  preflight:{maximumMicrousd:0,maximumCalls:0,targets:[{available:false,reasonCode:"output_native_planner_unconfigured",
    transferCode:"output_transfer_none_owned_adoption",provider:null,model:null,route:null,maximumMicrousd:0,maximumCalls:0,maximumTokens:0}]}});
test("verified unconfigured zero-transfer preparation has functional disclosure",()=>assert.equal(showUnconfigured(prepared(),true),true));
for(const [name,change]of [
  ["unreadable source",s=>s],["other refusal",s=>s.preflight.targets[0].reasonCode="other_reason"],
  ["nonzero aggregate cost",s=>s.preflight.maximumMicrousd=1],["nonzero target cost",s=>s.preflight.targets[0].maximumMicrousd=1],
  ["possible source transfer",s=>s.preflight.targets[0].transferCode="output_transfer_document_after_authorization"],
  ["existing original",s=>s.original={}],["existing grant",s=>s.grant={}],
  ["authorization available",s=>s.permitted.authorize=true],["provider configured",s=>s.preflight.targets[0].provider="openai"],
  ["multiple targets",s=>s.preflight.targets.push({...s.preflight.targets[0]})]
]){
  test("does not claim zero-cost unconfigured disclosure for "+name,()=>{
    const state=prepared();change(state);assert.equal(showUnconfigured(state,name!=="unreadable source"),false);
  });
}
