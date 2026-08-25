import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CONTEXT_CONTAINS_RELATION,
  combinedContextGroups,
  combinedContextPromptDirectives,
  validateContextCompositionGraph,
} from "../src/model/combined-context.ts";
import {
  CHARACTER_FIELD_SECTIONS,
  characterProfileSummary,
  characterProfileValue,
  withCharacterProfileField,
} from "../src/model/character-context.ts";
import { foldEvents } from "../src/model/events.ts";
import { artifactReviewState, assessCreativeContext } from "../src/model/context-health.ts";
import { buildBulletPrompt, buildProsePrompt, buildStructuredPrompt, buildXmlPrompt } from "../src/model/prompt-structures.ts";
import { sanitizeSharedValue } from "../src/model/share-scope.ts";
import { authoritativeCreativeContext, ContextIntegrityError } from "../worker/context-authority.ts";

const identifiers={woman:"private-woman-root-9173",face:"private-face-node-9173",eyes:"private-eyes-node-9173",color:"private-eye-color-9173",other:"private-other-person-9173",boundary:"private-boundary-9173"};

const event=(sequence,type,payload)=>({
  eventId:`event-${sequence}`,
  streamId:"creative:owner",
  sequence,
  occurredAt:"2026-08-25T12:00:00.000Z",
  recordedAt:"2026-08-25T12:00:00.000Z",
  actor:"user",
  clientId:"web:test",
  correlationId:"composition-test",
  causationId:null,
  compensatesEventId:null,
  schemaVersion:1,
  type,
  payload,
});

const creation=(sequence,id,type,text,extra={})=>event(sequence,"BlockCreated",{
  project_id:"project-woman",
  document_id:"document-woman",
  block_id:id,
  type,
  handle:`${type}/${text.toLowerCase().replace(/[^a-z]+/g,"-")}`,
  position:`a${String(sequence).padStart(4,"0")}`,
  properties:{text,label:text,weight:.85,authority:"authored",...extra},
});

const relation=(sequence,parent,child,order=0,extra={})=>event(sequence,"BlockRelationAdded",{
  project_id:"project-woman",
  document_id:"document-woman",
  relation_id:`relation-${sequence}`,
  from_block_id:parent,
  to_block_id:child,
  kind:CONTEXT_CONTAINS_RELATION,
  properties:{member_order:order,...extra},
});

const womanHistory=()=>[
  event(1,"ProjectCreated",{project_id:"project-woman",name:"Character studies"}),
  event(2,"DocumentCreated",{project_id:"project-woman",document_id:"document-woman",title:"Character studies"}),
  creation(3,identifiers.woman,"subject","A 53-year-old Japanese woman",{subtype:"Character headshot",character_context:true,context_group:{name:"Akiko",target:"Akiko",role:"character",application:"isolate",relativity:.96}}),
  creation(4,identifiers.face,"direction","Face",{context_group:{name:"Face",target:"Akiko’s face",role:"custom",application:"isolate",relativity:.93}}),
  creation(5,identifiers.eyes,"direction","Eyes",{context_group:{name:"Eyes",target:"Akiko’s eyes",role:"custom",application:"isolate",relativity:.9}}),
  creation(6,identifiers.color,"direction","Eye color: dark brown, almost black"),
  creation(7,identifiers.other,"subject","A different character wearing a red scarf"),
  creation(8,identifiers.boundary,"exclusion","Never include private account numbers",{intent:"prohibit"}),
  relation(9,identifiers.woman,identifiers.face),
  relation(10,identifiers.face,identifiers.eyes),
  relation(11,identifiers.eyes,identifiers.color),
];

const snapshotFor=(history)=>{
  const projection=foldEvents(history,Number.POSITIVE_INFINITY,"document-woman","project-woman");
  return{
    document:{id:"document-woman",title:"Character studies"},
    facts:projection.blocks.map((block)=>({block_id:block.id,type:block.type,role:block.type,handle:block.handle,locked:block.locked,intent:block.properties.intent??"include",properties:block.properties,active:true})),
    relationships:projection.blockRelations.map((edge)=>({relation_id:edge.id,from_block_id:edge.fromBlockId,to_block_id:edge.toBlockId,kind:edge.kind,properties:edge.properties})),
  };
};

