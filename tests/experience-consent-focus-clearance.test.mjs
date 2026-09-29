import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/forma-experience-host.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/experiences/host.css', import.meta.url), 'utf8');

test('native host focus targets reuse the shared clearance without focus scripting or reducing the outline', () => {
  const rule = css.match(/\.experience-host :where\(button, input, select, textarea, summary, a\[href\], \[tabindex\]\)\s*\{([^}]+)\}/u)?.[1];
  assert(rule, 'One low-specificity rule covers native host focus targets');
  assert.equal(rule.trim(), 'scroll-margin: var(--forma-focus-clearance, .5rem);');
  assert(!/outline|scroll-behavior|overflow|position|z-index/u.test(rule));
});

test('only a settled equivalent review status is visually redundant', () => {
  const expression = source.match(/const duplicateReviewStatus = ([\s\S]+?);\n\s+return html/u)?.[1];
  assert(expression);
  const evaluate = new Function('available', 'state', 'terms', 'result', 'unavailableProviderPreparation', 'internal',
    'return ' + expression.replaceAll('this.#', 'internal.') + ';');
  const make = () => ({ available: true, state: { status: 'review', preflight: {} }, terms: { summary: {}, available: true },
    result: undefined, unavailableProviderPreparation: false, internal: { loading: false, busy: false, refreshing: false, status: 'Cost and transfer' } });
  const run = value => evaluate(value.available, value.state, value.terms, value.result, value.unavailableProviderPreparation, value.internal);
  assert.equal(run(make()), true);
  for (const flag of ['loading', 'busy', 'refreshing']) { const value = make(); value.internal[flag] = true; assert.equal(run(value), false, flag); }
  for (const status of ['Recording', 'Original unavailable', 'Source changed', 'Checking status']) { const value = make(); value.internal.status = status; assert.equal(run(value), false, status); }
  for (const status of ['authorized', 'queued', 'running', 'unavailable', 'succeeded']) { const value = make(); value.state.status = status; assert.equal(run(value), false, status); }
  for (const change of [value => { value.available = false; }, value => { value.state.preflight = null; },
    value => { value.terms.summary = undefined; }, value => { value.terms.available = false; },
    value => { value.result = {}; }, value => { value.unavailableProviderPreparation = true; }]) {
    const value = make(); change(value); assert.equal(run(value), false);
  }
});

test('the persistent live status remains focusable and the hiding rule withdraws on native focus', () => {
  assert.match(source, /<p data-experience-status class=\$\{duplicateReviewStatus \? "experience-status-duplicate" : nothing\} tabindex="-1" role="status" aria-live="polite">\$\{this\.#status\}<\/p>/u);
  const rule = css.match(/\.experience-host > \.experience-status-duplicate:not\(:focus\):not\(:focus-within\)\s*\{([^}]+)\}/u)?.[1];
  assert(rule);
  for (const declaration of ['position: absolute;', 'width: 1px;', 'height: 1px;', 'margin: -1px;', 'clip: rect(0, 0, 0, 0);']) assert(rule.includes(declaration));
  assert(!/display:\s*none|visibility:\s*hidden|!important/u.test(rule));
});
