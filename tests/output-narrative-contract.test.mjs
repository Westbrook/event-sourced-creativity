import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORT_STORY_NARRATIVE_CONTRACT as contract, parseShortStoryNarrativeContract, assessShortStoryBody } from '../src/model/output-narrative-contract.ts';

const body = count => Array(count).fill('word').join(' ');
const assess = value => assessShortStoryBody('short_story', contract, value);

test('only the complete English versioned contract can select narrative acceptance', () => {
  const raw = structuredClone(contract);
  assert.equal(parseShortStoryNarrativeContract(raw), contract);
  assert.ok(Object.isFrozen(contract)); assert.ok(Object.isFrozen(contract.wordRange));
  raw.wordRange.min = 1; assert.equal(contract.wordRange.min, 600);
  for (const mutate of [
    value => { value.language = 'ja'; }, value => { value.language = 'en-US'; },
    value => { value.wordCountPolicy = 'intl-segmenter'; }, value => { value.bodyFormat = 'markdown'; },
    value => { value.artifactKind = 'scene'; }, value => { value.genre = 'nonfiction'; },
    value => { value.wordRange.min = 599; }, value => { value.wordRange.max = 801; },
    value => { value.maximumBodyBytes++; }, value => { value.schemaVersion = 2; },
    value => { value.provider = 'unregistered'; }, value => { value.wordRange.extra = true; },
    value => { delete value.contentField; },
  ]) {
    const value = structuredClone(contract); mutate(value);
    assert.equal(parseShortStoryNarrativeContract(value), null);
    assert.equal(assessShortStoryBody('short_story', value, body(600)).issues[0].code, 'narrative_contract_invalid');
  }
});

test('contract parsing rejects accessors, exotic prototypes, symbols and hidden fields without invoking getters', () => {
  let calls = 0;
  for (const nested of [false, true]) {
    const raw = structuredClone(contract), target = nested ? raw.wordRange : raw, key = nested ? 'min' : 'id';
    Object.defineProperty(target, key, { enumerable: true, get() { calls++; throw Error('Getter invoked'); } });
    assert.equal(parseShortStoryNarrativeContract(raw), null);
  }
  const hidden = structuredClone(contract); Object.defineProperty(hidden, 'retry', { value: true });
  const symbol = structuredClone(contract); symbol[Symbol('execute')] = true;
  for (const value of [hidden, symbol, Object.assign(Object.create({ capability: true }), contract), null, [], 'short story']) assert.equal(parseShortStoryNarrativeContract(value), null);
  assert.equal(calls, 0);
});

test('inclusive 600–800 accepts the entire unchanged body; 599 and 801 fail without repair', () => {
  for (const [count, valid] of [[599, false], [600, true], [800, true], [801, false]]) {
    const text = body(count), result = assess(text);
    assert.equal(result.valid, valid); assert.equal(result.wordCount, count); assert.equal(result.policy, 'english-lexical@1');
    assert.equal(result.issues.length, valid ? 0 : 1); assert.ok(Object.isFrozen(result));
    assert.equal(text, body(count));
  }
});

test('dialogue, paragraph breaks, apostrophes and internal hyphens have explicit deterministic counts', () => {
  for (const [text, count] of [
    ["don't didn’t mother-in-law re‐enter non‑breaking", 5],
    ['“Wait,” she said.\r\n\r\n‘No—stay.’', 5],
    ['one–two one—two one---two -word- ’word’', 8],
    ['é e\u0301 Мария ليلى 42', 5],
    ['— – - ‐ ‑ … “ ” ‘ ’ ! ? . , ; :', 0],
    ['one\t two\nthree\r\nfour\u00a0five', 5],
  ]) {
    const result = assess(text); assert.equal(result.wordCount, count, text);
    assert.equal(result.issues[0].code, 'narrative_word_count_out_of_range');
  }
  const result = assess('“Wait,” she said.\n    \n' + body(597));
  assert.equal(result.valid, true); assert.equal(result.wordCount, 600);
});

test('markup is refused rather than counted or stripped into an apparently acceptable story', () => {
  for (const markup of ['# Heading', 'Heading\n====', 'Heading\n----', '```code```', '~~~code~~~', '    code', '     code', '\tcode', '<script>hidden</script>', '<!-- hidden -->', '&lt;hidden&gt;', '![image](private.png)', '[label](https://example.test)', '[label][ref]', '[ref]: https://example.test', '*emphasis*', '_emphasis_', '- list', '1. list', '> quotation']) {
    const result = assess(body(600) + '\n' + markup);
    assert.equal(result.valid, false, markup); assert.equal(result.wordCount, null, markup);
    assert.equal(result.issues[0].code, 'narrative_body_not_plain_prose', markup);
  }
});

test('only body text is counted; metadata, wrong artifact kinds and label inference cannot qualify', () => {
  const candidate = { title: body(600), summary: body(600), content_markdown: body(599), items: [{ body: body(600), notes: body(600) }] };
  assert.equal(assess(candidate.content_markdown).wordCount, 599);
  assert.equal(assess(candidate).issues[0].code, 'narrative_body_invalid');
  for (const kind of ['scene', 'document', 'Short story', 'short-story', undefined]) {
    assert.equal(assessShortStoryBody(kind, contract, body(600)).issues[0].code, 'narrative_kind_mismatch');
  }
  assert.equal(assessShortStoryBody('short_story', undefined, body(600)).issues[0].code, 'narrative_contract_invalid');
});

test('pipe tables cannot satisfy the plain-prose word count', () => {
  for (const table of [
    'a | b\n--- | ---\nc | d',
    '| a | b |\n| :--- | ---: |\n| c | d |',
    '| a |\n| --- |\n| b |',
    ' a | b\r\n :---: | ---\r\n c | d',
  ]) {
    const result = assess(body(600) + '\n\n' + table);
    assert.equal(result.valid, false);
    assert.equal(result.wordCount, null);
    assert.equal(result.issues[0].code, 'narrative_body_not_plain_prose');
  }
  assert.equal(assess(body(598) + '\n\none | two').valid, true, 'Literal prose pipes are not table markup');
});

test('bounded UTF-8, hidden characters and malformed strings cannot bypass acceptance', () => {
  for (const text of [null, undefined, '', ' \n\t ', body(600) + '\u0000', body(600) + '\u200b', body(600) + '\u202e', body(600) + '\uD800']) {
    assert.equal(assess(text).issues[0].code, 'narrative_body_invalid');
  }
  for (const text of ['x'.repeat(65537), 'é'.repeat(32769)]) {
    assert.equal(assess(text).issues[0].code, 'narrative_body_too_large'); assert.equal(assess(text).wordCount, null);
  }
  assert.equal(assess('😀 ' + body(600)).valid, true);
});
