import assert from "node:assert/strict";
import { createCalmFullPage, fullPageTree } from "./calm-full-page-fixture.mjs";
import { createSceneStoreHost } from "./scene-cost-store-host.mjs";
import { createOutputControllerFixture, FIXTURE_DOCUMENT_IDS, FIXTURE_ACTOR, FIXTURE_PROJECT, FIXTURE_PROJECT_ACCESS } from "../output-controller-fixture-model.mjs";
import * as requirementDomain from "../../src/model/output-requirements.ts";
import * as planDomain from "../../src/model/output-plan.ts";
import { inspectOutputAsset } from "../../src/model/output-asset-inspection.ts";
import { CREATOR_CAPABILITIES, SELF_CAPABILITIES } from "../../src/platform/capabilities.ts";
import { live } from "lit/directives/live.js";

// Actual Shell/route/components, full production Store/client, actual Output
// domain fixture. Only browser and HTTP endpoints are deterministic ports.
// No live database, server authority, provider, CSS geometry or AT claim.
export const OUTPUT_REACHABILITY_STATES = Object.freeze({
  unconfirmed:"draft", confirmed:"ready", "multi-target":"filtered-target-plan",
  unknown:"source-unknown", reviewer:"review-only-eligible", "read-only":"review-only-eligible",
  "uncertain-receipt":"native-timeout-unknown",
});
const liveType=live("")._$litDirective$;
const isWithin=(node,ancestor)=>{for(let current=node;current;current=current.parent)if(ancestor(current))return true;return false;};
export const withinOutput=node=>isWithin(node,current=>current.tag==="forma-output-requirements");

function syntheticSession(state) {
  const reviewing=state==="reviewer"||state==="read-only";
  const permissions=reviewing?["project.read",...(state==="reviewer"?["project.review.approve"]:[])]:[...CREATOR_CAPABILITIES];
  const budget={usedMicrousd:0,reservedMicrousd:0,limitMicrousd:1_000_000,remainingMicrousd:1_000_000};
  return {
    user:{userId:FIXTURE_ACTOR,email:"fixture@example.invalid",displayName:"Synthetic Output author",role:"creator",consentVersion:"synthetic",consentedAt:"2026-08-27T00:00:00Z"},
    impersonation:null,policy:{version:"synthetic",accepted:true,passiveCapture:false,externalAssetsRequireAssertion:true,retentionDays:30,sharing:"private"},
    canvas:{version:"synthetic",mode:"pilot",pilotAvailable:false,access:false,accessReason:"pilot-gate-incomplete",blockedBy:[],requirements:[]},
    provider:{name:"SYNTHETIC — unavailable",model:"fixture-only",plannerModel:"fixture-only",configured:false,plannerConfigured:false,imageProviders:[],videoConfigured:false,audioConfigured:false},
    budgets:{period:"synthetic",user:{used:0,reserved:0,limit:1_000_000},workspace:{used:0,reserved:0,limit:1_000_000}},
    costBudgets:{period:"synthetic",currency:"USD",user:{...budget},workspace:{...budget}},
    audience:"creative",capabilities:reviewing?[...SELF_CAPABILITIES,...permissions]:[...CREATOR_CAPABILITIES],permissionEpoch:"synthetic-output-1",
    ...(reviewing?{projectContext:{organizationId:"fixture-review-organization",projectAccessId:FIXTURE_PROJECT_ACCESS,projectId:FIXTURE_PROJECT,ownerUserId:"fixture-other-owner",role:"viewer",permissions,expiresAt:"2099-01-01T00:00:00Z"}}:{}),
  };
}

