// Offline successor envelope. --write only creates absent files; never renews approval.
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {seal,hash,canonical} from '../evals/generation-reliability/core.mjs';
import {makeSuppliedPlan,PROTOCOL} from '../evals/generation-reliability/p2/contract.mjs';
import {safetyIdentifier} from '../evals/generation-reliability/execution-plan.mjs';
const dir='docs/evidence/generation-p2/',packet=JSON.parse(readFileSync(dir+'pilot-packet.json')),built=JSON.parse(readFileSync(dir+'built-host.json'));
const sourcePaths=[...Object.keys(built.sourceHashes),'db/generation-study.pending.sql','db/generation-study-supplied-v2.pending.sql','package.json','pnpm-lock.yaml','scripts/check-generation-p2-built.mjs','scripts/seal-generation-p2.mjs','tests/generation-p2-fixture.mjs','tests/generation-p2-host.test.mjs','tests/generation-p2-process.mjs','tests/output-execution-test-helpers.mjs'];
const sourceHashes=Object.fromEntries([...new Set(sourcePaths)].sort().map(p=>[p,hash(readFileSync(p))]));
for(const [p,h] of Object.entries(built.sourceHashes))if(sourceHashes[p]!==h)throw Error('Built source changed: '+p);
const runtimeIdentity={version:'p2-local-runtime-v1',adapterSha256:hash(canonical(sourceHashes)),sourceHashes,schema:'optional-supplied-v2',artifacts:built.artifacts};
const plan=makeSuppliedPlan({packet,user:safetyIdentifier('OFFLINE-P2-NOT-A-PRODUCTION-PRINCIPAL'),runtimeIdentity,binding:{kind:'supplied-agent-draft',reviewId:'UNREVIEWED-P2-PROPOSAL',authorityVersion:'UNAPPROVED-v2',sourceRef:'not-retained-source',directionRef:'not-retained-agent-direction',declaredAuthor:'agent-proposed-study-draft',approvedUse:PROTOCOL,expiresAt:packet.input.expiresAt}});
const artifactHashes=Object.fromEntries(readdirSync(dir).filter(p=>p.endsWith('.log')||['pilot-packet.json','built-host.json'].includes(p)).sort().map(p=>[p,hash(readFileSync(dir+p))]));
const envelope=seal('p2-local-release',{version:'p2-local-release-v1',baseCommit:'c28af5fea0fc3ec2b37b878a544ec59c52a64daf',p1Commit:'a1cae8436da1a85e3fc49df91a825de9f89d6467',c2OriginalCommit:'7096cdaf1d6495b5590895e6aec0678c3c07d01f',ready:false,liveAuthorized:false,execution:'disabled',providerCalls:0,installedSchema:false,installedGrant:false,packetId:packet.id,proposalPlanId:plan.id,sourceHashes,artifactHashes,built:{sha256:built.sha256,artifacts:built.artifacts,defaultOff:built.pass},verificationScope:'Local SQLite transaction fixture, intercepted fetch/object storage, child-process death, bundled optional host default-off, current app build. No hosted or real authority/finance qualification.'});
for(const [name,value] of [['execution-proposal.json',plan],['release-envelope.json',envelope]]){
 const path=dir+name,text=JSON.stringify(value,null,2)+'\n';
 if(existsSync(path)){if(readFileSync(path,'utf8')!==text)throw Error('Immutable artifact differs: '+path);}
 else if(process.argv.includes('--write'))writeFileSync(path,text);
 else throw Error('Missing artifact: '+path);
}
console.log(JSON.stringify({envelopeId:envelope.id,planId:plan.id,packetId:packet.id,sourceFiles:Object.keys(sourceHashes).length,artifactFiles:Object.keys(artifactHashes).length,ready:false,liveAuthorized:false}));
