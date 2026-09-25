// Seal the non-executable P5 review artifacts, never authority or a deployment.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const root='docs/evidence/generation-p5',hash=v=>createHash('sha256').update(v).digest('hex');
const base='4eb1db542a6cd41bcb9f956fd68eb45105f10397';
const read=p=>readFileSync(p);
const packet=JSON.parse(read('docs/evidence/generation-p2/pilot-packet.json'));
const draft=JSON.parse(read(root+'/proposed-run.json'));
assert.equal(draft.liveAuthorized,false);assert.equal(draft.ready,false);
assert.equal(draft.binding.principal,null);assert.equal(draft.binding.runtime,null);
assert.equal(draft.dates.proposalExpiresAt,packet.input.expiresAt);
assert.deepEqual(draft.protocol,packet.protocol);assert.deepEqual(draft.exactDiff,packet.exactDiff);
assert.deepEqual(draft.settings,packet.settings);assert.deepEqual(draft.logicalCounts,packet.logicalCounts);
assert.deepEqual(draft.brief,packet.suppliedSnapshot);assert.deepEqual(draft.frozenDirection,packet.direction.value);
for(const a of packet.arms){const file=root+'/requests/'+a.arm+'-'+a.stage+'.json';assert.equal(read(file).toString(),a.body);assert.equal(hash(read(file)),a.sha256);}
const historical={};
for(const dir of ['generation-p1','generation-p2','generation-p3','generation-p4']){
 for(const name of readdirSync('docs/evidence/'+dir)){
  const p='docs/evidence/'+dir+'/'+name;
  // These evidence directories contain regular files only.
  const original=execFileSync('git',['show',base+':'+p],{maxBuffer:32*1024*1024});
  assert.equal(hash(read(p)),hash(original),'historical evidence changed: '+p);historical[p]=hash(original);
 }
}
assert.equal(execFileSync('git',['diff',base,'--','worker','src','db','evals/generation-reliability','build','vite.config.ts']).length,0,'Product runtime changed; this preparation seal is insufficient');
const audit=JSON.parse(read(root+'/resource-audit-r3.json'));
assert.equal(audit.realProviderCalls,0);assert.equal(audit.modes.length,2);
for(const mode of audit.modes){assert.equal(mode.interceptedPosts,6);assert.equal(mode.stats.limitViolations.length,0);assert.equal(mode.privateInventory.find(r=>r.kind==='supplied-study-evidence').records,18);}
const paths=['scripts/audit-generation-p5.mjs','scripts/seal-generation-p5.mjs','docs/generation-cross-media-transfer-e2.md'];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())walk(p);else if(!['release-envelope.json','seal.log'].includes(entry.name))paths.push(p);}}
walk(root);
const artifactHashes=Object.fromEntries(paths.sort().map(p=>[p,hash(read(p))]));
const body={version:'p5-preparation-envelope-v1',baseCommit:base,mainAncestor:'c28af5fea0fc3ec2b37b878a544ec59c52a64daf',classification:'non-executable-review-package',productSourceChanged:false,preparationComplete:false,independentPreparationComplete:true,deploymentQualified:false,runAuthorized:false,runCompleted:false,realProviderCalls:0,installedRealSchema:false,actualGrant:false,paidSpendingAuthorized:0,expiry:packet.input.expiresAt,verification:'Exact packet/protocol/request hashes, unchanged P1-P4 evidence and product runtime; synthetic offline resource audit, schema contract checks; no managed-runtime claim',artifactHashes,historicalHashes:historical};
const envelope={...body,id:'p5-preparation:'+hash(JSON.stringify(body))},text=JSON.stringify(envelope,null,2)+'\n',path=root+'/release-envelope.json';
if(existsSync(path))assert.equal(read(path).toString(),text,'P5 evidence changed; create a successor');
else if(process.argv.includes('--write'))writeFileSync(path,text,{flag:'wx'});
else throw Error('Missing seal; explicitly use --write once.');
console.log(JSON.stringify({id:envelope.id,artifactCount:paths.length,historicalArtifacts:Object.keys(historical).length,ready:false,runAuthorized:false,realProviderCalls:0}));
