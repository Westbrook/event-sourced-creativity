import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
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
  assert.equal(match[1],'{stage:life.readStage,code:failure.code,status:failure.status}');
  assert.ok(source.includes('if (life.writing) return reply({ status: "unconfirmed", code: "unconfirmed" });'));
  assert.ok(source.includes('const failure = error instanceof Refusal ? error : new Refusal("unavailable");'));
  assert.ok(source.includes('return reply({ status: "refused", code: failure.code }, failure.status);'));
});
