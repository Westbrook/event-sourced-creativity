import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../worker/generated-image-api.ts',import.meta.url),'utf8');
const store=readFileSync(new URL('../src/state/store.ts',import.meta.url),'utf8');
const host=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8');
const card=readFileSync(new URL('../src/components/output-card.ts',import.meta.url),'utf8');
test('image preparation is bounded fixed-command explicit POST after unchanged creator authority',()=>{
  const start=source.indexOf("if(request.method==='POST')"),end=source.indexOf('let current = await observeCurrent',start);
  const preparation=source.slice(start,end);assert.ok(start>source.indexOf('requireFact(!selected.context'));
  assert.ok(preparation.includes('boundedStream(request.body,128,null,life)'));
  assert.ok(preparation.includes("exactKeys(command,['operation'])&&command.operation==='prepare-current-read'"));
  assert.ok(preparation.includes('captureSceneSourceVersion(env,{streamId:actor.streamId},[principalAdmission(env,actor)])'));
  assert.doesNotMatch(preparation,/document_jobs|expires_at|grant|recover|generate|MEDIA|budget/);
  assert.ok(source.includes("request.method !== \"GET\") requireFact(!request.headers.get(\"origin\") || request.headers.get(\"origin\") === url.origin"));
});
test('automatic image reads do not prepare; manual trusted review opts in',()=>{
  const start=store.indexOf('async loadGeneratedImageEdit('),end=store.indexOf('async captureGeneratedImageEdit',start);
  const method=store.slice(start,end);assert.ok(method.includes('if(options.prepareSource)'));
  assert.ok(method.indexOf('if(options.prepareSource)')<method.indexOf('{method:"GET"}'));
  assert.ok(method.includes("JSON.stringify({operation:'prepare-current-read'})"));
  assert.ok(host.includes('async #check(prepareImage=false)'));
  assert.ok(host.includes('if(event.isTrusted)void this.#check(true)'));
  assert.ok(host.includes('prepareSource:prepareImage'));
  assert.equal((host.match(/#check\(true\)/g)||[]).length,1);
});
test('editor opening consumes trusted preparation before any automatic reload',()=>{
  assert.ok(card.includes('let prepareSource=event.isTrusted;'));
  assert.ok(card.includes('read:()=>{const prepare=prepareSource;prepareSource=false;return store.loadGeneratedImageEdit(output.id,{current,prepareSource:prepare});}'));
  assert.ok(!card.includes('prepareSource:event.isTrusted'));
});
