import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from 'prosemirror-state';
import {Fragment} from 'prosemirror-model';
import {isCreationReplacementRangeValid,prepareCreationReplacement,decorateCreationReplacements,acceptCreationReplacements} from '../src/still/creation-replacement.ts';
import {richDocumentFromRuns,richDocumentText} from '../src/still/vendor/elements/rich-document.js';
import {validateRichDocument,richSnapshot,richSchema} from '../src/still/vendor/elements/rich-text-editor/document.js';
import {resolveRichRange} from '../src/still/vendor/elements/rich-text-editor/ranges.js';
const block=(id,text,label=id)=>({id,projectId:'p',handle:label,type:'subject',properties:{text,label}});
const version=id=>({id,projectId:'p',revision:'1',hash:`hash-${id}`});
const selection={id:'selected',projectId:'p',rootIds:['paul'],sources:[version('paul'),version('instrument')]};
const sourceBodies=[block('paul','Paul with an unspecified instrument.','Paul'),block('instrument','An unspecified instrument.','Instrument')];
function fixture(text,from=0,to=text.length){
 let state=EditorState.create({doc:validateRichDocument(richDocumentFromRuns([{kind:'text',text}]))});
 return {revision:1,calls:0,decorations:[],get value(){return richDocumentText(richSnapshot(state.doc));},get document(){return richSnapshot(state.doc);},
  captureRange(){return {coordinate:'text',from,to,expectedText:text.slice(from,to),revision:this.revision};},
  validateRange(range){return !!resolveRichRange(state.doc,this.revision,range);},decorateRanges(ranges){if(ranges.some(item=>!this.validateRange(item.range)))return false;this.decorations=ranges;return true;},clearRangeDecorations(){this.decorations=[];},
  replaceRanges(replacements){const list=replacements.map(item=>({...item,resolved:resolveRichRange(state.doc,this.revision,item.range)}));if(list.some(item=>!item.resolved))return false;list.sort((a,b)=>a.resolved.from-b.resolved.from);if(list.some((item,index)=>index&&item.resolved.from<list[index-1].resolved.to))return false;const tr=state.tr;for(const item of list.reverse()){const nodes=item.runs.map(run=>run.kind==='token'?richSchema.nodes.token.create({run}):richSchema.text(run.text));tr.replaceWith(item.resolved.from,item.resolved.to,Fragment.fromArray(nodes));}state=state.apply(tr);this.revision++;this.calls++;return true;}};
}
const prepare=(editor,options={})=>prepareCreationReplacement(editor,{draftId:'draft',draftRevision:4,projectId:'p',selection,sourceBodies,...options});
test('source preview exposes every dependency and keeps qualifications unless explicitly corrected',()=>{
 const editor=fixture('Paul, but without a biography.');const preview=prepare(editor);
 assert.equal(preview.passage,'Paul, but without a biography.');assert.equal(preview.resultingText,'Paul, but without a biography. @Paul');assert.equal(editor.value,preview.passage);assert.equal(editor.calls,0);
 assert.deepEqual(preview.sources.map(source=>[source.id,source.root]),[['paul',true],['instrument',false]]);assert.ok(Object.isFrozen(preview.sources));
 assert.equal(decorateCreationReplacements(editor,[preview]),true);assert.equal(editor.calls,0);
 const decisions=acceptCreationReplacements(editor,[preview],selection);assert.equal(editor.calls,1);assert.equal(editor.value,'Paul, but without a biography. @Paul');assert.equal(editor.decorations.length,0);assert.equal(decisions[0].accepted,true);
});
test('repeated spelling is independently selected with unique occurrences, never globally replaced',()=>{
 const editor=fixture('Paul and Paul.',0,4);
 const first=prepare(editor,{remainingText:''}),second=prepare(editor,{remainingText:'',range:{coordinate:'text',from:9,to:13,expectedText:'Paul',revision:1}});
 assert.notEqual(first.runs[0].id,second.runs[0].id);assert.equal(first.runs[0].data.blockId,second.runs[0].data.blockId);
 acceptCreationReplacements(editor,[first],selection);assert.equal(editor.value,'@Paul and Paul.');assert.equal(editor.calls,1);
});
test('one reviewed passage can insert several explicitly selected identities in one transaction',()=>{
 const editor=fixture('Paul and Jon.'),multiple={...selection,rootIds:['paul','jon'],sources:[...selection.sources,version('jon')]};
 const preview=prepare(editor,{selection:multiple,sourceBodies:[...sourceBodies,block('jon','Jon','Jon')],remainingText:''});
 acceptCreationReplacements(editor,[preview],multiple);assert.equal(editor.value,'@Paul @Jon');assert.equal(editor.calls,1);
});
test('changed dependencies, stale passages, cross-project sources and overlap reject without mutation',()=>{
 const editor=fixture('Paul and Paul.'),preview=prepare(editor);
 assert.throws(()=>acceptCreationReplacements(editor,[preview],{...selection,sources:[version('paul'),{...version('instrument'),revision:'2'}]}),/changed/);
 assert.throws(()=>prepare(editor,{selection:{...selection,projectId:'other'}}),/only for authorized/);
 assert.throws(()=>acceptCreationReplacements(editor,[preview,preview],selection),/overlap/);assert.equal(editor.calls,0);
 editor.revision++;assert.throws(()=>acceptCreationReplacements(editor,[preview],selection),/draft passage changed/);assert.equal(editor.calls,0);
});
test('no reliable passage requires user selection/caret and insertion preserves all surrounding text',()=>{
 const editor=fixture('No one is sitting.',3,3);const preview=prepare(editor);assert.equal(preview.passage,'');acceptCreationReplacements(editor,[preview],selection);assert.equal(editor.value,'No @Paul one is sitting.');
 const missing=fixture('Paul');missing.captureRange=()=>undefined;assert.throws(()=>prepare(missing),/Select the exact draft text/);assert.equal(missing.calls,0);
});


