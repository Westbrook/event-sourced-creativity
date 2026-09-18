import {measureRetainedState,RETAINED_STATE_LIMITS,RetainedStateCapacityError} from '../src/model/retained-state.ts';
import {OutputConflictError} from './output-command-core.ts';
import {recordOutputProofCapacity} from './output-proof-capacity-diagnostic.ts';
export const SCENE_RETAINED_STATE_LIMITS=RETAINED_STATE_LIMITS;
export function sceneRetainedStateCheck<T>(check:()=>T):T{
  try{return check();}catch(error){if(error instanceof RetainedStateCapacityError)throw recordOutputProofCapacity(new OutputConflictError('output_source_proof_too_large',413),'scene_retained_state_capacity');throw error;}
}
export const measureSceneRetainedState=(roots:unknown,limits=SCENE_RETAINED_STATE_LIMITS)=>sceneRetainedStateCheck(()=>measureRetainedState(roots,limits));
