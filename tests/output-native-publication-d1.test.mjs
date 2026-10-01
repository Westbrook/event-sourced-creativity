import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {publicationParts,predicateTree} from './output-native-publication-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(realpathSync(root+'node_modules/wrangler/package.json'));
const {Miniflare}=require('miniflare');
const schema=[
 'CREATE TABLE output_native_storage_writes(scope_key TEXT,slot_id TEXT,storage_key TEXT,content_sha256 TEXT,status TEXT,write_acknowledged INTEGER,publication_event_id TEXT,updated_at TEXT)',
 'CREATE TABLE events(event_id TEXT,stream_id TEXT,correlation_id TEXT,type TEXT,actor TEXT,sequence INTEGER)',
 'CREATE TABLE event_private_payloads(private_event_id TEXT,private_json TEXT,redacted_at TEXT,owner_id TEXT,document_id TEXT)',
 'CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,source_digest TEXT,target_contract_digest TEXT,grant_id TEXT,plan_revision_id TEXT,target_id TEXT)',
 'CREATE TABLE document_jobs(job_id TEXT,stream_id TEXT,correlation_id TEXT,owner_id TEXT,document_id TEXT,kind TEXT,request_json TEXT,result_json TEXT)',
 'CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,status TEXT,used_microusd INTEGER,client_request_id TEXT,provider_response_id TEXT,request_digest TEXT)'
];

test('actual D1 compiles balanced publication but rejects equivalent unbalanced depth regression',async()=>{
  const source=readFileSync(root+'worker/output-private-execution.ts','utf8'),parts=publicationParts(source),tree=predicateTree(parts.predicate);
  const unbalanced=parts.before+'('+tree.terms.map(branch=>branch.terms.map(term=>term.atom).join(' AND ')).join(' OR ')+')'+parts.after;
  const values=Array((parts.sql.match(/\?/gu)||[]).length).fill(null);
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',port:0,d1Databases:['DB'],script:'export default{fetch(){return new Response("isolated");}}'});
  try{
    const db=await mf.getD1Database('DB');
    for(const ddl of schema)await db.prepare(ddl).run();
    await assert.rejects(db.prepare(unbalanced).bind(...values).run(),/Expression tree is too large \(maximum depth 100\)/u);
    const result=await db.prepare(parts.sql).bind(...values).run();
    assert.equal(result.success,true);assert.equal(result.meta.changes,0);
  }finally{await mf.dispose();}
});
