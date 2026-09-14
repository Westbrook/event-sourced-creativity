import type {CreativeEvent} from '../src/model/events.ts';
import {createStandingConstraintsFold} from '../src/model/taste.ts';
import {createProductionWorkflowHistoryFold} from '../src/model/production-workflow.ts';
import {createAuthoritativeCreativeContextFold} from './context-authority.ts';
import {measureSceneRetainedState,sceneRetainedStateCheck,SCENE_RETAINED_STATE_LIMITS} from './scene-retained-state.ts';
import {combineRetainedStateMeasurements} from '../src/model/retained-state.ts';

/** Qualification-only complete context consumer. Source/authority certificates
 * belong to the reader; this factory cannot authorize a read or generation. */
export function createSceneContextConsumer(request:Parameters<typeof createAuthoritativeCreativeContextFold>[0],
  limits=SCENE_RETAINED_STATE_LIMITS){
  const authority=createAuthoritativeCreativeContextFold(request),constraints=createStandingConstraintsFold(),workflow=createProductionWorkflowHistoryFold();
  let finished=false,failed=false,failure:unknown,maximumRetainedBytes=0;
  const guarded=<T>(operation:()=>T):T=>{
    if(failed)throw failure;if(finished)throw new Error('scene_context_consumer_already_finished');
    try{return operation();}catch(error){failed=true;failure=error;throw error;}
  };
  const check=(result?:unknown)=>sceneRetainedStateCheck(()=>{
    const measured=combineRetainedStateMeasurements([authority.measureRetainedState(limits),constraints.measureRetainedState(limits),workflow.measureRetainedState(limits),
      ...(result===undefined?[]:[measureSceneRetainedState(result,limits)])],limits);
    maximumRetainedBytes=Math.max(maximumRetainedBytes,measured.bytes);return measured;
  });
  return {
    accept(event:CreativeEvent){
      return guarded(()=>{if(!authority.accept(event)||!constraints.accept(event)||!workflow.accept(event))throw new Error('scene_context_reducer_refused');return true;});
    },
    checkpoint(){return guarded(()=>check());},
    finish(){
      return guarded(()=>{
        check();const trusted=authority.finish(),standingConstraints=constraints.finish(),workflowEvents=workflow.finish();
        check([trusted,standingConstraints,workflowEvents]);finished=true;
        return {trusted,standingConstraints,workflowEvents,maximumRetainedBytes};
      });
    },
  };
}
