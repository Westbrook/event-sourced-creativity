import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, evaluateActions } from '../src/still/decisions.ts';
import { nextToolbarActions, paletteActions, finderEntry } from '../src/still/finder.ts';
const pos={projectId:'p',documentId:'d',blockId:'b',outputId:'',view:'document',intent:'',recentActions:[]};
const candidates=ACTIONS.filter(a=>['edit-block','compose','reuse','create','results','research-context','find-references','new-document','image','intent'].includes(a.id));
const score=n=>({type:'score',score:n,confidence:.9});
test('More continues the scored order past menu diversity and capacity limits',()=>{
  const answers=Object.fromEntries(candidates.map((a,i)=>[`use_${a.id}`,score(3-i*.1)]));
  const evaluation=evaluateActions(candidates,pos,answers),visible=evaluation.selected.map(a=>a.id);
  const next=nextToolbarActions(evaluation.ranked,visible,candidates);
  assert.equal(next.length,3);assert.ok(next.every(a=>!visible.includes(a.id)));
  assert.deepEqual(next.map(a=>a.id),evaluation.rows.filter(r=>r.rank&&!visible.includes(r.id)).sort((a,b)=>a.rank-b.rank).slice(0,3).map(r=>r.id));
  assert.ok(!evaluation.ranked.some(a=>a.id==='image'||a.id==='intent'),'Format evidence gates still apply');
});
test('zero or missing model answers cannot be offered as ranked alternatives',()=>{
  const evaluation=evaluateActions(candidates,pos,{'use_edit-block':score(3),use_compose:score(0),use_reuse:{...score(2),confidence:.01}});
  assert.deepEqual(evaluation.ranked.map(a=>a.id),['edit-block']);assert.deepEqual(nextToolbarActions(evaluation.ranked,['edit-block'],candidates),[]);
});
test('More removes duplicates and newly ineligible actions without another assessment',()=>{
  const ranked=candidates.slice(0,5);assert.deepEqual(nextToolbarActions([...ranked,ranked[0]],[ranked[0].id],[ranked[1],ranked[3]]).map(a=>a.id),[ranked[1].id,ranked[3].id]);
});
test('the palette includes utilities and eligible output formats regardless of recommendation',()=>{
  assert.ok(paletteActions('',candidates).some(a=>a.id==='ui:workspaces'));
  assert.deepEqual(paletteActions('image',candidates).map(a=>a.id),['image']);
  assert.deepEqual(paletteActions('image',candidates.filter(a=>a.id!=='image')),[]);
  assert.deepEqual(paletteActions('an unrecognized creative request',candidates),[]);
  assert.equal(finderEntry('export'),'view-result');assert.equal(finderEntry('lock'),'context');
});


test('variation terminology resolves to Add idea without a duplicate palette option',()=>{
  assert.deepEqual(paletteActions('variation',ACTIONS).map(a=>a.id),['add-context']);
  assert.equal(paletteActions('',ACTIONS).filter(a=>['add-context','surprise'].includes(a.id)).length,1);
});
