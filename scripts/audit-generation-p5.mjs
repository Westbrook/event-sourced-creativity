// Offline resource inspection of the unchanged P4/P2 chain. No target or key is used.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fixture} from '../tests/generation-p4-fixture.mjs';

const output=process.argv[2];
const modes=[];
for(const mode of ['accepted-estimate','bounded-proof']){
 const clean=[];
 try{
  const f=await fixture({after:fn=>clean.push(fn)},{mode});
  const stats={statements:0,batches:0,maxBatchStatements:0,maxSqlBytes:0,maxParameters:0,maxValueBytes:0,maxBoundBytes:0,limitViolations:[],phases:{}};
  let phase='preview';
  const inspect=(s,direct=false)=>{
   const sqlBytes=Buffer.byteLength(s.sql),parameters=s.bindings.length;
   const sizes=s.bindings.map(v=>typeof v==='string'?Buffer.byteLength(v):v instanceof Uint8Array?v.byteLength:8);
   const maxValueBytes=Math.max(0,...sizes),boundBytes=sizes.reduce((a,b)=>a+b,0);
   stats.phases[phase]??={statements:0,batches:0,directCalls:0};stats.phases[phase].statements++;if(direct)stats.phases[phase].directCalls++;
   stats.statements++;stats.maxSqlBytes=Math.max(stats.maxSqlBytes,sqlBytes);stats.maxParameters=Math.max(stats.maxParameters,parameters);stats.maxValueBytes=Math.max(stats.maxValueBytes,maxValueBytes);stats.maxBoundBytes=Math.max(stats.maxBoundBytes,boundBytes);
   if(sqlBytes>100000||parameters>100||maxValueBytes>2000000)stats.limitViolations.push({phase,sqlSha256:createHash('sha256').update(s.sql).digest('hex'),sqlBytes,parameters,maxValueBytes});
  };
  const prepare=f.DB.prepare.bind(f.DB),batch=f.DB.batch.bind(f.DB);
  f.DB.prepare=sql=>{
   const wrap=s=>{const bind=s.bind.bind(s);s.bind=(...v)=>wrap(bind(...v));for(const method of ['first','all','run']){const original=s[method].bind(s);s[method]=async()=>{inspect(s,true);return original();};}return s;};
   return wrap(prepare(sql));
  };
  f.DB.batch=async statements=>{stats.phases[phase]??={statements:0,batches:0,directCalls:0};stats.phases[phase].batches++;stats.batches++;stats.maxBatchStatements=Math.max(stats.maxBatchStatements,statements.length);statements.forEach(s=>inspect(s));return batch(statements);};
  const preview=await f.preview();assert.equal(preview.committable,true);
  phase='commit';const commit=await f.call(f.command(preview));assert.equal(commit.status,'committed');
  phase='default-off';assert.equal((await f.fresh().execute(f.request(),f.args())).action,'disabled');assert.equal(f.calls.length,0);
  f.env.FORMA_GENERATION_STUDY_ENABLED='1';phase='baseline';await f.fresh().execute(f.request(),f.args());
  phase='human-observation';await f.observe();phase='baseline-settlement';await f.settle();
  phase='treatment';await f.fresh().execute(f.request(),f.args('treatment'));phase='treatment-settlement';await f.settle('treatment');
  phase='original-recovery';await f.fresh().recover(f.request(),f.args());
  assert.equal(f.calls.length,6);
  const privateInventory=f.sqlite.prepare('SELECT kind,count(*) records,sum(length(CAST(content AS BLOB))) bytes,max(length(CAST(content AS BLOB))) maximumRecordBytes FROM private_content GROUP BY kind ORDER BY kind').all();
  modes.push({mode,stats,privateInventory,previewBytes:Buffer.byteLength(JSON.stringify(preview.display)),approvalInventory:preview.display.approvalInventory,interceptedPosts:f.calls.length,originalStages:f.sqlite.prepare('SELECT stage,count(*) records FROM generation_study_stages GROUP BY stage ORDER BY stage').all(),objects:f.media.size});
 }finally{clean.reverse().forEach(fn=>fn());}
}
const p=JSON.parse(readFileSync(new URL('../docs/evidence/generation-p2/pilot-packet.json',import.meta.url)));
const images=p.arms.filter(a=>a.stage==='image').map(a=>JSON.parse(a.body));
const [a,b]=images;
assert.equal(b.prompt,p.exactDiff.insert+a.prompt.slice(p.exactDiff.remove.length));
assert.deepEqual({...a,prompt:null},{...b,prompt:null});
assert.equal(p.transport.maxTotalPOSTs,6);assert.equal(p.protocol.id,'p2-human-between-arm-v1');
const report={version:'p5-offline-resource-audit-v1',classification:'synthetic',runtime:'Node SQLite and intercepted transport; NOT managed workerd/D1/R2 qualification',realProviderCalls:0,realAuthority:false,productSourceChanged:false,packetId:p.id,exactSingleOpeningDifference:true,sourceEvidence:'P4 source at 4eb1db542a6cd41bcb9f956fd68eb45105f10397',limitsReference:'https://developers.cloudflare.com/d1/platform/limits/',modes};
if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({modes:modes.map(m=>({mode:m.mode,...m.stats,privateInventory:m.privateInventory})),realProviderCalls:0},null,2));