test("any context block becomes an ordered, recursively nested combined context without changing identity",()=>{
  const projection=foldEvents(womanHistory(),Number.POSITIVE_INFINITY,"document-woman","project-woman");
  assert.equal(projection.blocks.find((block)=>block.id===identifiers.woman).id,identifiers.woman);
  const groups=combinedContextGroups(snapshotFor(womanHistory()));
  const woman=groups.find((group)=>group.id===identifiers.woman);
  assert.equal(woman.name,"Akiko");
  assert.deepEqual(woman.members.map((member)=>member.blockId),[identifiers.woman,identifiers.face,identifiers.eyes,identifiers.color]);
  assert.deepEqual(woman.members.at(-1).path,["A 53-year-old Japanese woman","Face","Eyes","Eye color: dark brown, almost black"]);
  assert.equal(groups.find((group)=>group.id===identifiers.face).depth,1);
  assert.equal(groups.find((group)=>group.id===identifiers.eyes).depth,2);
  assert.match(combinedContextPromptDirectives(snapshotFor(womanHistory()))[0],/Face > Eyes > Eye color: dark brown/);
});

test("normalized composition supports broad trees, deterministic sibling order, and intentional shared branches",()=>{
  const history=womanHistory();
  for(let index=0;index<30;index+=1){
    const id=`detail-${index}`;
    history.push(creation(history.length+1,id,"direction",`Detail ${index}`));
    history.push(relation(history.length+1,identifiers.woman,id,30-index));
  }
  const groups=combinedContextGroups(snapshotFor(history));
  const woman=groups.find((group)=>group.id===identifiers.woman);
  assert.equal(woman.members.length,34);
  assert.equal(woman.members[4].label,"Detail 29");
  assert.equal(woman.members.at(-1).label,"Detail 0");

  const projection=foldEvents(womanHistory(),Number.POSITIVE_INFINITY,"document-woman","project-woman");
  assert.equal(validateContextCompositionGraph({blocks:projection.blocks,relations:projection.blockRelations,events:[{type:"BlockRelationAdded",payload:{project_id:"project-woman",document_id:"document-woman",relation_id:"shared-eye-color",from_block_id:identifiers.face,to_block_id:identifiers.color,kind:CONTEXT_CONTAINS_RELATION,properties:{member_order:3}}}]}),null,"a deliberate shared branch remains a directed acyclic graph");
});

test("graph admission rejects cycles, duplicates, locked endpoints, cross-document links, and invalid order atomically",()=>{
  const projection=foldEvents(womanHistory(),Number.POSITIVE_INFINITY,"document-woman","project-woman");
  const graph={blocks:projection.blocks,relations:projection.blockRelations};
  const edge=(from,to,properties={member_order:0})=>({type:"BlockRelationAdded",payload:{project_id:"project-woman",document_id:"document-woman",relation_id:`new-${from}-${to}`,from_block_id:from,to_block_id:to,kind:CONTEXT_CONTAINS_RELATION,properties}});
  assert.equal(validateContextCompositionGraph({...graph,events:[edge(identifiers.color,identifiers.woman)]}).code,"context_composition_cycle");
  assert.equal(validateContextCompositionGraph({...graph,events:[edge(identifiers.face,identifiers.face)]}).code,"context_composition_cycle");
  assert.equal(validateContextCompositionGraph({...graph,events:[edge(identifiers.woman,identifiers.face)]}).code,"context_composition_duplicate");
  assert.equal(validateContextCompositionGraph({...graph,events:[edge(identifiers.woman,identifiers.other,{member_order:-1})]}).code,"context_composition_order_invalid");
  assert.equal(validateContextCompositionGraph({...graph,events:[{type:"BlockLocked",payload:{block_id:identifiers.woman}},edge(identifiers.woman,identifiers.other)]}).code,"context_composition_locked");
  assert.equal(validateContextCompositionGraph({...graph,events:[edge(identifiers.other,identifiers.woman),edge(identifiers.color,identifiers.other)]}).code,"context_composition_cycle","a later edge sees every earlier edge in the same atomic request");
  const foreign={...projection.blocks.find((block)=>block.id===identifiers.other),documentId:"foreign-document"};
  assert.equal(validateContextCompositionGraph({...graph,blocks:[...projection.blocks.filter((block)=>block.id!==identifiers.other),foreign],events:[edge(identifiers.woman,identifiers.other)]}).code,"context_composition_cross_document");
});

