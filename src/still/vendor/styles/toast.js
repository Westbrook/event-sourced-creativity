import { css, unsafeCSS } from 'lit';
import { sizedStyles } from './internal/sizing.js';
import { token as t } from './internal/values.js';
import { focusVisibleStylesFor } from './internal/focus.js';
export const toastStyles = sizedStyles(css `
 .en-toast { --_toast-background:var(--en-toast-background, ${t('--en-color-surface')});--_toast-color:var(--en-toast-color, ${t('--en-color-text')});--_toast-icon-color:var(--en-toast-icon-color,currentColor);display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:${t('--en-space-3')};padding:var(--en-toast-padding, ${t('--en-space-panel')});border:${t('--en-border-width')} solid var(--en-toast-border-color, ${t('--en-color-line')});border-radius:var(--en-toast-radius, ${t('--en-radius-container')});background:var(--_toast-background);color:var(--_toast-color);box-shadow:var(--en-toast-shadow,none);min-inline-size:0; }
 .en-toast[hidden] { display:none; }
 ${['info', 'success', 'warning', 'danger'].map(variant => css `
   .en-toast[data-variant=${unsafeCSS(variant)}] {
    --_toast-background:var(${unsafeCSS(`--en-toast-${variant}-background`)},var(--en-toast-background,${t('--en-color-surface')}));
    --_toast-color:var(${unsafeCSS(`--en-toast-${variant}-color`)},var(--en-toast-color,${t('--en-color-text')}));
    --_toast-icon-color:var(${unsafeCSS(`--en-toast-${variant}-icon-color`)},var(--en-toast-icon-color,${t(variant === 'info' ? '--en-color-action-text' : `--en-color-${variant}-text`)}));
    border-color:var(${unsafeCSS(`--en-toast-${variant}-border-color`)},var(--en-toast-border-color,${t('--en-color-line')}));
   }
 `).reduce((all, rule) => css `${all}${rule}`, css ``)}
 .en-toast__icon { grid-column:1;grid-row:1;color:var(--_toast-icon-color);display:flex;align-items:center;min-block-size:1.5em; }
 .en-toast__close { grid-column:3;grid-row:1;--en-button-color:var(--_toast-color);--en-button-border-color:transparent;--en-button-background:color-mix(in srgb,var(--_toast-color) 12%,var(--_toast-background));--en-button-focus-color:var(--_toast-color);--en-button-focus-halo-color:var(--_toast-background); }
 .en-toast__body { display:contents; }
 .en-toast__content { grid-column:2;grid-row:1;min-inline-size:0;overflow-wrap:anywhere; }
 .en-toast__actions { grid-column:2;grid-row:2;min-inline-size:0;display:flex;flex-wrap:wrap;gap:${t('--en-space-actions')}; }
 .en-toast__actions ::slotted(*) { margin-block-start:${t('--en-space-3')}; }
 .en-toast en-button { flex:none; }
 .en-toast-region { display:grid;gap:var(--en-toast-region-gap, ${t('--en-space-3')});max-block-size:var(--en-toast-region-max-size,min(60dvh,32rem));overflow:auto;padding:${t('--en-space-2')};scrollbar-gutter:stable; }
 :host([swipe]) .en-toast { touch-action:pan-y;transform:translateX(var(--_en-toast-swipe-offset,0px)); }
 :host([placement^='block-start']),:host([placement^='block-end']) { position:fixed;z-index:var(--en-toast-region-layer,100);inset-inline-end:max(1rem,env(safe-area-inset-left),env(safe-area-inset-right));inline-size:min(var(--en-toast-region-width,24rem),calc(100% - 2rem)); }
 :host([placement^='block-start']) { inset-block-start:max(1rem,env(safe-area-inset-top)); }
 :host([placement^='block-end']) { inset-block-end:calc(max(1rem,env(safe-area-inset-bottom)) + var(--_en-toast-keyboard-inset,0px)); }
 :host([placement='block-start-start']),:host([placement='block-end-start']) { inset-inline-start:max(1rem,env(safe-area-inset-left),env(safe-area-inset-right));inset-inline-end:auto; }
 :host([placement$='-center']) { inset-inline:0;margin-inline:auto; }
 :host([placement^='block-start']) .en-toast-region,:host([placement^='block-end']) .en-toast-region { max-block-size:min(var(--en-toast-region-max-size,min(60dvh,32rem)),calc(100dvh - var(--_en-toast-keyboard-inset,0px) - 2rem)); }
 .en-toast-region__history { min-inline-size:0;padding:var(--en-toast-padding,${t('--en-space-panel')});border:${t('--en-border-width')} solid ${t('--en-color-line')};border-radius:var(--en-toast-radius,${t('--en-radius-container')});background:${t('--en-color-surface')};color:${t('--en-color-text')}; }
 .en-toast-region__history summary { cursor:pointer; }
 .en-toast-region__history h3 { font:inherit;font-weight:600;margin-block:${t('--en-space-3')}; }
 .en-toast-region__history ol { padding-inline-start:1.5em; }
 .en-toast-region__history li { overflow-wrap:anywhere;margin-block:${t('--en-space-2')}; }
 :host([data-en-toast-stack]) .en-toast { position:relative;isolation:isolate;margin-block-end:calc(2 * var(--en-toast-stack-offset,${t('--en-space-1')})); }
 :host([data-en-toast-stack]) .en-toast::before,:host([data-en-toast-stack='2']) .en-toast::after {
  content:'';position:absolute;pointer-events:none;z-index:-1;inset:0;border:inherit;border-radius:inherit;background:inherit;
  transform:translateY(var(--en-toast-stack-offset,${t('--en-space-1')})) scaleX(.96);
  clip-path:inset(calc(100% - var(--en-toast-stack-offset,${t('--en-space-1')})) -2px -100% -2px);
 }
 :host([data-en-toast-stack='2']) .en-toast::after { z-index:-2;transform:translateY(calc(2 * var(--en-toast-stack-offset,${t('--en-space-1')}))) scaleX(.92); }
 .en-toast-region__summary { color:${t('--en-color-text-muted')};font-size:${t('--en-font-ui-size')}; }
 .en-toast-region__summary[hidden] { display:none; }
 .en-toast__sr { position:absolute;inline-size:1px;block-size:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0; }
 ${focusVisibleStylesFor(css `.en-toast-region:focus-visible,.en-toast-region__history summary:focus-visible`)}
 @media (prefers-reduced-motion:no-preference) { .en-toast { animation:en-toast-in ${t('--en-duration-enter')} ${t('--en-ease-enter')}; } @keyframes en-toast-in { from {opacity:0;translate:0 ${t('--en-motion-surface-offset')};} to {opacity:1;translate:0 0;} } }
 @media (forced-colors:active) { .en-toast[data-variant] { background:Canvas;color:CanvasText;border-color:CanvasText; } }
`);
