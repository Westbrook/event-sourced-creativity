import { controlTargetSize } from './internal/target-size.js';
import { css } from 'lit';
import { sizedStyles } from './internal/sizing.js';
import { token as t, override as o } from './internal/values.js';
import { focusStyles } from './internal/focus.js';
export { surfaceStyles } from './generated/surface.js';
/** Intrinsic layout recipes. Only .en-query-region opts into size containment. */
export const layoutStyles = sizedStyles(css `
  .en-stack { display: flex; flex-direction: column; gap: ${o('--en-stack-gap', t('--en-space-rows'))}; min-inline-size: 0; }
  .en-stack[data-direction='horizontal'] { flex-direction: row; align-items: center; }
  .en-stack[data-align='start'] { align-items: flex-start; }
  .en-stack[data-align='center'] { align-items: center; }
  .en-stack[data-align='end'] { align-items: flex-end; }
  .en-stack[data-align='stretch'] { align-items: stretch; }
  .en-stack[data-justify='start'] { justify-content: flex-start; }
  .en-stack[data-justify='center'] { justify-content: center; }
  .en-stack[data-justify='end'] { justify-content: flex-end; }
  .en-stack[data-justify='between'] { justify-content: space-between; }
  .en-stack[data-wrap], .en-stack[data-wrap='true'] { flex-wrap: wrap; }
  .en-stack[data-wrap='false'] { flex-wrap: nowrap; }
  .en-stack[data-gap='small'] { gap: ${o('--en-stack-gap', t('--en-space-2'))}; }
  .en-stack[data-gap='medium'] { gap: ${o('--en-stack-gap', t('--en-space-4'))}; }
  .en-stack[data-gap='large'] { gap: ${o('--en-stack-gap', t('--en-space-6'))}; }
  .en-cluster { display: flex; align-items: center; flex-wrap: wrap; gap: ${o('--en-cluster-gap', t('--en-space-actions'))}; min-inline-size: 0; }
  .en-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, ${o('--en-grid-item-min', t('--en-layout-form-max'))}), 1fr)); gap: ${o('--en-grid-gap', t('--en-space-4'))}; min-inline-size: 0; }
  .en-stack > slot, .en-cluster > slot, .en-grid > slot { display: contents; }
  .en-stack > *, .en-cluster > *, .en-grid > * { min-inline-size: 0; }
  .en-scroll-region { min-inline-size: 0; min-block-size: 0; overflow: auto; scrollbar-gutter: stable; }
  .en-query-region { container-type: inline-size; container-name: en-layout; }
  .en-split-view {
    --_en-split-target:max(${t('--en-size-splitter')},${controlTargetSize(false, t('--en-size-target-min'))});
    display: grid;
    isolation: isolate;
    grid-template-columns: minmax(0, calc((100% - var(--_en-split-target)) * var(--en-split-ratio, 0.5))) var(--_en-split-target) minmax(0, 1fr);
    min-inline-size: 0;
    min-block-size: 0;
  }
  .en-split-view[data-orientation='vertical'] { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, calc((100% - var(--_en-split-target)) * var(--en-split-ratio, 0.5))) var(--_en-split-target) minmax(0, 1fr); }
  @media (any-pointer: coarse) { .en-split-view { --_en-split-target:max(${t('--en-size-splitter')},${controlTargetSize(true, t('--en-size-target-min'))}); } }
  .en-split-pane { min-inline-size: 0; min-block-size: 0; overflow: auto; }
  .en-split-handle { display: block; min-inline-size: 0; min-block-size: 0; }
  /* Raise only the focused grid item above adjacent pane surfaces, locally. */
  .en-split-view > .en-split-handle:focus-visible { z-index: 1; }
  .en-split-separator { display: grid; place-items: center; inline-size: 100%; block-size: 100%; min-inline-size: 0; min-block-size: 0; cursor: col-resize; }
  .en-split-grip { inline-size: ${t('--en-border-width')}; block-size: 100%; background: ${t('--en-color-boundary')}; }
  .en-split-separator[data-orientation='horizontal'], :host([role='separator'][aria-orientation='horizontal']) .en-split-separator { cursor: row-resize; }
  .en-split-separator[data-orientation='horizontal'] .en-split-grip, :host([role='separator'][aria-orientation='horizontal']) .en-split-grip { inline-size: 100%; block-size: ${t('--en-border-width')}; }
  ${focusStyles}
  @media (forced-colors: active) { .en-split-grip { background: ButtonText; } }
`);
