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
    execution.signal.throwIfAborted();
    if (!partial.bytes.length || !Number.isSafeInteger(partial.index) || partial.index < 0) return;
    let media;
    try {
      // Final storage replaces this same object, avoiding a separate durable
      // preview artifact. The query suffix invalidates the displayed preview.
      media = await storeGeneratedImage(env, input.ownerId, input.generationId, partial.bytes, input.model, partial.mimeType, { provider: input.provider, adapter: input.adapter });
      if (input.projectScope) await prepareProjectResourceScopeStatement(env, input.projectScope, {
        kind: 'media', id: media.key, visibility: 'collaborative_output', sourceEventId: null, actorUserId: input.projectScope.actorUserId,
      }, new Date().toISOString()).run();
    } catch {
      // An optional preview storage failure must not discard the paid final
      // response. Cancellation and job-authority failures still stop execution.
      execution.signal.throwIfAborted();
      return;
    }
    execution.signal.throwIfAborted();
    await execution.progress('rendering', 'Generating…', {
      partialMediaUrl: `${media.url}?partial=${partial.index}`, partialMediaType: media.mimeType,
      partialWidth: partial.width, partialHeight: partial.height, partialIndex: partial.index,
      generationId: input.generationId,
    });
  } };
}
