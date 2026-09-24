import test from 'node:test';
import assert from 'node:assert/strict';
import {creationDocumentMarkers} from '../src/still/creation-input.ts';
import {CreationController} from '../src/still/creation-controller.ts';
import {richDocumentFromRuns,richDocumentText} from '../src/still/vendor/elements/rich-document.js';
const scope={draftId:'draft',projectId:'project'};
const text=value=>({kind:'text',text:value});
const declaration=(id,targetId,label='dan',draftId='draft')=>({kind:'token',id,type:'still-creation-declaration',text:`@${label}`,label,data:{schemaVersion:1,kind:'declaration',draftId,targetId}});
const reference=(id,blockId,label='dan',projectId='project')=>({kind:'token',id,type:'still-idea-reference',text:`@${label}`,label,data:{schemaVersion:1,kind:'idea-reference',projectId,blockId}});
const project=()=>({actorUserId:'actor',custodyKey:'personal:actor',permissionEpoch:'1',projectId:'project',documentId:null});

test('same labels remain distinct identities while repeated chosen declarations share a target',()=>{
 const document=richDocumentFromRuns([text('@dan then '),declaration('first','temporary:one'),text(' and '),declaration('second','temporary:two'),text(' then '),declaration('third','temporary:one')]);
 const markers=creationDocumentMarkers(document,scope);
 assert.deepEqual(markers.map(m=>m.targetId),[undefined,'temporary:one','temporary:two','temporary:one']);
 assert.deepEqual(markers.slice(1).map(m=>m.id),['first','second','third']);
 assert.deepEqual(markers.map(m=>m.start),[0,10,19,29]);
 assert.equal(new Set(markers.map(m=>m.id)).size,4);
});

test('canonical references bind exact token offsets including multiword labels and block breaks',()=>{
 const document={type:'en-rich-text',version:1,doc:{type:'doc',content:[
  {type:'heading',attrs:{level:2},content:[{type:'text',text:'🎸 @dan'}]},
  {type:'paragraph',content:[{type:'token',attrs:{run:reference('canonical','saved-dan')}},{type:'hard_break'},{type:'token',attrs:{run:declaration('multiword','temporary:bike','blue motorcycle')}}]},
 ]}};
 const source=richDocumentText(document),markers=creationDocumentMarkers(document,scope);
 assert.equal(source,'🎸 @dan\n@dan\n@blue motorcycle');
 assert.deepEqual(markers.map(m=>[m.start,m.end,m.kind,m.targetId]),[[3,7,'declaration',undefined],[8,12,'reference','saved-dan'],[13,29,'declaration','temporary:bike']]);
 for(const marker of markers)assert.equal(source.slice(marker.start,marker.end),marker.text);
});

test('deleted, literalized and foreign tokens cannot retain stale marker identity; undo restores it',()=>{
 const full=richDocumentFromRuns([declaration('first','temporary:one'),text(' '),declaration('second','temporary:one')]);
 const original=creationDocumentMarkers(full,scope);
 const remaining=creationDocumentMarkers(richDocumentFromRuns([declaration('second','temporary:one')]),scope,original);
 assert.deepEqual(remaining.map(m=>[m.id,m.targetId,m.start]),[['second','temporary:one',0]]);
 const literal=creationDocumentMarkers(richDocumentFromRuns([text('@dan')]),scope,remaining);
 assert.equal(literal[0].targetId,undefined);
 const foreign=creationDocumentMarkers(richDocumentFromRuns([declaration('foreign','temporary:one','dan','other-draft'),text(' '),reference('foreign-reference','saved-dan','dan','other-project')]),scope,original);
 assert.ok(foreign.every(m=>m.targetId===undefined&&m.kind==='declaration'));
 const removed=creationDocumentMarkers(richDocumentFromRuns([text('')]),scope,remaining);
 assert.deepEqual(removed,[]);
 assert.deepEqual(creationDocumentMarkers(full,scope,removed),original);
});

test('controller persists and restores declaration identity through deletion, undo and draft reload',async t=>{
 let saved;const memory=new Map(),storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
 const request=async(_path,body,method)=>{if(method==='GET'||!body)return {draft:structuredClone(saved)};saved=structuredClone(body.draft);saved.acknowledgedRevision=saved.revision;return {draft:structuredClone(saved)};};
 const make=()=>new CreationController({entryKind:'document',scope:project(),request,storage,onChange(){}});
 const controller=make();t.after(()=>controller.dispose());
 const draftId=controller.draft.id,document=richDocumentFromRuns([declaration('first','temporary:one','dan',draftId),text(' then '),declaration('second','temporary:one','dan',draftId)]);
 controller.changeDocument(document);await controller.flush();
 const original=structuredClone(controller.draft.markers);assert.deepEqual(original.map(m=>m.targetId),['temporary:one','temporary:one']);
 controller.changeDocument(richDocumentFromRuns([text('')]));assert.deepEqual(controller.draft.markers,[]);
 controller.changeDocument(document);assert.deepEqual(controller.draft.markers,original);await controller.flush();
 const restored=make();t.after(()=>restored.dispose());await restored.start();
 assert.deepEqual(restored.draft.markers,original);assert.deepEqual(restored.draft.workingDocument,document);
 restored.changeDocument(richDocumentFromRuns([text('Before '),...document.doc.content[0].content.map(node=>node.type==='token'?node.attrs.run:text(node.text))]));
 assert.deepEqual(restored.draft.markers.map(m=>[m.id,m.targetId,m.start]),[['first','temporary:one',7],['second','temporary:one',17]]);
});
