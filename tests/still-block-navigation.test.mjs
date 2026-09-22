import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTIONS,evaluateActions,questionsFor} from '../src/still/decisions.ts';
import {pageToolbarCandidates,withDocumentReturn} from '../src/still/local-policy.ts';
import {toolbarDecisionContext,nextBestOrder} from '../src/still/next-best.ts';
import {paletteActions} from '../src/still/finder.ts';
const pos={view:'document',projectId:'p',documentId:'d',blockId:'b',outputId:'',intent:'',recentActions:['completed:edit-block']};
const candidates=ACTIONS.filter(a=>['rename','context','edit-block','research-context','create','documents','use-in'].includes(a.id));
const score=n=>({type:'score',score:n,confidence:.95});
test('focused idea maintenance stays in the palette; Jev sees the parent-document continuation',()=>{
 const answers=Object.fromEntries(candidates.map(a=>[`use_${a.id}`,score(a.id==='rename'?3:a.id==='context'?0:2)]));
 const ranked=evaluateActions(candidates,pos,answers);
 assert.ok(!ranked.ranked.some(a=>a.id==='rename'));
 assert.ok(!questionsFor(candidates,pos).use_rename);
 assert.ok(!Object.hasOwn(questionsFor(candidates,pos).next_best_action.criteria,'rename'));
 assert.ok(paletteActions('',candidates).some(a=>a.id==='rename'));
 const palette={...pos,palette:{entry:'keyboard',surface:'main',primaryIds:[],secondaryIds:[]}};
 assert.ok(questionsFor(candidates,palette).use_rename);
 assert.ok(evaluateActions(candidates,palette,answers).ranked.some(a=>a.id==='rename'));
 assert.ok(questionsFor(candidates,{...pos,blockId:''}).use_rename);
 const context=toolbarDecisionContext(pos,candidates);
 assert.match(context.continuation,/View document.*Choose output/);
 assert.equal(context.navigation.action,'context');
});
test('parent navigation survives low scores, next-best reordering, and every toolbar density without forged scores',()=>{
 const ranked=candidates.filter(a=>!['context','rename'].includes(a.id));
 const nominated=nextBestOrder(ranked.slice(0,4),ranked,{accepted:true,choice:'create'});
 for(let slots=1;slots<=6;slots++){
  const visible=withDocumentReturn(nominated,candidates,pos,slots);
  assert.ok(visible.some(a=>a.id==='context'));
  assert.ok(visible.length<=slots);
  assert.equal(new Set(visible.map(a=>a.id)).size,visible.length);
  assert.ok(!visible.some(a=>a.id==='rename'));
  if(slots>1)assert.equal(visible[0].id,'create');
 }
 assert.deepEqual(withDocumentReturn(ranked,candidates,{...pos,blockId:''}),ranked.slice(0,4));
 assert.ok(!withDocumentReturn(ranked,candidates.filter(a=>a.id!=='context'),pos).some(a=>a.id==='context'));
 assert.deepEqual(pageToolbarCandidates(candidates,{...pos,view:'choose-format'}),candidates);
});
