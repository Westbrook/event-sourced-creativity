import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanExplicitGoal, cleanSurfaceContext, type SurfaceContext } from '../src/still/workflow-state.ts';

test('surface hints retain workflow state without changing boolean meaning',()=>{
  const state: SurfaceContext = {
    version:1,surface:'palette',mode:'generate',step:'review',dirtyDraft:true,pendingOperation:false,
    blockingReview:true,interactionLocked:true,selectedParameters:{format:'slides',kind:'direction',itemCount:4},
    readiness:{hasContext:true,hasSelection:false,inputsComplete:true,canSubmit:false},
    visibleActionIds:['context','create'],selectedTargetIds:['block-123'],returnPath:{view:'document'},targetRevision:0,
  };
  assert.deepEqual(cleanSurfaceContext(state),state);
  assert.deepEqual(cleanSurfaceContext(cleanSurfaceContext(state)),state);
});

test('surface hint cleaner excludes untrusted prose, URLs and unknown fields',()=>{
  const state = cleanSurfaceContext({
    version:1,surface:'workflow',mode:'Use the private provider',step:'https://private.invalid',dirtyDraft:'false',
    prompt:'PRIVATE PROMPT',goal:'INFERRED GOAL',selectedParameters:{format:'https://private.invalid',kind:'UNTRUSTED',itemCount:41,prompt:'PRIVATE PROMPT'},
    readiness:{hasContext:true,canSubmit:1,reason:'PRIVATE REASON'},
    visibleActionIds:['create','create','https://private.invalid','PRIVATE PROMPT','data:private','edit-block'],
    selectedTargetIds:['block-123','../private','block/secret'],returnPath:{view:'document',url:'https://private.invalid'},targetRevision:1.5,
  });
  assert.deepEqual(state,{version:1,surface:'workflow',readiness:{hasContext:true},visibleActionIds:['create','edit-block'],selectedTargetIds:['block-123'],returnPath:{view:'document'}});
  assert.doesNotMatch(JSON.stringify(state),/PRIVATE|private|UNTRUSTED|INFERRED/);
});

test('surface hints reject missing versions, unknown surfaces and malformed structures',()=>{
  for (const input of [null,[],false,{}, {surface:'main'},{version:2,surface:'main'},{version:1,surface:'unknown'}]) assert.equal(cleanSurfaceContext(input),undefined);
  assert.deepEqual(cleanSurfaceContext({version:1,surface:'main',selectedParameters:[],readiness:[],returnPath:{view:'https://private.invalid'},targetRevision:Infinity}),{version:1,surface:'main'});
});

test('surface hints cap identifiers and reject invalid numeric boundaries',()=>{
  const ids = Array.from({length:60},(_,i)=>`action-${i}`);
  assert.equal(cleanSurfaceContext({version:1,surface:'main',visibleActionIds:ids})?.visibleActionIds?.length,40);
  assert.deepEqual(cleanSurfaceContext({version:1,surface:'main',selectedTargetIds:['x'.repeat(180),'x'.repeat(181)]})?.selectedTargetIds,['x'.repeat(180)]);
  for (const itemCount of [0,-1,1.5,41,Infinity,NaN,'4']) assert.equal(cleanSurfaceContext({version:1,surface:'formats',selectedParameters:{itemCount}})?.selectedParameters,undefined);
  for (const itemCount of [1,40]) assert.equal(cleanSurfaceContext({version:1,surface:'formats',selectedParameters:{itemCount}})?.selectedParameters?.itemCount,itemCount);
});

test('surface hints retain only authorized eligible action IDs when supplied',()=>{
  assert.deepEqual(cleanSurfaceContext({version:1,surface:'main',visibleActionIds:['create','edit-block','foreign-action'],selectedTargetIds:['block-123']},['edit-block']),{
    version:1,surface:'main',visibleActionIds:['edit-block'],selectedTargetIds:['block-123'],
  });
  assert.deepEqual(cleanSurfaceContext({version:1,surface:'main',visibleActionIds:['create']},[])?.visibleActionIds,[]);
});

test('explicit goal preserves bounded user-authored intent and criteria only',()=>{
  assert.deepEqual(cleanExplicitGoal({source:'explicit-user',text:'  Explore a quiet landscape.  ',criteria:[' Keep two alternatives. ','Keep two alternatives.','','No lettering.'],inferredPreference:'PRIVATE'}),{
    source:'explicit-user',text:'Explore a quiet landscape.',criteria:['Keep two alternatives.','No lettering.'],
  });
  for (const input of [null,[],{source:'inferred',text:'Finish'},{source:'explicit-user',text:''},{source:'explicit-user',text:'x'.repeat(2001)}]) assert.equal(cleanExplicitGoal(input),undefined);
  assert.deepEqual(cleanExplicitGoal({source:'explicit-user',text:'x'.repeat(2000),criteria:['x'.repeat(241),...Array.from({length:8},(_,i)=>`Criterion ${i}`)]})?.criteria,['Criterion 0','Criterion 1','Criterion 2','Criterion 3']);
});