export async function createOutputReachabilityPage(t,{state="confirmed",surface="document",locale="en",unavailable=false}={}) {
  assert.ok(Object.hasOwn(OUTPUT_REACHABILITY_STATES,state));
  assert.ok(["document","deliver"].includes(surface));
  const previousFetch=globalThis.fetch,external=[];
  globalThis.fetch=async(...args)=>{external.push(args);throw Error("No external/provider transport exists in Output reachability tests");};
  t.after(()=>{globalThis.fetch=previousFetch;assert.equal(external.length,0);});
  const records=[],adapter=await createOutputControllerFixture({domain:{...requirementDomain,...planDomain,inspectOutputAsset},onRecord:entry=>records.push(entry)});
  for(const id of FIXTURE_DOCUMENT_IDS){adapter.seed(id,OUTPUT_REACHABILITY_STATES[state]);if(state==="read-only")adapter.setPermissions(id,false);}
  const session=syntheticSession(state),streamId="creative:"+FIXTURE_ACTOR,events=[];
  const append=(type,payload)=>events.push({eventId:"output-reachability-seed-"+events.length,streamId,sequence:events.length+1,occurredAt:"2026-08-27T00:00:00Z",recordedAt:"2026-08-27T00:00:00Z",actor:"user",correlationId:"synthetic-output-reachability",type,payload});
  append("ProjectCreated",{project_id:FIXTURE_PROJECT,name:"Synthetic Output project"});
  for(const [index,id] of FIXTURE_DOCUMENT_IDS.entries())append("DocumentCreated",{project_id:FIXTURE_PROJECT,document_id:id,title:"Synthetic Document "+String.fromCharCode(65+index)});
  const requests=[],unexpected=[];
  const workerFixture={
    projectId:FIXTURE_PROJECT,documentId:FIXTURE_DOCUMENT_IDS[0],owner:FIXTURE_ACTOR,streamId,
    requestId:"unused-scene-fixture",payload:{workflowSources:[]},events,contentRef:"",content:"",close(){},
    async request(input,init={}){
      const url=new URL(String(input),"https://fixture.invalid"),method=init.method??"GET";requests.push({path:url.pathname,search:url.search,method,body:init.body});
      if(url.pathname.startsWith("/api/output-requirements"))return unavailable&&method==="GET"?Response.json({error:"output_client_load_failed"},{status:503}):adapter.fetch(url.pathname+url.search,init);
      assert.equal(method,"GET","non-Output transport is read-only");
      if(url.pathname==="/api/session")return Response.json(session);
      if(url.pathname==="/api/events")return Response.json({events,head:events.length,content:{}});
      if(url.pathname==="/api/document-jobs")return Response.json({jobs:FIXTURE_DOCUMENT_IDS.flatMap(id=>adapter.jobs(id)),nextCursor:null});
      if(url.pathname==="/api/document-jobs/presentation-candidates")return Response.json({documentId:url.searchParams.get("document"),jobs:[]});
      if(url.pathname==="/api/reviews")return Response.json({reviews:[],nextCursor:null});
      if(url.pathname==="/api/project-notifications")return Response.json({notifications:[],nextCursor:null});
      if(/context-packages|context-bindings/u.test(url.pathname))return Response.json({packages:[],bindings:[]});
      unexpected.push(url.pathname);throw Error("Unimplemented read-only full-page transport: "+url.pathname);
    },
  };
  const storeHost=await createSceneStoreHost({workerFixture});
  t.after(()=>assert.deepEqual(storeHost.requests.filter(request=>
    (request.init.method??"GET")!=="GET"
    && !(request.url==="/api/output-requirements"&&request.init.method==="POST"&&request.body?.action==="confirm")),
  [],"all actual Store transports are read-only except explicit free confirmations; no events, grant or provider driver"));

  // The supplied store keeps the production authority, fold, wrappers and
  // OutputRequirementsClient; this factory creates no Scene database.
  const f=await createCalmFullPage(t,{locale,storeHost});
  t.after(()=>assert.deepEqual(unexpected,[],"every component read has an explicit synthetic endpoint"));
  f.store.documentJobs.set(FIXTURE_DOCUMENT_IDS.flatMap(id=>adapter.jobs(id)));
  const originalAttrs=f.renderer.attrs.bind(f.renderer);
  f.renderer.attrs=raw=>{
    const parsed=originalAttrs(raw);
    for(const [key,value] of Object.entries(parsed.properties))if(value?._$litDirective$===liveType)parsed.properties[key]=value.values[0];
    return parsed;
  };
  f.adapter=adapter;f.outputRecords=records;f.outputRequests=requests;f.outputState=state;f.outputSurface=surface;
  for(const id of FIXTURE_DOCUMENT_IDS){
    const snapshot=adapter.snapshot(id),row=snapshot.requirements[0];
    f.appendEvent("BlockCreated",{document_id:id,block_id:row.blockId,type:"output",handle:"output/synthetic-"+id,position:"zz",properties:{text:row.content,subtype:row.subtype,output_spec:row.spec,authority:"authored"}});
  }
  f.store.route.set(surface==="document"?"/document/"+FIXTURE_DOCUMENT_IDS[0]+"/synthetic-output":"/deliver");
  await f.settle();
  f.outputTree=()=>f.tree().nodes.filter(withinOutput);
  f.outputControllers=()=>f.components().filter(component=>component.tag==="forma-output-requirements");
  f.outputCards=()=>f.components().filter(component=>component.tag==="forma-output-requirement-card");
  f.outputSnapshot=id=>f.store.outputRequirements.resource(id??FIXTURE_DOCUMENT_IDS[0]).snapshot;
  f.toggleSummary=(summary)=>{
    assert.equal(summary.tag,"summary");assert.ok(!summary.hiddenBy,"native summary is reachable");
    const details=summary.parent;assert.equal(details.tag,"details");assert.ok(details.port);
    assert.equal(f.renderer.nodes.filter(node=>node.owner===details.owner&&node.full===details.port.full).length,1,"this focused native-default probe owns one unambiguous disclosure port");
    // Native details default: changes open state without a Lit update or an
    // application command; all descendant instances remain mounted.
    details.port.open=!details.port.open;
    return fullPageTree(f);
  };
  f.outputControls=()=>{const nodes=f.outputTree().filter(node=>!node.hiddenBy);return Object.fromEntries(["button","select","input","textarea","summary"].map(tag=>[tag,nodes.filter(node=>node.tag===tag).length]));};
  return f;
}
