import type { CreativeImageOptions } from './openai-adapter.ts';
import type { EventExecutionControl } from './events-api.ts';
import type { WorkerEnv } from './runtime.ts';
import type { ProjectExecutionScope } from './pilot-policy.ts';
import { storeGeneratedImage } from './media-api.ts';
import { prepareProjectResourceScopeStatement } from './project-access.ts';

/** Optional visual feedback uses the existing job and private media lifetime.
 * Quoted Output contracts and providers without partials retain status-only UI. */
export function imagePreviewOptions(env: WorkerEnv, input: {
  execution?: EventExecutionControl; ownerId: string; generationId: string;
  model: string; provider: string; adapter: string; projectScope?: ProjectExecutionScope;
}): Pick<CreativeImageOptions, 'partialImages' | 'onPartial'> {
  const { execution } = input;
  if (!execution || execution.output || input.provider !== 'openai') return {};
  return { partialImages: 1, onPartial: async partial => {
    let timer:ReturnType<typeof setTimeout>|undefined;
    const publish=async()=>{
    execution.signal.throwIfAborted();
    if (!partial.bytes.length || !Number.isSafeInteger(partial.index) || partial.index < 0) return;
    let media;
    try {
      // A late optional write must never overwrite final-image custody.
      media = await storeGeneratedImage(env, input.ownerId, `${input.generationId}-partial`, partial.bytes, input.model, partial.mimeType, { provider: input.provider, adapter: input.adapter });
      if (input.projectScope) await prepareProjectResourceScopeStatement(env, input.projectScope, {
        kind: 'media', id: media.key, visibility: 'collaborative_output', sourceEventId: null, actorUserId: input.projectScope.actorUserId,
      }, new Date().toISOString()).run();
    } catch(error) {
      // An optional preview storage failure must not discard the paid final
      // response. Cancellation and job-authority failures still stop execution.
      execution.signal.throwIfAborted();
      if(isImageExecutionAuthorityError(error))throw error;
      return;
    }
    execution.signal.throwIfAborted();
    try { await execution.progress('rendering', 'Generating…', {
      partialMediaUrl: `${media.url}?partial=${partial.index}`, partialMediaType: media.mimeType,
      partialWidth: partial.width, partialHeight: partial.height, partialIndex: partial.index,
      generationId: input.generationId,
    }); } catch(error) {
      execution.signal.throwIfAborted();
      if(isImageExecutionAuthorityError(error))throw error;
    }
    };
    try { await Promise.race([publish(),new Promise<void>(resolve=>{timer=setTimeout(resolve,500);})]); }
    finally { if(timer)clearTimeout(timer); }
  } };
}

/** Optional UI failures may degrade; execution authority is never optional. */
export function isImageExecutionAuthorityError(error:unknown) {
  return error instanceof Error && (error.name==='AbortError' || /^(document_job_(?:canceled|lease_lost)|output_.*(?:authority|lease|cancel)|project_.*(?:revoked|denied|unauthorized))$/.test(error.message));
}
