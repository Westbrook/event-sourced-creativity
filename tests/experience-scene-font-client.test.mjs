import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readExperienceSceneFont } from '../src/experiences/scene-font-client.ts';
import { SCENE_FONT_URL } from '../src/components/scene-text-measurement.ts';

const bytes = new Uint8Array(readFileSync(new URL('../public/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf', import.meta.url)));
const origin = 'https://forma.invalid';
function response(body = bytes, headers = {}, status = 200, path = SCENE_FONT_URL) {
  const result = new Response(body, {status, headers: {'content-type': 'font/ttf', ...headers}});
  Object.defineProperty(result, 'url', {value: origin + path});
  return result;
}
const controls = request => ({origin, signal: new AbortController().signal, current: () => true, request});
test('Scene font reads only the exact public asset with no credentials and verifies complete SHA bytes', async () => {
  let calls = 0;
  const result = await readExperienceSceneFont(controls(async (path, init) => {
    calls++; assert.equal(path, SCENE_FONT_URL); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error'); assert.deepEqual(Object.keys(init.headers), ['accept']);
    return response(bytes, {'content-length': String(bytes.length)});
  }));
  assert.equal(calls, 1); assert.deepEqual(new Uint8Array(result), bytes);
  const compressed = await readExperienceSceneFont(controls(async () => response(bytes, {'content-encoding': 'br', 'content-length': '12000'})));
  assert.deepEqual(new Uint8Array(compressed), bytes);
});
test('wrong font, route, type, status, declared or decoded size never grants measurement bytes', async () => {
  const changed = bytes.slice(); changed[100] ^= 1;
  for (const factory of [
    () => response(changed), () => response(bytes.slice(1)), () => response(new Uint8Array(bytes.length + 1)),
    () => response(bytes, {'content-length': '1'}), () => response(bytes, {'content-length': 'bad'}),
    () => response(bytes, {'content-type': 'text/html'}), () => response(bytes, {}, 404),
    () => response(bytes, {}, 200, '/another-font.ttf'),
  ]) assert.equal(await readExperienceSceneFont(controls(async () => factory())), null);
});
test('pending response and body withdraw promptly, cancel without waiting, and never retry', async () => {
  let calls = 0, requestSignal;
  const waiting = controls(async (_path, init) => {calls++; requestSignal = init.signal; return new Promise(() => {});});
  assert.equal(await readExperienceSceneFont({...waiting, timeoutMs: 5}), null);
  assert.equal(calls, 1); assert.ok(requestSignal.aborted);
  let cancelled = false;
  const parent = new AbortController();
  const pending = readExperienceSceneFont({...controls(async () => response(new ReadableStream({
    start(controller) {controller.enqueue(bytes.slice(0, 20));},
    cancel() {cancelled = true; return new Promise(() => {});},
  }))), signal: parent.signal});
  await new Promise(resolve => setTimeout(resolve, 0)); parent.abort();
  assert.equal(await pending, null); assert.ok(cancelled);
  let current = true;
  assert.equal(await readExperienceSceneFont({...controls(async () => {current = false; return response();}), current: () => current}), null);
  const aborted = new AbortController(); aborted.abort();
  assert.equal(await readExperienceSceneFont({...controls(async () => {throw new Error('must not request');}), signal: aborted.signal}), null);
});
