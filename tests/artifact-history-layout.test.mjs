import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
const declaration=selector=>{const start=css.indexOf(selector+' {');assert(start>=0,'Missing exact scoped rule '+selector);return css.slice(start+selector.length+2,css.indexOf('}',start));};
test('shared history wraps whole metadata/action groups rather than squeezing labels',()=>{
 assert.match(declaration('.artifact-revision-history > header'),/flex-wrap:\s*wrap/);
 assert.match(declaration('.artifact-revision-history > ol > li'),/flex-wrap:\s*wrap/);
 const metadata=declaration('.artifact-revision-history > ol > li > div:first-child');assert.match(metadata,/flex:\s*1 1 16rem/);assert.match(metadata,/min-inline-size:\s*0/);assert.match(metadata,/overflow-wrap:\s*anywhere/);
 const actions=declaration('.artifact-revision-history > ol > li > div + div');assert.match(actions,/align-items:\s*stretch/);assert.match(actions,/max-inline-size:\s*100%/);
});
test('native history actions preserve word boundaries and equal-height rows without a fixed width or height',()=>{
 const buttons=declaration('.artifact-revision-history > header > button.button, .artifact-revision-history > ol > li > div + div > button.button');
 for(const value of ['min-inline-size: min-content','max-inline-size: 100%','min-block-size: 2.75rem','white-space: normal','overflow-wrap: normal','word-break: normal','hyphens: none'])assert(buttons.includes(value));
 assert.doesNotMatch(buttons,/(?:^|;)\s*(?:width|height|inline-size|block-size)\s*:/);
 assert.doesNotMatch(buttons,/white-space:\s*nowrap|word-break:\s*break-all|overflow:\s*hidden|text-overflow:\s*ellipsis/);
});
test('header and nested row actions use distinct complete selector chains',()=>{
 assert(css.includes('.artifact-revision-history > header > button.button, .artifact-revision-history > ol > li > div + div > button.button {'));
 assert(!css.includes('.artifact-revision-history > :is(header, ol > li > div + div)'));
});
test('row refinement targets only top-level history rows and preserves scrollable details',()=>{
 assert.match(declaration('.artifact-revision-history'),/overflow:\s*auto/);
 assert.match(declaration('.artifact-revision-history pre'),/overflow:\s*auto/);
 const additions=css.slice(css.indexOf('/* Keep revision metadata'),css.indexOf('.artifact-revision-history small'));
 assert(!additions.includes('pointer-events'));assert(!additions.includes(':disabled'));assert(!additions.includes('position:'));
 assert(!additions.includes('.workspace-pilot-card'));assert(!additions.includes('details'));
});
