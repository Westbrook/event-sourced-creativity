import { css } from 'lit';
import { token as t } from './internal/values.js';
import { sizedStyles } from './internal/sizing.js';
export const richTextEditorStyles = sizedStyles(css `
 .editor{font: ${t('--en-font-body-weight')} ${t('--en-font-body-size')} / ${t('--en-font-body-line-height')} ${t('--en-font-body-family')}; font-style: ${t('--en-font-body-style')}; letter-spacing: ${t('--en-font-body-tracking')};white-space:pre-wrap;position:relative;word-wrap:break-word;font-variant-ligatures:none;font-feature-settings:"liga" 0;}
 .editor p{margin:0 0 ${t('--en-space-4')};min-block-size:1em;}
 .editor h1,.editor h2,.editor h3{margin:${t('--en-space-4')} 0 ${t('--en-space-2')};}
.editor h1{font: ${t('--en-font-heading-large-weight')} ${t('--en-font-heading-large-size')} / ${t('--en-font-heading-large-line-height')} ${t('--en-font-heading-large-family')}; font-style: ${t('--en-font-heading-large-style')}; letter-spacing: ${t('--en-font-heading-large-tracking')};}
.editor h2{font: ${t('--en-font-heading-medium-weight')} ${t('--en-font-heading-medium-size')} / ${t('--en-font-heading-medium-line-height')} ${t('--en-font-heading-medium-family')}; font-style: ${t('--en-font-heading-medium-style')}; letter-spacing: ${t('--en-font-heading-medium-tracking')};}
.editor h3{font: ${t('--en-font-heading-small-weight')} ${t('--en-font-heading-small-size')} / ${t('--en-font-heading-small-line-height')} ${t('--en-font-heading-small-family')}; font-style: ${t('--en-font-heading-small-style')}; letter-spacing: ${t('--en-font-heading-small-tracking')};}
 .editor > :first-child{margin-block-start:0;}.editor > :last-child{margin-block-end:0;}
 .editor ul,.editor ol{padding-inline-start:${t('--en-space-6')};margin-block:${t('--en-space-2')};}
 .editor li{position:relative;}.editor li p{margin-block:.25em;}
 .editor a{color:var(--en-color-link,var(--en-color-action));text-decoration:underline;cursor:text;}
 .range-decoration{background:Highlight;color:HighlightText;}
 .ProseMirror-selectednode{outline:2px solid ${t('--en-color-action')};}
 .ProseMirror-hideselection *::selection{background:transparent;}.ProseMirror-hideselection{caret-color:transparent;}
 .ProseMirror-gapcursor{display:none;pointer-events:none;position:absolute;}
 .editor[contenteditable=false]{cursor:default;}
`);