test("composition-only edits invalidate exact-source approvals and preserve structural provenance",()=>{
  const base=womanHistory().slice(0,8);
  const before=foldEvents(base,Number.POSITIVE_INFINITY,"document-woman","project-woman");
  const versions=before.blocks.map((block)=>({block_id:block.id,version:block.sourceEvents.length}));
  const rendered=event(9,"DocumentRenderCompleted",{artifact_id:"approved-story",artifact_kind:"short_story",document_id:"document-woman",title:"Approved story",source_block_versions:versions});
  const approved=event(10,"ArtifactApproved",{artifact_id:"approved-story",document_id:"document-woman"});
  const reviewed=foldEvents([...base,rendered,approved],Number.POSITIVE_INFINITY,"document-woman","project-woman");
  assert.equal(artifactReviewState(reviewed.artifacts[0],reviewed.blocks,[...base,rendered,approved]).status,"approved");
  const linked=relation(11,identifiers.woman,identifiers.face);
  const history=[...base,rendered,approved,linked];
  const after=foldEvents(history,Number.POSITIVE_INFINITY,"document-woman","project-woman");
  const review=artifactReviewState(after.artifacts[0],after.blocks,history);
  assert.equal(review.status,"stale");
  assert.ok(review.changedBlockIds.includes(identifiers.woman));
  assert.ok(review.changedBlockIds.includes(identifiers.face));
  assert.equal(after.blocks.find((block)=>block.id===identifiers.woman).sourceEvents.at(-1),linked.eventId);
});

test("character generation authoritatively contains only its subtree and unavoidable document prohibitions",()=>{
  const trusted=authoritativeCreativeContext(womanHistory(),{documentId:"document-woman",projectId:"project-woman",contextRootBlockId:identifiers.woman,characterOutputKind:"headshot"});
  assert.deepEqual(new Set(trusted.snapshot.facts.map((fact)=>fact.block_id)),new Set([identifiers.woman,identifiers.face,identifiers.eyes,identifiers.color,identifiers.boundary]));
  assert.equal(trusted.snapshot.character_study.format,"headshot");
  assert.match(trusted.snapshot.character_study.instruction,/shoulder-up headshot/);
  assert.doesNotMatch(JSON.stringify(trusted.snapshot),/different character wearing a red scarf/);
  assert.throws(()=>authoritativeCreativeContext(womanHistory(),{documentId:"document-woman",projectId:"project-woman",contextRootBlockId:identifiers.other}),(error)=>error instanceof ContextIntegrityError&&error.code==="character_context_not_authorized");
  assert.throws(()=>authoritativeCreativeContext(womanHistory(),{documentId:"document-woman",projectId:"project-woman",contextRootBlockId:identifiers.woman,snapshot:{facts:[{block_id:identifiers.other}]}}),(error)=>error instanceof ContextIntegrityError&&error.code==="context_block_not_authorized");
  const sheet=authoritativeCreativeContext(womanHistory(),{documentId:"document-woman",projectId:"project-woman",contextRootBlockId:identifiers.woman,characterOutputKind:"character_sheet"});
  assert.match(sheet.snapshot.character_study.instruction,/multiple consistent views/);
});

