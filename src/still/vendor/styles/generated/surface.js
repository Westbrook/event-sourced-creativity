// Generated from src/css/surface.css; edit the CSS source.
import { css } from 'lit';
import { sizedStyles } from '../internal/sizing.js';
export const surfaceStyles = sizedStyles(css `.en-panel, .en-card {
  min-inline-size: 0;
  padding: var(--en-surface-padding, var(--_en-sized-space-panel, var(--en-space-panel, 1.5rem)));
  border: var(--en-border-width, 1px) solid var(--en-surface-border-color, var(--en-color-line, rgb(214 220 228 / 1)));
  border-radius: var(--en-surface-radius, var(--_en-sized-radius-container, var(--en-radius-container, 1rem)));
  background: var(--en-surface-background, var(--en-color-surface, rgb(255 255 255 / 1)));
  color: var(--en-surface-color, var(--en-color-text, rgb(27 31 36 / 1)));
  box-shadow: var(--en-surface-shadow, none);
}
.en-card {
  box-shadow: var(--en-card-shadow, var(--en-surface-shadow, none));
  display: flex;
  flex-direction: column;
  gap: var(--en-space-4, 1rem);
  background: var(--en-card-background, var(--en-surface-background, var(--en-color-surface, rgb(255 255 255 / 1))));
}
.en-card__header, .en-card__body, .en-card__footer { min-inline-size: 0; }
.en-card__header { font-weight: var(--en-font-label-strong-weight, 600); }
.en-card__footer { display: flex; align-items: center; flex-wrap: wrap; gap: var(--_en-sized-space-actions, var(--en-space-actions, 0.375rem)); }
.en-card__footer > slot { display: contents; }
.en-inset-surface {
  border-radius: var(--en-inset-child-radius, max(0px, var(--en-inset-outer-radius, var(--_en-sized-radius-container, var(--en-radius-container, 1rem))) - var(--en-inset-distance, var(--en-space-2, 0.5rem))));
}
.en-divider { margin: 0; border: 0; border-block-start: var(--en-border-width, 1px) solid var(--en-divider-color, var(--en-color-line, rgb(214 220 228 / 1))); }
.en-divider[aria-orientation='vertical'] { align-self: stretch; border-block-start: 0; border-inline-start: var(--en-border-width, 1px) solid var(--en-divider-color, var(--en-color-line, rgb(214 220 228 / 1))); }
@media (forced-colors: active) {
  .en-panel, .en-card { color: CanvasText; background: Canvas; border-color: CanvasText; box-shadow: none; }
  .en-divider { border-color: CanvasText; box-shadow: none; }
}
`);
