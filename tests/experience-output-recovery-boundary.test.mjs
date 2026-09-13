import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

test('actual recovery handler rejects GET and paid-Run-shaped bodies before intake, DB or provider work',async()=>{
  const source=await readFile(new URL('../worker/experience-output-api.ts',import.meta.url),'utf8');
  const prelude=source.slice(source.indexOf('const record ='),source.indexOf('async function refused('));
  const handler=source.slice(source.indexOf('export async function handleExperienceOutput(')).replace('export async function','async function');
  const body=stripTypeScriptTypes(prelude+'\n'+handler)+'\n;return handleExperienceOutput;';
  const run=new Function('readExperienceBody',body)(request=>request.json());
  // Undefined execution dependencies deliberately fail if either refusal crosses
  // the real pre-intake method/body boundary. No fake admission chain is supplied.
  const url='https://forma.test/api/experiences/drafts/experience-draft-'+ 'a'.repeat(64)+'/output/recover-result';
  const get=await run(new Request(url),{}, {}, {});assert.equal(get.status,405);assert.equal((await get.json()).error,'method_not_allowed');
  const post=await run(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draftHash:'hash',grantId:'grant',explicitRun:true})}),{}, {}, {});
  assert.equal(post.status,400);assert.equal((await post.json()).error,'experience_output_request_invalid');
});
