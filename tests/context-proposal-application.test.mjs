import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {buildContextApplicationPlan} from "../src/model/context-proposal-application.ts";
import {mergeContextAddendum,recoverContextReview} from "../src/model/context-review-state.ts";
const block=(id,documentId="doc-a",properties={})=>({id,projectId:"project-a",documentId,canvasId:null,scope:"document",type:"subject",handle:`subject/${id}`,position:id,locked:false,removed:false,properties:{label:id,text:id,subtype:"Main subject",intent:"include",...properties},sourceEvents:[]});
const relation=(id,from,to,kind="context_contains",properties={})=>({id,fromBlockId:from,toBlockId:to,projectId:"project-a",documentId:"doc-b",canvasId:null,scope:"document",kind,properties,removed:false});
const suggestion=(id)=>({key:`execution:${id}`,executionId:"execution",proposalId:id,research:{id,area:"related",blockId:id,type:"subject",subtype:"Main subject",label:id,text:id,reason:"Explicitly related",scope:"project",distance:1,sourceUrl:null,imageUrl:null,license:null,attribution:null}});

test("human context plan copies exact complete dependencies, preserves properties, and excludes removed relationships",()=>{
  let sequence=0;const target=block("target"),root=block("root","doc-b"),person=block("person","doc-b"),action={...block("action","doc-b",{block_references:[{block_id:"person",handle:"subject/person",role:"actor"}]}),type:"action"},unrelated=block("unrelated","doc-b");
  const relations=[relation("root-person","root","person"),relation("root-action","root","action"),relation("action-person","action","person","action_participant",{participant_role:"actor",handle:"subject/person"}),{...relation("removed","root","unrelated"),removed:true}];
  const plan=buildContextApplicationPlan({projection:{libraryBlocks:[target,root,person,action,unrelated],libraryBlockRelations:relations},target,proposals:[suggestion("root")],createId:()=>`new-${++sequence}`});
  assert.equal(plan.blockIds.length,3);assert.equal(plan.relationCount,4);assert.equal(plan.changes.filter((change)=>change.kind==="copy").length,3);
  assert.ok(!JSON.stringify(plan.events).includes("unrelated"));
  const created=plan.events.filter((event)=>event.type==="BlockCreated"),copiedPerson=created.find((event)=>event.payload.properties.copied_from_block_id==="person");
  const references=plan.events.find((event)=>event.type==="BlockPropertyEdited"&&event.payload.property_path==="block_references");assert.equal(references.payload.new_value[0].block_id,copiedPerson.payload.block_id);
  assert.ok(created.every((event)=>event.payload.document_id==="doc-a"));
  assert.ok(created.every((event)=>!event.payload.properties.semantic_isolation&&!event.payload.properties.combined_context_memberships));
});

test("human context plan never silently skips protected dependencies or unresolved participants",()=>{
  const target=block("target"),root=block("root","doc-b"),locked={...block("locked","doc-b"),locked:true};
  const projection={libraryBlocks:[target,root,locked],libraryBlockRelations:[relation("edge","root","locked")]};
  assert.throws(()=>buildContextApplicationPlan({projection,target,proposals:[suggestion("root")]}),/dependency_unavailable/);
  assert.throws(()=>buildContextApplicationPlan({projection,target,proposals:[{key:"missing",executionId:"execution",proposalId:"missing",decomposition:{id:"missing",type:"action",subtype:"Interaction",label:"Hold",text:"Hold @missing",sourceExcerpt:"Hold @missing",participants:[{handle:"missing",role:"actor"}],addendum:false}}]}),/participant_unresolved/);
});

test("human context plan reuses in-scope decisions and discloses every relationship instead of copying them",()=>{
  const target=block("target"),existing=block("existing"),projection={libraryBlocks:[target,existing],libraryBlockRelations:[]};
  const plan=buildContextApplicationPlan({projection,target,proposals:[suggestion("existing")]});
  assert.equal(plan.blockIds.length,0);assert.equal(plan.relationCount,1);assert.deepEqual(plan.changes.map((item)=>item.kind),["group","link"]);
  assert.throws(()=>buildContextApplicationPlan({projection,target,proposals:[suggestion("existing"),{...suggestion("existing"),key:"duplicate"}]}),/context_composition_duplicate/);
});

