import { controlTargetSize } from './internal/target-size.js';
import { css } from 'lit';
import { sizedStyles } from './internal/sizing.js';
import { token as t, override as o } from './internal/values.js';
import { focusStylesFor, focusClearance } from './internal/focus-core.js';
export const carouselStyles = sizedStyles(css `
 :host{display:block;min-inline-size:0}
 :host([hidden]),[hidden]{display:none!important}
 .base{display:grid;gap:${o('--en-carousel-gap', t('--en-space-3'))};min-inline-size:0}
 .viewport{display:flex;gap:${o('--en-carousel-gap', t('--en-space-3'))};overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x mandatory;scroll-padding-inline:${focusClearance};padding:${focusClearance};min-inline-size:0;border-radius:${o('--en-carousel-radius', t('--en-radius-container'))};direction:inherit}
 .viewport[data-controls-ready]{scrollbar-width:none}
 .viewport>slot{display:contents}
 .viewport>slot::slotted(en-carousel-slide){flex:0 0 calc((100% - (max(1,${o('--en-carousel-slides-per-view', css `var(--_en-carousel-per-view,1)`)}) - 1)*${o('--en-carousel-gap', t('--en-space-3'))})/max(1,${o('--en-carousel-slides-per-view', css `var(--_en-carousel-per-view,1)`)}));min-inline-size:0;scroll-snap-align:start;scroll-snap-stop:normal}
 .collection-track{position:relative;flex:0 0 auto;block-size:var(--en-carousel-viewport-size,22rem);min-inline-size:0}
 .collection-slide{position:absolute;inset-block:0;min-inline-size:0;scroll-snap-align:start;scroll-snap-stop:normal;overflow:auto}
 .viewport[data-collection]{scroll-snap-type:none}
 .viewport[data-list]{display:block;scroll-snap-type:none;overflow:visible}
 .reading-list{display:grid;gap:${t('--en-space-3')};margin:0;padding-inline-start:2rem;min-inline-size:0}
 .reading-list>li{min-inline-size:0}
 .controls{display:flex;align-items:center;justify-content:center;gap:${o('--en-carousel-gap', t('--en-space-3'))};flex-wrap:wrap}
 .position{font-variant-numeric:tabular-nums;text-align:center;min-inline-size:6ch;color:${t('--en-color-text-muted')}}
 .picker{display:flex;gap:${t('--en-space-2')};min-inline-size:0;overflow-x:auto;overscroll-behavior-inline:contain;padding:${focusClearance};scroll-padding-inline:${focusClearance}}
 .controls[data-boundaries]{display:grid;grid-template-columns:auto auto minmax(0,auto) auto auto;gap:${t('--en-space-2')};min-inline-size:0}
 .controls[data-boundaries] .position{min-inline-size:0}
 .base>en-tooltip{position:absolute}
 .picker-range{color:${t('--en-color-text-muted')};font-variant-numeric:tabular-nums;text-align:center}
 .picker[data-bounded]{display:grid;grid-template-columns:repeat(var(--_en-picker-count),minmax(max(2.75rem,${controlTargetSize()}),1fr));inline-size:100%;max-inline-size:44rem;box-sizing:border-box;justify-self:center}
 .picker[data-bounded] .picker-button{display:flex;flex-direction:column;gap:${t('--en-space-1')};min-inline-size:max(2.75rem,${controlTargetSize()})}
 .picker[data-bounded] .thumbnail{inline-size:100%;block-size:auto;aspect-ratio:20/11}
 .picker-number{font-variant-numeric:tabular-nums;line-height:1.4}
 .picker-button{flex:0 0 auto;min-inline-size:max(2.75rem,${controlTargetSize()});min-block-size:max(2.75rem,${controlTargetSize()});position:relative}
 .picker-button[aria-current=true]{background:${t('--en-color-selected')};color:${t('--en-color-text')};border-color:${t('--en-color-action')}}
 .picker-button[aria-current=true]::after{content:"";position:absolute;inset-inline:.4rem;inset-block-end:.15rem;block-size:3px;background:currentColor;border-radius:2px}
 .picker-button:has(.thumbnail){padding:.3rem}
 .thumbnail{display:block;inline-size:5rem;block-size:2.75rem;object-fit:cover;border-radius:${t('--en-radius-control')};pointer-events:none}
 @media(any-pointer:coarse){.picker[data-bounded]{grid-template-columns:repeat(var(--_en-picker-count),minmax(max(2.75rem,${controlTargetSize(true)}),1fr))}.picker-button,.picker[data-bounded] .picker-button{min-inline-size:max(2.75rem,${controlTargetSize(true)});min-block-size:max(2.75rem,${controlTargetSize(true)})}}
 @media(forced-colors:active){.picker-button[aria-current=true]{background:Highlight;color:HighlightText;border-color:HighlightText}}
 .rotation{justify-self:start}
 :host(:dir(rtl)) .arrow{transform:scaleX(-1)}
 ${focusStylesFor(css `.viewport`)}
`);
export const carouselSlideStyles = sizedStyles(css `
 :host{display:block;min-inline-size:0}
 :host([hidden]){display:none!important}
 .slide{height:100%;box-sizing:border-box;border:${t('--en-border-width')} solid ${o('--en-carousel-border-color', t('--en-color-line'))};border-radius:${o('--en-carousel-radius', t('--en-radius-container'))};background:${o('--en-carousel-background', t('--en-color-surface'))};color:${t('--en-color-text')}}
 @media(forced-colors:active){.slide{background:Canvas;color:CanvasText;border-color:CanvasText}}
`);
