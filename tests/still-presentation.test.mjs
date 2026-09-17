import test from 'node:test';
import assert from 'node:assert/strict';
import { presentActions, presentEvidence } from '../src/still/presentation.ts';
const score=(value,confidence=.75)=>({type:'score',score:value,confidence,probabilities:{0:0,1:0,2:3-value,3:value-2}});
const leads=rows=>Object.entries(rows).filter(([,v])=>v.variant==='primary').map(([id])=>id);
test('moderate clear evidence earns one primary, even when policy placed it second',()=>{
  const rows=presentActions(['first','best','third'],{use_first:score(2.1),use_best:score(2.4,.7),use_third:score(2)});
  assert.deepEqual(leads(rows),['best']);assert.deepEqual(Object.keys(rows),['first','best','third']);
  assert.match(rows.best.reason,/score 2.40.*confidence 70%.*lead 0.30/);
});
test('each evidence gate prevents weak or ambiguous primaries',()=>{
  const good={score:2.4,confidence:.7,usefulProbability:.8},rival={score:2.1,confidence:.9,usefulProbability:1};
  for(const bad of [{score:2.39},{confidence:.69},{usefulProbability:.79},{usefulProbability:undefined},{score:NaN},{confidence:2}])assert.deepEqual(leads(presentEvidence(['a','b'],{a:{...good,...bad},b:rival})),[]);
  for(const b of [{...rival,score:2.11},{...rival,score:2.4},{score:2.1},{confidence:.9}])assert.deepEqual(leads(presentEvidence(['a','b'],{a:good,b})),[]);
  assert.deepEqual(leads(presentEvidence(['a','b'],{a:good})),[]);
  assert.deepEqual(leads(presentEvidence(['a','a'],{a:good})),['a']);
});
test('visible toolbar sets are reevaluated using retained evidence, including More',()=>{
  const all=presentActions(['a','b','c'],{use_a:score(2.8,.9),use_b:score(2.6,.8),use_c:score(2.2)});
  assert.deepEqual(leads(all),[]);
  assert.deepEqual(leads(presentEvidence(['b','c'],all)),['b']);
  assert.deepEqual(leads(presentEvidence(['c'],all)),[]);
  assert.deepEqual(leads(presentEvidence(['b','c'],presentActions(['a','b','c']))),[]);
  assert.deepEqual(leads(presentEvidence(['a'],{a:{score:3,confidence:.9}})),[]);
});
test('format prefix and malformed distribution safeguards remain intact',()=>{
  assert.deepEqual(leads(presentActions(['image','scene'],{fit_image:score(2.5),fit_scene:score(2.1)},'fit_')),['image']);
  for(const probabilities of [{0:0,1:0,2:0,3:2},{0:0,1:.3,2:.3,3:.4},undefined])assert.deepEqual(leads(presentActions(['a','b'],{use_a:{...score(2.8),probabilities},use_b:score(2.1)})),[]);
});