test("human context dialog has uniquely named fields and server-owned preview/confirm/retrieval, never client append",()=>{
  const source=readFileSync(new URL("../src/components/context-intelligence.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/this\.store\.(?:appendBatch|copyLibraryBlockSet)/u);
  assert.ok(source.includes('#requestChanges(this.#savePending?"retrieve":this.#changes&&!this.#changesStale?"apply":"preview")'));
  for(const key of ["include","label","type","subtype","text"])assert.ok(source.includes(`context.changes.${key}`));
  assert.match(source,/#close\(\)\{if\(this.#saving\)return/u);
  assert.match(source,/context-change-preview h3/u);
  assert.match(source,/if\(result.status==="not-applied"\)/u);
  assert.match(source,/await this.#requestChanges\("resume"\)/u);
  for(const locale of ["localization.ts","locales/fr.ts","locales/ar.ts","locales/ja.ts"]){
    const catalog=readFileSync(new URL(`../src/components/design-system/${locale}`,import.meta.url),"utf8");
    for(const key of ["preview","confirm","retrieve","atomic","include","label","type","subtype","text","uncertain","resume","applied","applying","dismiss","participantError","participantHandle","participantRole"])assert.ok(catalog.includes(`"context.changes.${key}"`),`${locale}/${key}`);
  }
});

test("human context edited Actions require explicitly reviewed matching participants, including renamed proposals and type changes",()=>{
  const target=block("target"),maya=block("maya"),jo=block("jo"),projection={libraryBlocks:[target,maya,jo],libraryBlockRelations:[]};
  const action={id:"action",type:"action",subtype:"Interaction",label:"Reading",text:"@maya reads",sourceExcerpt:"Maya reads",participants:[{handle:"maya",role:"actor"}],addendum:false};
  const proposal={key:"execution:action",executionId:"execution",proposalId:"action",decomposition:action};
  const plan=(edit,extra=[])=>buildContextApplicationPlan({projection,target,proposals:[{...proposal,edit},...extra]});
  for(const text of ["@jo watches alone","Nobody watches","@jo watches with @maya"])assert.throws(()=>plan({text}),/participants_review_required/);
  const changed=plan({text:"@jo watches alone",participants:[{handle:"jo",role:"actor"}]});
  const references=changed.events.find((event)=>event.type==="BlockPropertyEdited"&&event.payload.property_path==="block_references").payload.new_value;
  assert.deepEqual(references,[{block_id:"jo",handle:"subject/jo",role:"actor"}]);
  assert.ok(plan({text:"Nobody watches",participants:[]}).events.every((event)=>event.payload.property_path!=="block_references"));
  assert.ok(plan({type:"emotion",subtype:"Primary affect",text:"quiet"}).events.every((event)=>event.payload.property_path!=="block_references"));
  assert.throws(()=>plan({text:"@renamed reads",participants:[]}),/participants_review_required/);
  const person={key:"execution:person",executionId:"execution",proposalId:"person",decomposition:{id:"person",type:"subject",subtype:"Hero subject",label:"Original",text:"Original",sourceExcerpt:"Original",participants:[],addendum:false},edit:{label:"Renamed"}};
  assert.throws(()=>plan({text:"@original reads",participants:[{handle:"original",role:"actor"}]},[person]),/participant_unresolved/);
  const renamed=plan({text:"@renamed reads",participants:[{handle:"renamed",role:"actor"}]},[person]);
  assert.ok(renamed.changes.some((change)=>change.kind==="participant"&&change.text==="subject/renamed"));
});

test("human context repeated addendum retrieval preserves reviewed edits and deselection while distinct identities remain independent",()=>{
  const base={id:"base:a",type:"subject",subtype:"Main subject",label:"Same title",text:"base",sourceExcerpt:"base",participants:[],addendum:false};
  const addition={...base,id:"addition:a",text:"provider text",addendum:true},edited={...addition,text:"human edit"};
  const selected=new Set([base.id]),plan={sourceBlockId:"target",sourceText:"source",proposals:[base],addenda:[edited]};
  const repeated=mergeContextAddendum(plan,[addition,addition]);for(const id of repeated.addedIds)selected.add(id);
  assert.deepEqual(repeated.addedIds,[]);assert.deepEqual(repeated.plan.addenda,[edited]);assert.deepEqual([...selected],[base.id]);
  const next=mergeContextAddendum(repeated.plan,[addition,{...addition,id:"other:a"}]);
  assert.deepEqual(next.addedIds,["other:a"]);assert.equal(next.plan.addenda.length,2);assert.notEqual(next.plan.addenda[0].id,next.plan.addenda[1].id);
});

test("human context server review recovery restores the same selection and original-versus-human edits without generation",()=>{
  const original={id:"a",type:"subject",subtype:"Main subject",label:"Original",text:"source",sourceExcerpt:"source",participants:[],addendum:true};
  const preview={blockId:"target",review:{sourceText:"source",proposals:[{key:"execution:a",executionId:"execution",proposalId:"a",decomposition:original,edit:{label:"Edited",text:"my text"}}],selections:[{executionId:"execution",bindingHash:"binding",proposalId:"a",edit:{label:"Edited",text:"my text"}}]}};
  const recovered=recoverContextReview(preview);assert.equal(recovered.mode,"decompose");assert.equal(recovered.plan.addenda[0].text,"my text");
  assert.deepEqual([...recovered.selected],["execution:a"]);assert.equal(recovered.sources.get("execution:a").bindingHash,"binding");assert.equal(recovered.sources.get("execution:a").original.text,"source");
  assert.equal(recovered.sources.get("execution:a").edit,undefined,"subsequent reversal to the original must not retain an old edit payload");
  assert.throws(()=>recoverContextReview({...preview,review:{...preview.review,selections:[]}}),/identity_missing/);
});

test("human context touch fields keep a 44px minimum through the last matching cascade rule",()=>{
  const css=readFileSync(new URL("../src/components/context-intelligence.css",import.meta.url),"utf8");
  const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(([,selector,body])=>selector.includes(".context-intelligence-proposal :is(input")&&body.includes("min-block-size:"));
  assert.ok(rules.length>=2);assert.match(rules.at(-1)[2],/min-block-size:var\(--forma-control-min-size,44px\)/u);
  assert.doesNotMatch(css,/min-block-size:2\.2rem/u);assert.match(css,/context-participant-row\{grid-template-columns:1fr/u);
});

test("human context participant comparison supports composed and decomposed names without rewriting text or hiding ambiguity",()=>{
  const target=block("target"),person={...block("person"),handle:"subject/Élodie"},projection={libraryBlocks:[target,person],libraryBlockRelations:[]};
  for(const spelling of ["Élodie","E\u0301lodie"]){
    const text=`A full authored opening that is longer than forty-four characters. @${spelling} lit`;
    const item={key:"e:a",executionId:"e",proposalId:"a",decomposition:{id:"a",type:"action",subtype:"Interaction",label:"Reading",text,sourceExcerpt:text,participants:[{handle:spelling,role:"actor"}],addendum:false}};
    const plan=buildContextApplicationPlan({projection,target,proposals:[item]});
    assert.equal(plan.events.find((event)=>event.type==="BlockCreated").payload.properties.text,text);
    assert.equal(plan.events.find((event)=>event.type==="BlockPropertyEdited"&&event.payload.property_path==="block_references").payload.new_value[0].block_id,person.id);
    assert.throws(()=>buildContextApplicationPlan({projection:{...projection,libraryBlocks:[...projection.libraryBlocks,{...person,id:"other-person",handle:"subject/Elodie"}]},target,proposals:[item]}),/participant_unresolved/);
  }
});

test("human context participant role options resolve explicit messages in all four runtime catalogs",async()=>{
  const prior=globalThis.HTMLElement,priorElements=globalThis.customElements;globalThis.HTMLElement=class{};globalThis.customElements={get:()=>undefined,define:()=>{}};
  try{
    const {FORMA_DEFAULT_MESSAGES}=await import("../src/components/design-system/localization.ts");
    const catalogs=[FORMA_DEFAULT_MESSAGES,...await Promise.all(["fr","ar","ja"].map(async(locale)=>(await import(`../src/components/design-system/locales/${locale}.ts`)).default))];
    for(const role of ["actor","target","recipient","instrument","location","counterparty"]){
      const key=`context.changes.role.${role}`;
      for(const [index,catalog]of catalogs.entries())assert.ok(catalog[key],`${index}/${key}`);
      for(const locale of ["fr","ar","ja"]){const source=readFileSync(new URL(`../src/components/design-system/locales/${locale}.ts`,import.meta.url),"utf8");assert.ok(source.includes(`"${key}":`),`${locale}/${key} is an explicit translation, not English fallback`);}
    }
    const source=readFileSync(new URL("../src/components/context-intelligence.ts",import.meta.url),"utf8");assert.ok(source.includes('this.i18n.t(`context.changes.role.${role}`)'));
  }finally{if(prior===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=prior;if(priorElements===undefined)delete globalThis.customElements;else globalThis.customElements=priorElements;}
});

test("human context learned Research Actions use full participant identities and the same Unicode comparison",()=>{
  const target=block("target"),prefix="a".repeat(44),person={...block("person"),handle:`subject/${prefix}-existing`};
  const learned=(text)=>({key:"e:learned",executionId:"e",proposalId:"learned",research:{id:"learned",area:"learned",blockId:null,type:"action",subtype:"Interaction",label:"Research action",text,reason:"Cited discovery",scope:"web",distance:2,sourceUrl:"https://example.com/approved",imageUrl:null,license:null,attribution:null}});
  const plan=(text,people=[person])=>buildContextApplicationPlan({projection:{libraryBlocks:[target,...people],libraryBlockRelations:[]},target,proposals:[learned(text)]});
  assert.throws(()=>plan(`@${prefix}-other reads`),/participant_unresolved/);
  assert.ok(plan(`@${prefix}-existing reads`).changes.some((change)=>change.kind==="participant"&&change.targetId===person.id));
  const elodie={...person,handle:"subject/Élodie"};
  for(const spelling of ["Élodie","E\u0301lodie"]){
    const text=`@${spelling} lit`,result=plan(text,[elodie]);assert.equal(result.events.find((event)=>event.type==="BlockCreated").payload.properties.text,text);
    assert.ok(result.changes.some((change)=>change.kind==="participant"&&change.targetId===elodie.id));
    assert.throws(()=>plan(text,[elodie,{...elodie,id:"other",handle:"subject/Elodie"}]),/participant_unresolved/);
  }
});


test("Phase3E context research copies renew every Output identity after the complete dependency map is known",async()=>{
  const {parseOutputRequirement,inspectOutputRequirement}=await import("../src/model/output-requirements.ts");
  const spec=parseOutputRequirement({id:"output-original",type:"Output",subtype:"Executive summary",content:"1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TikTok style videos outlining the various parts of the document."}).spec;
  spec.deliverables[0].source_scope={kind:"blocks",block_ids:["source-a","source-b"]};
  spec.deliverables[0].format_variants=[{id:"landscape-original",label:"Landscape",required:true,aspect_ratio:{width:16,height:9},quantity:{kind:"exact",unit:"presentation",value:1},placements:["opening"],original_text:"Landscape opening",value_origins:{}}];
  spec.deliverables[2].series={state:"resolved",description:"Reviewed order",members:["Élodie","東京"].map((label,index)=>({id:"member-original-"+index,label,required:true,source_scope:{kind:"blocks",block_ids:[index?"source-b":"source-a"]},coverage:{kind:"topics",topics:[label]},quantity:{kind:"exact",unit:"video",value:1},original_text:label+" — exact",value_origins:{}}))};
  assert.equal(inspectOutputRequirement(spec).status,"valid");
  const original=structuredClone(spec),target=block("target"),output={...block("output-original","doc-b",{text:spec.original_text,output_spec:spec,output_grant_id:"old-grant",output_acceptance_id:"old-acceptance",output_status:"complete",grant_id:"old-grant",result_id:"old-result",weight:.8,influence:1,intent:"include",effect:"positive"}),type:"Output"};
  const projection={libraryBlocks:[target,output,block("source-a","doc-b"),block("source-b","doc-b")],libraryBlockRelations:[relation("part-a",output.id,"source-a"),relation("part-b",output.id,"source-b")]};
  let sequence=0;const planned=buildContextApplicationPlan({projection,target,proposals:[suggestion(output.id)],createId:()=>"new-"+(++sequence)});
  const created=planned.events.filter(event=>event.type==="BlockCreated"),copied=created.find(event=>event.payload.properties.copied_from_block_id===output.id),copiedIds=new Map(created.map(event=>[event.payload.properties.copied_from_block_id,event.payload.block_id]));
  const allIds=value=>[value.id,...value.deliverables.flatMap(entry=>[entry.id,...(entry.format_variants??[]).map(variant=>variant.id),...(entry.series?.members??[]).map(member=>member.id)])];
  const renewed=copied.payload.properties.output_spec;
  assert.equal(copied.payload.type,"output");assert.equal(renewed.id,copied.payload.block_id);
  assert.equal(inspectOutputRequirement(renewed).status,"valid");
  assert.ok(allIds(renewed).every(id=>!allIds(original).includes(id)));assert.equal(new Set(allIds(renewed)).size,allIds(renewed).length);
  assert.deepEqual(renewed.deliverables[0].source_scope,{kind:"blocks",block_ids:[copiedIds.get("source-a"),copiedIds.get("source-b")]});
  assert.deepEqual(renewed.deliverables[2].series.members.map(member=>member.source_scope),[{kind:"blocks",block_ids:[copiedIds.get("source-a")]},{kind:"blocks",block_ids:[copiedIds.get("source-b")]}]);
  assert.equal(renewed.original_text,original.original_text);
  assert.deepEqual(renewed.deliverables.map(entry=>entry.quantity),original.deliverables.map(entry=>entry.quantity));
  assert.deepEqual(renewed.deliverables[0].content_quantity,{kind:"range",unit:"slide",min:5,max:15});
  assert.deepEqual(renewed.deliverables[2].series.members.map(({id,source_scope,...member})=>member),original.deliverables[2].series.members.map(({id,source_scope,...member})=>member));
  for(const key of ["output_grant_id","output_acceptance_id","output_status","grant_id","result_id","weight","intent","influence","effect"])assert.equal(Object.hasOwn(copied.payload.properties,key),false,key);
  assert.ok(planned.events.every(event=>!event.type.startsWith("Output")));
  assert.deepEqual(spec,original,"copy never rewrites the source requirement");
});

test("Phase3E context research partial Output copies preserve unknown complete source coverage instead of narrowing it",async()=>{
  const {parseOutputRequirement}=await import("../src/model/output-requirements.ts");
  const spec=parseOutputRequirement({id:"output-original",type:"output",subtype:"Executive summary",content:"1 slideshow with 5 slides, one podcast episode outlining the document."}).spec;
  spec.deliverables[0].source_scope={kind:"blocks",block_ids:["source-a","source-b"]};
  const target=block("target"),output={...block("output-original","doc-b",{text:spec.original_text,output_spec:spec}),type:"output"};
  const projection={libraryBlocks:[target,output,block("source-a","doc-b"),block("source-b","doc-b")],libraryBlockRelations:[relation("only-a",output.id,"source-a")]};
  const plan=buildContextApplicationPlan({projection,target,proposals:[suggestion(output.id)]}),created=plan.events.filter(event=>event.type==="BlockCreated"),copy=created.find(event=>event.payload.type==="output");
  assert.equal(created.length,2,"an Output scope is not an implicit new copy grant");
  assert.equal(copy.payload.properties.output_spec.deliverables[0].source_scope.kind,"unknown");
  assert.match(copy.payload.properties.output_spec.deliverables[0].source_scope.reason,/not been narrowed automatically/);
  assert.equal(copy.payload.properties.output_spec.deliverables[1].source_scope.kind,"unknown","cross-document library subset is not a whole-Document duplicate");
  assert.ok(!created.some(event=>event.payload.properties.copied_from_block_id==="source-b"));
  assert.deepEqual(spec.deliverables[0].source_scope,{kind:"blocks",block_ids:["source-a","source-b"]});
});

test("Phase3E context research keeps future Output schemas opaque and non-executable without copying fulfillment",async()=>{
  const {inspectOutputRequirement}=await import("../src/model/output-requirements.ts"),unknown={schema_version:19,id:"future-original",unknown_constraint:"preserve exactly"};
  const target=block("target"),source={...block("future-block","doc-b",{text:"Future intent",output_spec:unknown,output_status:"complete",output_grant_id:"never-copy"}),type:"OUtput"};
  const plan=buildContextApplicationPlan({projection:{libraryBlocks:[target,source],libraryBlockRelations:[]},target,proposals:[suggestion(source.id)]});
  const copy=plan.events.find(event=>event.type==="BlockCreated");
  assert.notEqual(copy.payload.block_id,source.id);assert.equal(copy.payload.type,"output");
  assert.deepEqual(copy.payload.properties.output_spec,unknown);assert.equal(inspectOutputRequirement(copy.payload.properties.output_spec).status,"unsupported");
  assert.equal(Object.hasOwn(copy.payload.properties,"output_status"),false);assert.equal(Object.hasOwn(copy.payload.properties,"output_grant_id"),false);
  assert.equal(copy.payload.properties.copied_from_block_id,source.id);assert.ok(plan.events.every(event=>!event.type.startsWith("Output")));
});

test("Phase3E context research retains the original locked, licensed and cross-project copy protections for Outputs",async()=>{
  const {parseOutputRequirement}=await import("../src/model/output-requirements.ts"),target=block("target");
  const source={...block("output-original","doc-b",{text:"One slideshow",output_spec:parseOutputRequirement({id:"output-original",type:"output",content:"1 slideshow with 5 slides."}).spec}),type:"output"};
  for(const protectedSource of [{...source,locked:true},{...source,properties:{...source.properties,rights_revoked:true}},{...source,projectId:"foreign-project"}]){
    assert.throws(()=>buildContextApplicationPlan({projection:{libraryBlocks:[target,protectedSource],libraryBlockRelations:[]},target,proposals:[suggestion(source.id)]}),/source_protected/);
  }
});

test('a reviewed learned title is persisted with its source and immutable factual content',()=>{
 const target=block('target'),projection={libraryBlocks:[target],libraryBlockRelations:[]};
 const research={...suggestion('family').research,area:'learned',blockId:null,label:'Atticus Finch’s family',text:'Atticus is the father of Scout and Jem.',sourceUrl:'https://example.org/evidence'};
 const item={key:'learned',executionId:'execution',proposalId:'family',research};
 const plan=buildContextApplicationPlan({projection,target,proposals:[{...item,edit:{label:'  Scout and Jem’s father  '}}]});
 const saved=plan.events.find(e=>e.type==='BlockCreated').payload;
 assert.equal(saved.properties.label,'Scout and Jem’s father');assert.equal(saved.properties.text,research.text);assert.equal(saved.properties.source_url,research.sourceUrl);assert.equal(saved.properties.human_edited,true);
 assert.ok(plan.changes.some(c=>c.kind==='create'&&c.label===saved.properties.label));
 for(const edit of [{label:''},{label:'x'.repeat(161)},{text:'different fact'},{type:'style'}])assert.throws(()=>buildContextApplicationPlan({projection,target,proposals:[{...item,edit}]}),/invalid_edit/);
 assert.throws(()=>buildContextApplicationPlan({projection:{libraryBlocks:[target,block('family')],libraryBlockRelations:[]},target,proposals:[{...suggestion('family'),edit:{label:'Rename existing'}}]}),/existing_edit_forbidden/);
});
