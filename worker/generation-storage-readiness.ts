import type { WorkerEnv } from './runtime.ts';
import { nativeMemoryAnswerExclusion } from './memory-native-boundary.ts';
/** Read-only service check. It neither reserves allowance nor authorizes generation. */
export async function generationReadiness(env: WorkerEnv) {
  const db=env.DB;
  try {
    const guard=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
    if(env.DB!==db)throw new Error('memory_boundary_database_changed');
    const ready=await db.prepare(`SELECT 1 AS ready FROM (SELECT '' AS content_id, '' AS kind) private_content WHERE ${guard.sql}`).bind(...guard.bindings).first();
    if(env.DB!==db||!ready)throw new Error('generation_preparation_unavailable');
    return {ready:true,code:'ready' as const,message:'Storage preparation is ready. Review your current document before starting a new paid request. Other admission checks still apply.'};
  } catch {
    return {ready:false,code:'generation_preparation_unavailable' as const,message:'Forma’s storage preparation is unavailable. No generation was started. Contact support or check again later; changing your prompt will not fix this service problem.'};
  }
}
