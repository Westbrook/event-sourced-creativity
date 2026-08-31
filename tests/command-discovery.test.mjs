import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";
import { projectCommandDiscovery, commandDiscoveryTargetAvailable, commandMatchScore, commandReviewMatches } from "../src/model/command-discovery.ts";
import { commandDiscoveryCopy } from "../src/components/design-system/locales/command-discovery-messages.ts";

const event=(sequence,type,payload)=>({eventId:"event-"+sequence,streamId:"creative:test",sequence,type,payload,
  actor:"user:test",clientId:"test",occurredAt:"2026-08-30T00:00:00Z",recordedAt:"2026-08-30T00:00:00Z",
  correlationId:"discovery",causationId:null,compensatesEventId:null,schemaVersion:1});
function fixture(locale="en"){
  const events=[event(1,"ProjectCreated",{project_id:"p",name:"Current project",state:"active"})];
  const append=(type,payload)=>events.push(event(events.length+1,type,{project_id:"p",...payload}));
  for(let index=1;index<=7;index++)append("DocumentCreated",{document_id:"d"+index,title:index<3?"Same title":"Document "+index,handle:"d"+index});
  append("BlockCreated",{document_id:"d1",block_id:"direction",type:"direction",handle:"direction/intent",position:"a",properties:{text:"PRIVATE_BODY_NOT_A_SEARCH_TERM",label:"Café direction",weight:1}});
  append("BlockCreated",{document_id:"d1",block_id:"requirement",type:"output",handle:"output/canonical",position:"b",properties:{text:"Canonical Output"}});
  append("GenerationCompleted",{document_id:"d1",generation_id:"generation-a",object_ids:["image-a"],media_url:"/api/media/image-a",provider:"recorded",title:"Same title",quality:"high"});
  append("DocumentRenderCompleted",{document_id:"d2",artifact_id:"deck",artifact_kind:"slides",title:"Same title",summary:"PRIVATE_BODY_NOT_A_SEARCH_TERM",settings:{audience:"PRIVATE_BODY_NOT_A_SEARCH_TERM"},content_ref:"deck-content",item_count:1});
  const task={id:"task",organizationId:"org",organizationName:"Review organization",projectAccessId:"access",projectId:"review-project",
    projectName:"Review project",documentId:"review-document",documentTitle:"Review document",artifactId:"review-artifact",artifactTitle:"Same title",
    artifactKind:"slides",revision:2,contentSha256:"a".repeat(64),status:"pending",dueAt:null,createdAt:"2026-08-30T00:00:00Z",requestedByUserId:"author",requestedByName:"Author"};
  const input=()=>{
    const projection=foldEvents(events,Number.POSITIVE_INFINITY,"d1","p");
    return{readable:true,authorityKey:"reader:scope",projection,events,reviews:[task],locale,copy:commandDiscoveryCopy(locale),formatLabel:kind=>kind,
      preparation:{projectId:"p",documentId:"d1",canvasId:null,authorityKey:"reader:scope",canRead:true,canAuthor:true,canConfigure:true,
        blocks:projection.blocks,outputs:projection.outputs,artifacts:projection.artifacts,events,jobs:[]}};
  };
  return{events,append,input,task,rows:()=>projectCommandDiscovery(input())};
}

