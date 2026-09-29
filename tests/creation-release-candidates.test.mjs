import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {releaseMigrationPolicy} from '../build/release-migrations.ts';
const root=new URL('../',import.meta.url).pathname;
test('candidate schemas apply twice to the current application baseline without changing authored history; release stays held',async t=>{
 const f=await createSceneCostFixture(1);t.after(()=>f.close());const before=JSON.stringify(f.sqlite.prepare('SELECT * FROM events ORDER BY sequence').all()),privateBefore=JSON.stringify(f.sqlite.prepare('SELECT * FROM event_private_payloads ORDER BY private_event_id').all());
 const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url)));assert.equal(journal.entries.at(-1).tag,'0073_memory_authored_images');
 for(let repeat=0;repeat<2;repeat++)for(const name of ['0074_still_creation.sql','0075_still_creation_search.sql'])f.sqlite.exec(readFileSync(new URL('../drizzle/candidates/'+name,import.meta.url),'utf8'));
 assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM events ORDER BY sequence').all()),before);assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM event_private_payloads ORDER BY private_event_id').all()),privateBefore);
 const policy=await releaseMigrationPolicy(root);assert.equal(policy.files.length,41);assert.ok(policy.files.every(f=>!/^007[45]_/.test(f.path)));
 f.env.STILL_UNIFIED_CREATION_ENABLED='true';assert.equal((await(await f.request('/api/session?profile=still')).json()).creation.enabled,true);delete f.env.STILL_UNIFIED_CREATION_ENABLED;assert.equal((await(await f.request('/api/session?profile=still')).json()).creation.enabled,false);assert.equal((await f.request('/api/still/creation/drafts')).status,404);
 assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM events ORDER BY sequence').all()),before);
});
