import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../../../',import.meta.url),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const evidence=JSON.parse(readFileSync(new URL('docs/evidence/generation-h4/verification.json',root),'utf8'));
for(const [path,sha] of Object.entries(evidence.files))if(digest(readFileSync(new URL(path,root)))!==sha)throw Error('h4_review_source_changed:'+path);
for(const item of evidence.preserved)if(digest(readFileSync(new URL(item.path,root)))!==item.sha256)throw Error('h4_historical_evidence_changed:'+item.path);
if(evidence.captureId!=='h4-offline:'+digest(JSON.stringify(evidence.files))||evidence.providerCalls!==0||evidence.actualRequest!==null||evidence.actualOutput!==null)throw Error('h4_evidence_identity');
console.log(JSON.stringify({captureId:evidence.captureId,sourceFiles:Object.keys(evidence.files).length,actualRequest:null,actualOutput:null,providerCalls:0,status:'offline-review-only'}));