for(const locale of ["en","fr","ar","ja"]){
  test(locale+" command metadata includes all seven current documents, exact saved kinds and an assigned envelope",()=>{
    const f=fixture(locale),rows=f.rows();
    assert.equal(rows.filter(row=>row.target.kind==="document").length,7,"not the rail's four-row slice");
    for(const kind of ["project","decision","image","artifact","review"])assert.ok(rows.some(row=>row.target.kind===kind),kind);
    assert.ok(!rows.some(row=>row.target.kind==="decision"&&row.target.blockId==="requirement"),"canonical Output awaits C2");
    assert.equal(rows.some(row=>[row.label,row.hint,...row.terms].some(value=>value.includes("PRIVATE_BODY_NOT_A_SEARCH_TERM"))),false);
    assert.equal(new Set(rows.map(row=>row.key)).size,rows.length);
    assert.equal(new Set(rows.map(row=>row.label+"\u0000"+row.hint)).size,rows.length,"duplicate titles retain distinct human-readable qualifiers");
    assert.ok(rows.filter(row=>row.target.kind==="document").some(row=>row.target.documentId==="d7"));
  });
  test(locale+" command preparation is generic plus exactly seven free typed targets",()=>{
    const f=fixture(locale),choices=f.rows().filter(row=>row.target.kind==="prepare");
    assert.equal(choices.length,8);
    assert.equal(choices.find(row=>row.preparationChoice==="generic").target.target.medium,null);
    assert.deepEqual(choices.filter(row=>row.preparationChoice!=="generic").map(row=>row.target.target.medium),
      ["image","short_story","scene","slides","storyboard","video","audio"]);
    const input=f.input();input.preparation={...input.preparation,canAuthor:false,canConfigure:false};
    assert.equal(projectCommandDiscovery(input).some(row=>row.target.kind==="prepare"),false);
    input.preparation={...f.input().preparation,authorityKey:"other"};
    assert.equal(projectCommandDiscovery(input).some(row=>row.target.kind==="prepare"),false);
  });
}
test("document navigation identity survives its own DocumentOpened receipt; changed decisions and artifact revisions do not",()=>{
  const f=fixture(),rows=f.rows(),document=rows.find(row=>row.target.kind==="document"&&row.target.documentId==="d2");
  const decision=rows.find(row=>row.target.kind==="decision"),artifact=rows.find(row=>row.target.kind==="artifact");
  f.append("DocumentOpened",{document_id:"d2",previous_document_id:"d1"});
  assert.equal(commandDiscoveryTargetAvailable(document,f.input()),true);
  f.append("BlockPropertyEdited",{document_id:"d1",block_id:"direction",property_path:"text",old_value:"PRIVATE_BODY_NOT_A_SEARCH_TERM",new_value:"New source"});
  assert.equal(commandDiscoveryTargetAvailable(decision,f.input()),false);
  f.append("DocumentArtifactEdited",{document_id:"d2",artifact_id:"deck",content_ref:"new-content"});
  assert.equal(commandDiscoveryTargetAvailable(artifact,f.input()),false);
});
test("current source/read authority and assigned revision are required; unavailable is not another matching item",()=>{
  const f=fixture(),input=f.input(),row=f.rows().find(row=>row.target.kind==="review");
  assert.deepEqual(projectCommandDiscovery({...input,readable:false}),[]);
  assert.equal(commandDiscoveryTargetAvailable(row,{...input,authorityKey:"new-epoch"}),false);
  assert.equal(commandReviewMatches(row.target.identity,{...f.task,revision:3}),false);
  assert.equal(commandReviewMatches(row.target.identity,{...f.task,status:"superseded"}),false);
  const document=f.rows().find(value=>value.target.kind==="document"&&value.target.documentId==="d7");
  f.append("DocumentRemoved",{document_id:"d7",fallback_document_id:"d1"});
  assert.equal(commandDiscoveryTargetAvailable(document,f.input()),false);
});
test("only explicit structured medium selects generic preparation; exclusion text and broad aliases do not",()=>{
  const f=fixture();f.append("BlockPropertyEdited",{document_id:"d1",block_id:"direction",property_path:"requested_medium",old_value:null,new_value:"slides"});
  assert.equal(f.rows().find(row=>row.preparationChoice==="generic").target.target.medium,"slides");
  const input=f.input();input.preparation={...input.preparation,blocks:input.preparation.blocks.map(block=>({...block,type:"exclusion",properties:{...block.properties,intent:"prohibit"}}))};
  assert.equal(projectCommandDiscovery(input).find(row=>row.preparationChoice==="generic").target.target.medium,null);
  const decision=f.rows().find(row=>row.target.kind==="decision");
  assert.ok(commandMatchScore(decision,"cafe","en")>=0);
  assert.equal(commandMatchScore(decision,"PRIVATE_BODY_NOT_A_SEARCH_TERM","en"),-1);
});
