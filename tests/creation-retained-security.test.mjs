import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readCreationOperationPayload } from '../worker/creation-commits.ts';

// Actual production SQL against disposable SQLite; not live D1/provider qualification.
function fixture(t) {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE private_content(content_id TEXT,owner_id TEXT,kind TEXT,content TEXT,redacted_at TEXT,expires_at TEXT);
 CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT,visibility TEXT,project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,actor_user_id TEXT);
 CREATE TABLE private_content_retention_scopes(content_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,actor_user_id TEXT);`);
 db.prepare('INSERT INTO private_content VALUES (?,?,?,?,?,?)').run('payload','actor','creation-draft',JSON.stringify({source:'Actor private draft'}),null,'2999-01-01T00:00:00.000Z');
 const prepare=(sql,bindings=[])=>({bind(...next){return prepare(sql,next);},async first(){return db.prepare(sql).get(...bindings)??null;}});
 const env={DB:{prepare}},user={userId:'actor'},operation={content_id:'payload',actor_user_id:'actor'},guard={sql:'1',bindings:[]},binding={actorUserId:'actor',scope:null};
 const read=()=>readCreationOperationPayload(env,user,operation,guard,binding);
 const scope=()=>{binding.scope={projectAccessId:'access',organizationId:'org',projectId:'project',ownerUserId:'owner',actorUserId:'actor'};db.prepare('INSERT INTO project_resource_scopes VALUES (?,?,?,?,?,?,?,?)').run('content','payload','actor_private','access','org','project','owner','actor');db.prepare('INSERT INTO private_content_retention_scopes VALUES (?,?,?,?,?)').run('payload','org','access','project','actor');};
 return {db,read,binding,user,operation,scope};
}
test('retained creation bodies are denied to another actor even with the same operation pointer',async t=>{
 const f=fixture(t);assert.equal((await f.read()).source,'Actor private draft');f.user.userId='other';assert.equal(await f.read(),null);
 f.user.userId='actor';f.operation.actor_user_id='other';assert.equal(await f.read(),null);
});
test('personal retained creation cannot hydrate newly scoped protected content',async t=>{
 const f=fixture(t);f.scope();f.binding.scope=null;assert.equal(await f.read(),null);
});
test('shared retained creation requires exact actor-private resource and retention custody',async t=>{
 const f=fixture(t);f.scope();assert.equal((await f.read()).source,'Actor private draft');
 f.db.exec("UPDATE project_resource_scopes SET visibility='project'");assert.equal(await f.read(),null);
 f.db.exec("UPDATE project_resource_scopes SET visibility='actor_private'; UPDATE private_content_retention_scopes SET project_id='other'");assert.equal(await f.read(),null);
 f.db.exec("UPDATE private_content_retention_scopes SET project_id='project'; DELETE FROM private_content_retention_scopes");assert.equal(await f.read(),null);
});
test('expired, redacted or retyped retained creation bodies cannot hydrate',async t=>{
 const f=fixture(t);f.db.exec("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z'");assert.equal(await f.read(),null);
 f.db.exec("UPDATE private_content SET expires_at='2999-01-01T00:00:00.000Z',redacted_at='now'");assert.equal(await f.read(),null);
 f.db.exec("UPDATE private_content SET redacted_at=NULL,kind='prompt'");assert.equal(await f.read(),null);
});
