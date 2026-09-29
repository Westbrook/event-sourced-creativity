import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {ensureCreationSearchSchema} from '../worker/creation-search-index.ts';
import {CREATION_INDEX_SCHEMA} from '../worker/creation-index-schema.ts';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('exact unjournaled candidate rehearses twice without modifying canonical/private authored data',async t=>{
 const f=await createSceneCostFixture(3,'visual',{shared:true});t.after(()=>f.close());await ensureCreationSearchSchema(f.env.DB);
 const tables=['events','event_private_payloads','private_content','project_event_scopes','project_resource_scopes'];const snapshot=()=>Object.fromEntries(tables.map(table=>[table,digest(f.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())]));const before=snapshot();
 const candidate=readFileSync(new URL('../drizzle/candidates/still_semantic_index.sql',import.meta.url),'utf8');assert.equal(candidate.replace(/^--[^\n]*\n/gm,'').trim(),CREATION_INDEX_SCHEMA.map(s=>s+';').join('\n').trim());
 f.sqlite.exec(candidate);f.sqlite.exec(candidate);assert.deepEqual(snapshot(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_enrollments').get().n,0);assert.ok(f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='creation_index_partition_changed'").get());
 const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url)));assert.ok(!journal.entries.some(e=>e.tag.includes('semantic_index')));
});
