import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source=await readFile(new URL('../worker/generated-image-api.ts',import.meta.url),'utf8');
test('image read diagnostic stages are fixed source labels, not private runtime values',()=>{
  const declared=source.match(/readStage: ([^;]+) = "admission";/u)?.[1];assert.ok(declared);
  const allowed=[...declared.matchAll(/"([a-z_]+)"/gu)].map(match=>match[1]);
  const assignments=[...source.matchAll(/life\.readStage=([^;]+);/gu)].map(match=>match[1]);
  assert.equal(assignments.length,18);
  for(const assignment of assignments){assert.match(assignment,/^"[a-z_]+"$/u);assert.ok(allowed.includes(JSON.parse(assignment)));}
  assert.equal(new Set(allowed).size,19);
});
test('read-only diagnostics expose only fixed stage, refusal code and status without changing responses',()=>{
  const match=source.match(/if\(request.method==="GET"\)console.warn\("generated_image_read_refused",(\{[^\n]+\})\);/u);assert.ok(match);
  assert.equal(match[1],'{stage:life.readStage,code:failure.code,status:failure.status,kind:imageReadFailureKind(error)}');
  assert.ok(source.includes('if (life.writing) return reply({ status: "unconfirmed", code: "unconfirmed" });'));
  assert.ok(source.includes('const failure = error instanceof Refusal ? error : new Refusal("unavailable");'));
  assert.ok(source.includes('return reply({ status: "refused", code: failure.code }, failure.status);'));
});
test('database-kind diagnosis never returns private messages or traverses getters',()=>{
  const start=source.indexOf('function imageReadFailureKind('),end=source.indexOf('\nclass Lifetime',start);assert.ok(start>=0&&end>start);
  class Refusal extends Error{}
  const classify=new Function('Refusal',stripTypeScriptTypes(source.slice(start,end))+';return imageReadFailureKind;')(Refusal);
  for(const [message,kind] of [['D1_ERROR: string or blob too big: SQLITE_TOOBIG','d1_value_limit'],['no such table: private','d1_schema'],['Expression tree is too large','d1_expression_depth'],['Wrong number of parameter bindings','d1_binding_count'],['private raw error','unknown']]){
    assert.equal(classify(new Error(message)),kind);assert.equal(classify(new Error('wrapper',{cause:new Error(message)})),kind);
  }
  let touched=0;const hostile=new Error();Object.defineProperty(hostile,'message',{get(){touched++;return 'private';}});Object.defineProperty(hostile,'cause',{get(){touched++;return new Error('private');}});
  assert.equal(classify(hostile),'unknown');assert.equal(touched,0);assert.equal(classify(new Refusal('private')),'refusal');
});
