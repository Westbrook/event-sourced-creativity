import assert from 'node:assert/strict';
import test from 'node:test';
import {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS} from '../worker/event-write-primitives.ts';
import {historicalScopeCandidate} from '../worker/generation-historical-scope-proof.ts';

// Use the real producer's public/private representation, never manufacture a
// missing sidecar by deleting scope from an already-scoped event.
const row=e=>{const values=eventWriteBindings(e),r=Object.fromEntries(EVENT_WRITE_COLUMNS.split(',').map((k,i)=>[k,values[i]]));return {...r,private_event_id:e.eventId,created_at:e.recordedAt,redacted_at:null};};
function fixture(){
 const events=[];
 const add=(type,payload)=>{const e=makeEvent('creative:owner',events.length+1,'user:owner','fixture','fixture',type,payload);events.push(e);return e;};
 add('ProjectCreated',{project_id:'project'});
 add('DocumentCreated',{project_id:'project',document_id:'document'});
 add('BlockCreated',{project_id:'project',document_id:'document',block_id:'block',scope:'document',type:'direction',properties:{text:'Source'}});
 const target=add('BlockPropertyEdited',{block_id:'block',property_path:'text',new_value:'Source revision'});
 const rename=add('DocumentRenamed',{document_id:'document',new_title:'Title'});
 return {events,add,target,rename,check:(targetEvent=target,rows=events.map(row),before=events.length+1)=>historicalScopeCandidate(rows,events,targetEvent,'owner','document','project',before)};
}

test('unique explicit origins qualify candidate membership at each original sequence, not current membership',()=>{
 const f=fixture();for(const target of [f.target,f.rename]){const r=f.check(target);assert.equal(r.status,'candidate');assert.equal(r.basis.eventSequence,target.sequence);assert.equal(r.basis.originEventIds.length,target===f.target?3:2);}
 const originalBefore=f.events.length+1;f.add('BlockRehomed',{block_id:'block',project_id:'other',document_id:'other',scope:'document'});
 assert.equal(f.check(f.target,f.events.map(row),originalBefore).status,'candidate','later current membership is a separate eligibility question');
 assert.equal(f.check().status,'unavailable','a transition before the original request cannot be erased by current membership');
});

for(const [name,change] of [
 ['block recreated',f=>f.add('BlockCreated',{project_id:'project',document_id:'document',block_id:'block'})],
 ['document recreated',f=>f.add('DocumentCreated',{project_id:'project',document_id:'document'})],
 ['project recreated',f=>f.add('ProjectCreated',{project_id:'project'})],
 ['document fork replaces identity',f=>f.add('DocumentForked',{project_id:'project',document_id:'document'})],
 ['ambiguous fork without identity',f=>f.add('DocumentForked',{project_id:'project'})],
 ['detach and reattach',f=>{f.add('BlockDocumentDetached',{project_id:'project',document_id:'document',block_id:'block'});f.add('BlockDocumentAttached',{project_id:'project',document_id:'document',block_id:'block'});}],
 ['rehome out and back',f=>{f.add('BlockRehomed',{project_id:'other',document_id:'other',block_id:'block'});f.add('BlockRehomed',{project_id:'project',document_id:'document',block_id:'block'});}],
 ['document removed and restored',f=>{f.add('DocumentRemoved',{document_id:'document'});f.add('DocumentRestored',{document_id:'document'});}],
 ['implicit project state changes',f=>f.add('ProjectStateChanged',{state:'archived'})],
 ['project state changes',f=>f.add('ProjectStateChanged',{project_id:'project',state:'archived'})],
 ['explicit earlier foreign document claim',f=>{f.events[2].payload.document_id='other';}],
 ['implicit creation project',f=>{delete f.events[2].payload.project_id;}],
 ['implicit creation document',f=>{delete f.events[2].payload.document_id;}],
 ['foreign project metadata',f=>f.add('BlockPropertyEdited',{block_id:'block',project_id:'foreign',property_path:'text',new_value:'Change'})],
 ['implicit attachment through position',f=>f.add('BlockPropertyEdited',{block_id:'block',document_id:'other',project_id:'project',property_path:'position',new_value:'a1'})],
 ['unsupported subject event',f=>f.add('BlockScopeChanged',{block_id:'block',project_id:'project',document_id:'document'})],
 ['explicit null target scope',f=>{f.target.payload.project_id=null;}],
 ['library target',f=>{f.target.payload.scope='library';}],
 ['origin missing',f=>{f.events.splice(2,1);}],
])test('historical proof refuses '+name,()=>{const f=fixture();change(f);assert.equal(f.check().status,'unavailable');});

for(const [name,change] of [
 ['redacted potentially concealing creation',r=>{r[0].private_event_id=null;delete r[0].private_json;}],
 ['wrong private owner',r=>{r[0].owner_id='foreign';}],
 ['inconsistent public subject',r=>{r[2].payload=JSON.stringify({...JSON.parse(r[2].payload),block_id:'other'});}],
 ['missing private envelope',r=>{r[2].private_event_id=null;}],
])test('historical identity census refuses '+name,()=>{const f=fixture(),rows=f.events.map(row);change(rows);assert.equal(f.check(f.target,rows).status,'unavailable');});
