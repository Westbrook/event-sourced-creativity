import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeIdeaBody,ideaBodyText,ideaBodyReferences,plainTextIdeaBody,remapIdeaBodyReferences} from '../src/model/idea-body.ts';
import {foldEvents} from '../src/model/events.ts';
import {ideaDependencies} from '../src/model/project-ideas.ts';
import {documentSnapshot} from '../src/still/context.ts';
import {authoritativeCreativeContext} from '../worker/context-authority.ts';
import {validateIdeaBodyEvents} from '../worker/idea-body-guards.ts';
import {buildDocumentDuplicationPlan} from '../src/model/document-duplication.ts';
const event=(type,payload)=>({type,payload});
const history=inputs=>inputs.map((e,i)=>({...e,eventId:`e${i+1}`,sequence:i+1,streamId:'creative:owner',actor:'user',occurredAt:'2026-09-21'}));
const body=(targets,projectId='p')=>({schemaVersion:1,document:{type:'en-rich-text',version:1,doc:{type:'doc',content:[{type:'paragraph',content:targets.map((blockId,i)=>({type:'token',attrs:{run:{kind:'token',id:`occ-${i}`,type:'still-idea-reference',text:blockId,label:blockId,data:{schemaVersion:1,kind:'idea-reference',projectId,blockId}}}}))}]}}});
const create=(id,b,doc='a')=>event('BlockCreated',{block_id:id,project_id:'p',document_id:doc,project_owned:true,type:'direction',handle:id,position:id,properties:{text:ideaBodyText(b),rich_text_body:b}});
const base=[event('ProjectCreated',{project_id:'p',name:'P'}),event('DocumentCreated',{project_id:'p',document_id:'a',title:'A'}),event('DocumentCreated',{project_id:'p',document_id:'b',title:'B'}),create('paul',plainTextIdeaBody('Paul')),create('jon',plainTextIdeaBody('Jon')),create('scene-a',body(['paul','paul','jon'])),create('scene-b',body(['paul']),'b')];
const edit=(id,key,value)=>event('BlockPropertyEdited',{project_id:'p',block_id:id,property_path:key,new_value:value});
test('structured references preserve all occurrences and remap only canonical identities',()=>{
 const b=decodeIdeaBody(body(['paul','paul']));assert.equal(ideaBodyReferences(b).length,2);assert.equal(ideaBodyText(b),'paulpaul');
 const mapped=remapIdeaBodyReferences(b,new Map([['paul','new-paul']]),'new-project');assert.deepEqual(ideaBodyReferences(mapped).map(r=>[r.occurrenceId,r.blockId,r.projectId]),[['occ-0','new-paul','new-project'],['occ-1','new-paul','new-project']]);
 assert.equal(ideaBodyReferences(plainTextIdeaBody('@Paul')).length,0);assert.throws(()=>remapIdeaBodyReferences(b,new Map()),/missing/);
});
test('shared participant reuse cannot import scenes; repeated mentions include identity once and provenance is excluded',()=>{
 const p=foldEvents(history(base),Infinity,'a','p');
 assert.deepEqual(ideaDependencies(['paul'],p.libraryBlocks,p.libraryBlockRelations).map(b=>b.id),['paul']);
 assert.deepEqual(ideaDependencies(['scene-a'],p.libraryBlocks,[{fromBlockId:'scene-a',toBlockId:'scene-b',kind:'provenance'}]).map(b=>b.id),['scene-a','paul','jon']);
 const snapshot=documentSnapshot(p,'a');assert.equal(snapshot.facts.filter(f=>f.block_id==='paul').length,1);assert.equal(snapshot.relationships.filter(r=>r.from_block_id==='scene-a').length,2);assert.equal(snapshot.context_groups.length,0);
 const trusted=authoritativeCreativeContext(history(base),{documentId:'a',projectId:'p'});assert.deepEqual(trusted.snapshot.facts.map(f=>f.block_id),snapshot.facts.map(f=>f.block_id));assert.deepEqual(trusted.snapshot.relationships,snapshot.relationships);
});
test('server rejects legacy flattening, stale preference metadata, missing/cross-project targets and cycles before writes',()=>{
 const h=history(base);assert.equal(validateIdeaBodyEvents(h,[edit('scene-a','text','flattened')]).error,'idea_body_invalid');
 const good=plainTextIdeaBody('Changed');assert.equal(validateIdeaBodyEvents(h,[edit('scene-a','text','Changed'),edit('scene-a','rich_text_body',good)]),null);
 for(const [b,expected] of [[body(['missing']),'idea_reference_unavailable'],[body(['paul'],'other'),'idea_reference_scope_denied'],[body(['scene-a']),'idea_reference_cycle']])assert.equal(validateIdeaBodyEvents(h,[edit('paul','rich_text_body',b),edit('paul','text',ideaBodyText(b))]).error,expected);
 assert.equal(validateIdeaBodyEvents(h,[event('BlockRemoved',{project_id:'p',block_id:'paul'})]).error,'idea_reference_unavailable');
 const pref=event('BlockCreated',{project_id:'p',document_id:'a',block_id:'pref',type:'format',properties:{text:'Preferred outputs: Image',subtype:'Channel',intent:'prefer',preferred_output_kinds:['image']}});
 assert.equal(validateIdeaBodyEvents(history([...base,pref]),[edit('pref','text','Preferred outputs: Video')]).error,'idea_output_preference_invalid');
});
test('unknown versions stay readable but mutation and generation require compatible editor; copies fail without source writes',()=>{
 const future=structuredClone(base);future.find(e=>e.payload.block_id==='scene-a').payload.properties.rich_text_body.schemaVersion=2;
 const h=history(future),p=foldEvents(h,Infinity,'a','p');assert.equal(p.blocks.find(b=>b.id==='scene-a').properties.text,'paulpauljon');
 assert.equal(validateIdeaBodyEvents(h,[edit('scene-a','text','changed')]).error,'idea_body_editor_required');assert.throws(()=>documentSnapshot(p,'a'),/compatible/);
 assert.throws(()=>buildDocumentDuplicationPlan({projection:p,sourceDocumentId:'a',title:'Copy',sourceStreamId:'creative:owner',sourceSequence:h.length}),/compatible/);
 assert.equal(h.length,future.length);
});
test('fixture bodies decode losslessly and preserve exact token target counts',()=>{
 const f=JSON.parse(readFileSync(new URL('../docs/still-unified-creation-fixtures-2026-09-23.json',import.meta.url),'utf8'));
 let refs=0;for(const idea of f.ideas){const b=decodeIdeaBody(idea.body);assert.equal(ideaBodyText(b),idea.text);refs+=ideaBodyReferences(b).length;}assert.equal(refs,15);
});
test('an unrelated future-version Idea does not block other independent edits',()=>{
 const future=create('future',plainTextIdeaBody('Future'),'b');future.payload.properties.rich_text_body.schemaVersion=2;
 const h=history([...base,future]);const b=plainTextIdeaBody('A revised scene');assert.equal(validateIdeaBodyEvents(h,[edit('scene-a','text',ideaBodyText(b)),edit('scene-a','rich_text_body',b)]),null);
});