test("deep character relationships retain request-local prompt aliases without leaking durable identifiers",()=>{
  const snapshot=snapshotFor(womanHistory());
  const direction={title:"Portrait study",scene:"A single portrait of Akiko."};
  const prompts=[buildProsePrompt(snapshot,direction),buildBulletPrompt(snapshot,direction),JSON.stringify(buildStructuredPrompt(snapshot,direction)),buildXmlPrompt(snapshot,direction)];
  for(const prompt of prompts){for(const identifier of Object.values(identifiers))assert.doesNotMatch(prompt,new RegExp(identifier));assert.match(prompt,/Akiko/);assert.match(prompt,/Eye color: dark brown/);}
  const structured=buildStructuredPrompt(snapshot,direction);
  const eyeRegion=structured.user_edited_layout.regions.find((region)=>region.label.includes("Eye color"));
  assert.ok(eyeRegion.context_group_ids.length>=3,"a deeply nested decision receives every ancestor’s request-local isolation alias");
  const shared=sanitizeSharedValue({root_block_id:identifiers.woman,parentBlockId:identifiers.face,ancestor_block_ids:[identifiers.eyes],relation_id:"private-relation",label:"Akiko"},{ownerId:"owner",mediaKeys:[]},"token");
  assert.deepEqual(shared,{label:"Akiko"},"public sharing removes every durable composition identifier");
});

test("character profile fields stay optional, structured, and neutral across more than forty controls",()=>{
  const count=CHARACTER_FIELD_SECTIONS.reduce((total,section)=>total+section.fields.length,0);
  assert.ok(count>=45);
  let properties={character_profile:withCharacterProfileField({},"identity","origin","Nagoya")};
  properties={character_profile:withCharacterProfileField(properties,"eyes","eye_color","Dark brown, almost black")};
  assert.equal(characterProfileValue(properties,"identity","origin"),"Nagoya");
  assert.equal(characterProfileValue(properties,"eyes","eye_color"),"Dark brown, almost black");
  assert.match(characterProfileSummary(properties),/Place of origin: Nagoya/);
  assert.match(characterProfileSummary(properties),/Eye color: Dark brown/);
  const removed=withCharacterProfileField(properties,"identity","origin","");
  assert.equal(removed.identity,undefined);
});

test("generated character references recognize their durable account-owned rights receipt",()=>{
  const history=[...womanHistory(),event(12,"ReferenceIngested",{reference_id:"generated-face",rights_class:"account-generated"}),creation(13,"generated-reference","reference","Approved generated portrait",{reference_id:"generated-face",pixel_reference_mode:"context_only",context_reference_kind:"character_identity",likeness_transfer_consent:false}),relation(14,identifiers.woman,"generated-reference",2)];
  const projection=foldEvents(history,Number.POSITIVE_INFINITY,"document-woman","project-woman");
  assert.ok(!assessCreativeContext(projection,history).issues.some((issue)=>issue.id==="source-rights-generated-reference"));
  assert.equal(projection.blocks.find((block)=>block.id==="generated-reference").properties.pixel_reference_mode,"context_only");
});

test("document, reusable library, character editor, and governed packages expose the recursive product contract",async()=>{
  const [component,workspace,library,styles,packages,store]=await Promise.all(["../src/components/context-block.ts","../src/components/forma-workspace.ts","../src/components/forma-library.ts","../src/styles.css","../worker/context-packages-api.ts","../src/state/store.ts"].map((path)=>readFile(new URL(path,import.meta.url),"utf8")));
  assert.match(component,/role="tree"/);
  assert.match(component,/context\.composition\.reuse/);
  assert.match(component,/context\.composition\.detach/);
  assert.match(component,/CHARACTER_FIELD_SECTIONS\.map/);
  assert.match(component,/context\.character\.headshot/);
  assert.match(component,/context\.character\.sheet/);
  assert.match(component,/characterGenerationRequestKey\(this\.block\.id,kind\)/);
  assert.match(component,/acknowledgeGenerationRisk\(requestKey\)/);
  assert.match(component,/likeness_transfer_consent/);
  assert.match(component,/context\.character\.allowPixels/);
  assert.match(workspace,/const visibleBlocks=rootBlocks\.length\?rootBlocks:p\.blocks/);
  assert.match(library,/#blockSearchText\(block:CreativeBlock\)/);
  assert.match(styles,/\.context-tree-children\s*\{/);
  assert.match(styles,/\.character-context-fields\s*\{/);
  assert.match(packages,/MAX_PACKAGE_BLOCKS\s*=\s*128/);
  assert.match(store,/generateCharacterStudy/);
  assert.match(store,/pixel_reference_mode:"context_only"/);
});
