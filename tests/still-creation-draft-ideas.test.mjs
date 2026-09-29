import test from 'node:test';
import assert from 'node:assert/strict';
import {draftIdeaChoices} from '../src/still/creation-draft-ideas.ts';
import {richDocumentFromRuns} from '../src/still/vendor/elements/rich-document.js';
const declaration=(id,name,targetId,draftId='current')=>({kind:'token',id,type:'still-creation-declaration',text:`@${name}`,label:name,data:{schemaVersion:1,kind:'declaration',draftId,targetId}});
const choices=(runs,query='')=>draftIdeaChoices(richDocumentFromRuns(runs),'current',query,'In this draft');

test('draft picker reuses explicit identity with fresh occurrences, never equal spelling',()=>{
 const dan=declaration('a','dan','temporary:dan'),repeat=declaration('b','dan','temporary:dan'),other=declaration('c','dan','temporary:other');
 const rows=choices([dan,repeat,other]);assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);
 assert.equal(rows[0].insert[0].data.targetId,'temporary:dan');assert.notEqual(rows[0].insert[0].id,dan.id);
 assert.notEqual(choices([dan])[0].insert[0].id,rows[0].insert[0].id);
 assert.equal(choices([{kind:'text',text:'@dan'},declaration('f','foreign','temporary:foreign','other')]).length,0);
});
test('draft picker derives retained declarations from current recovered content and filters names',()=>{
 const dan=declaration('a','dan','temporary:dan'),bike=declaration('b','motorcycle','temporary:bike');
 const saved=richDocumentFromRuns([dan,bike, {...dan,id:'c'}]);
 assert.deepEqual(draftIdeaChoices(JSON.parse(JSON.stringify(saved)),'current','','draft').map(row=>row.label),['dan','motorcycle']);
 assert.deepEqual(choices([dan,bike],'MOTOR').map(row=>row.label),['motorcycle']);
 assert.deepEqual(choices([bike]).map(row=>row.label),['motorcycle']);assert.equal(choices([]).length,0);
 assert.equal(choices([dan]).length,1,'undo restoring a retained occurrence restores the suggestion');
});
