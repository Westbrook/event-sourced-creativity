import { html } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import type { ImageGenerationProgress } from '../model/image-generation-progress.ts';
import type { FormaLocaleController } from './design-system/localization.ts';

const statusKeys = { 'Queued': 'image.progress.queued', 'Preparing…': 'image.progress.preparing', 'Generating…': 'image.progress.generating', 'Saving…': 'image.progress.saving' } as const;

/** One quiet caption, shared by Forma's image surfaces. */
export function imageGenerationPreview(progress: ImageGenerationProgress, locale: FormaLocaleController) {
  return html`<div class="streaming-preview">
    <div class="streaming-preview-frame" aria-busy="true" style=${`aspect-ratio:${progress.width}/${progress.height}`}>
      ${progress.mediaUrl ? keyed(progress.mediaUrl, html`<img class="streaming-preview-image" src=${progress.mediaUrl} width=${progress.width} height=${progress.height} alt=${locale.system('Early image preview still being refined')} decoding="async">`) : html`<div class="streaming-preview-placeholder" aria-hidden="true"></div>`}
    </div>
    <span role="status" aria-live="polite">${locale.t(statusKeys[progress.status])}</span>
  </div>`;
}
