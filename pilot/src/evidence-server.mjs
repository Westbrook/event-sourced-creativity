import http from 'node:http';
import {readFile} from 'node:fs/promises';
const files=new Map([
 ['/core-receipt.json', ['../evidence/core-receipt.json','application/json']],
 ['/operations-r1.md', ['../docs/operations-r1.md','text/plain']],
 ['/receipt.json', ['../evidence/receipt.json','application/json']],
 ['/infrastructure-request.md', ['../docs/infrastructure-request.md','text/plain']],
 ['/qualification.md', ['../docs/qualification.md','text/plain']],
 ['/proposal.json', ['../deploy/proposal.json','application/json']],
]);
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
// Read-only local evidence viewer. The independent canonical report owns progress and feedback.
http.createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  let body,type='text/html';
  if(path==='/'){
   const receipt=await readFile(new URL('../evidence/core-receipt.json',import.meta.url),'utf8');
   body=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Still pilot · local evidence</title><style>body{max-width:820px;margin:60px auto;padding:0 24px;background:#20221b;color:#e7e6dc;font:17px/1.65 system-ui}h1,h2{font-family:Georgia,serif;font-weight:400}h1{font-size:42px}a{color:#d7dfbe}section{border-top:1px solid #626651;padding:20px 0}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}small{color:#b7baa9}</style><small>R1 LOCAL VERIFICATION · GKE NOT DEPLOYED</small><h1>Still / Forma pilot</h1><p><a href="http://127.0.0.1:4187/">Progress Report and review cards →</a></p><section id="a"><h2>A · Still visual preview</h2><p>Actual creation editor on disposable SQLite, simulated identity and disabled providers. Opening it does not establish review or acceptance.</p><a href="http://127.0.0.1:5207/still/action/new-project?progress-report">Open Still preview →</a></section><section id="b"><h2>R1 · Native shared core</h2><p>Native Still creation, acknowledged Forma rich editing and return to the same Still IDs/content are verified locally on persistent PostgreSQL. Signed synthetic IAP, consent, scoped roles, reference preservation, conflicts, sharing/revocation, current-body erasure and non-root production containers are tested. Live IAP and hosted GKE acceptance remain pending.</p><a href="http://127.0.0.1:5230/still?progress-report">Open persistent native R1 preview →</a> · <a href="/operations-r1.md">Deploy and operate</a></section><section id="c"><h2>C · Separate Memory — local proof</h2><p>Real pgvector tests cover synthetic partition isolation, replacement, revocation, deletion and rejection of stale restores. Native intent integration, IAM and hosted restore remain unqualified. Three-dimensional test vectors make no semantic quality claim.</p></section><section><h2>Infrastructure request</h2><p>Routes, shared resources, proposed quotas and cleanup are documented. GCP login refresh, target provisioning, two admitted accounts and the cost/lifetime allocation are unresolved. Broad worker and Memory qualification follow R1.</p><p><a href="/infrastructure-request.md">Request packet</a> · <a href="/proposal.json">Machine-readable proposal</a> · <a href="/qualification.md">Gates and later work</a></p></section><details><summary>Local receipts and limitations</summary><pre>${escape(receipt)}</pre></details>`;
  }else{const entry=files.get(path);if(!entry){res.writeHead(404);res.end();return;}[body,type]=[await readFile(new URL(entry[0],import.meta.url)),entry[1]];}
  res.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(500);res.end('Evidence unavailable');}
}).listen(5208,'127.0.0.1',()=>console.log('Local evidence: http://127.0.0.1:5208/'));
