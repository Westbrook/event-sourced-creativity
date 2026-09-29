import assert from "node:assert/strict";
import { registerOutputSourceImports } from "./output-execution-test-helpers.mjs";
import { flexible, outputFor } from "./output-presentation-fixtures.mjs";
const resolution = registerOutputSourceImports();
const [{ parseOutputRequirement }, { handleDocumentJobs }, { appendAuditEvent }, { handleEvents }, { inspectOutputAsset }] = await Promise.all([
  import("../src/model/output-requirements.ts"), import("../worker/document-jobs-api.ts"), import("../worker/runtime.ts"),
  import("../worker/events-api.ts"), import("../src/model/output-asset-inspection.ts"),
]).finally(() => resolution.deregister());

async function saveDeck(f){
 const parsed=parseOutputRequirement({id:'output-assignment',type:'Output',subtype:'Executive summary',content:'1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TikTok style videos outlining the various parts of the document.'});
 assert.ok(parsed.spec);
 const deck=parsed.spec.deliverables.find(d=>d.media_kind==='slides');assert.ok(deck);
 await f.ok(await f.send({action:'save',blockId:parsed.spec.id,spec:parsed.spec}));
 const confirmation=await f.ok(await f.send({action:'confirm',options:{count_policies:{[deck.id]:flexible},suggested_counts:{[deck.id]:8}}}));
 const target=confirmation.snapshot.confirmedPlan.plan.targets.find(t=>t.media_kind==='slides');assert.equal(target.blocking_issues.length,0,JSON.stringify(target));
 return {planId:confirmation.command.planRevisionId,targetId:target.id};
}

function meter(f) {
 const metrics={d1:0,r2:0,provider:0,queries:new Map()};
 const db=f.env.DB;
 const note=sql=>{metrics.d1++;const clean=sql.replace(/\s+/g,' ').slice(0,110);metrics.queries.set(clean,(metrics.queries.get(clean)??0)+1);};
 const wrapped=new WeakMap();
 const statement=(raw,sql)=>{const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return(...args)=>statement(target.bind(...args),sql);if(['first','all','run','raw'].includes(key))return(...args)=>{note(sql);return target[key](...args);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});wrapped.set(proxy,raw);return proxy;};
 f.env.DB=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>statement(target.prepare(sql),sql);if(key==='batch')return inputs=>{note('BATCH '+inputs.filter(x=>!/output_atomic_assertions/.test(x.sql??'')).map(x=>x.sql?.replace(/\s+/g,' ').slice(0,65)).join('|'));return target.batch(inputs.map(x=>wrapped.get(x)??x));};return Reflect.get(target,key,target);}});
 const media=f.env.MEDIA;
 f.env.MEDIA=new Proxy(media,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{metrics.r2++;return value.apply(target,args);};}});
 const reset=()=>{metrics.d1=0;metrics.r2=0;metrics.provider=0;metrics.queries.clear();};
 const profile=async(label,action)=>{reset();try{return await action();}finally{const total=metrics.d1+metrics.r2+metrics.provider;assert.ok(total<=50,`${label}: ${metrics.d1} D1 + ${metrics.r2} R2 + ${metrics.provider} provider = ${total} requests exceeds the application budget`);}};
 return{metrics,profile};
}

const flushExecution=async()=>{for(let i=0;i<100;i++)await new Promise(resolve=>setImmediate(resolve));};
function deckWithActiveReference(request){
 const draft=outputFor(),input=JSON.parse(JSON.parse(request.body).input);
 const passage=input.presentation_source.passages.find(p=>p.content.includes('Retain the established community stewardship source.'));
 assert.ok(passage?.sourceAlias,'the real provider input includes the active verified text reference');
 const item=structuredClone(draft.items[0]);item.title='Retained source';item.body='Retain the established community stewardship source.';item.slide.layout='closing';item.slide.source_order=10;item.slide.source_ids=[passage.sourceAlias];item.slide.citations=[{source_id:passage.sourceAlias,label:'Retained source',anchor:'Text source',excerpt:item.body}];item.slide.visual.value='Established community stewardship';
 draft.items.at(-1).slide.layout='statement';draft.items.push(item);draft.content_markdown+=`\n\n## ${item.title}\n${item.body}`;return draft;
}

export { saveDeck, meter, deckWithActiveReference, flushExecution, outputFor, handleDocumentJobs, appendAuditEvent, handleEvents, inspectOutputAsset };