test('Still refuses whole-token reuse even though upstream permits it, for both coordinate systems',()=>{
 const token={kind:'token',id:'existing',type:'still-idea-reference',text:'@Paul',label:'Paul',data:{projectId:'p',blockId:'paul'}};
 const document={type:'en-rich-text',version:1,doc:{type:'doc',content:[
  {type:'paragraph',content:[{type:'text',text:'Intro'}]},
  {type:'bullet_list',content:[{type:'list_item',content:[{type:'paragraph',content:[{type:'text',text:'Use '},{type:'token',attrs:{run:token}},{type:'text',text:' safely'}]}]}]}
 ]}};
 const doc=validateRichDocument(document),editor={document,revision:1,calls:0,
  validateRange(range){return !!resolveRichRange(doc,this.revision,range);},
  captureRange(){return this.range;},replaceRanges(){this.calls++;return true;},clearRangeDecorations(){}};
 let position;doc.descendants((node,pos)=>{if(node.type.name==='token')position=pos;});
 const text=richDocumentText(document),start=text.indexOf('@Paul');
 for(const coordinate of ['text','structured']){
  const from=coordinate==='text'?start:position,to=from+(coordinate==='text'?5:1);
  editor.range={coordinate,from,to,expectedText:'@Paul',revision:1};
  assert.equal(editor.validateRange(editor.range),true,'Upstream permits a complete token');
  assert.equal(isCreationReplacementRangeValid(editor,editor.range),false);
  assert.throws(()=>prepare(editor),/must not cross an existing reference/);
  for(const endpoint of [from,to])assert.equal(isCreationReplacementRangeValid(editor,{...editor.range,from:endpoint,to:endpoint,expectedText:''}),true,'Caret at token boundary remains usable');
  const preview={draftId:'draft',projectId:'p',rootIds:['paul'],sources:selection.sources,range:editor.range,runs:[]};
  assert.throws(()=>acceptCreationReplacements(editor,[preview],selection),/existing reference/);
 }
 const all={coordinate:'structured',from:0,to:doc.content.size,expectedText:text,revision:1};
 assert.equal(editor.validateRange(all),true);assert.equal(isCreationReplacementRangeValid(editor,all),false);
 assert.equal(editor.calls,0);
});
