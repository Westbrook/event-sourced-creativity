import http from 'node:http';
import {readFile} from 'node:fs/promises';
const files=new Map([
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
   const receipt=await readFile(new URL('../evidence/receipt.json',import.meta.url),'utf8');
   body=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Still pilot · local evidence</title><style>body{max-width:820px;margin:60px auto;padding:0 24px;background:#20221b;color:#e7e6dc;font:17px/1.65 system-ui}h1,h2{font-family:Georgia,serif;font-weight:400}h1{font-size:42px}a{color:#d7dfbe}section{border-top:1px solid #626651;padding:20px 0}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}small{color:#b7baa9}</style><small>LOCAL PREPARATION · NO HOSTED QUALIFICATION</small><h1>Still / Forma pilot</h1><p><a href="http://127.0.0.1:4187/">Progress Report and review cards →</a></p><section id="a"><h2>A · Still visual preview</h2><p>Actual creation editor on disposable SQLite, simulated identity and disabled providers. Opening it does not establish review or acceptance.</p><a href="http://127.0.0.1:5207/still/action/new-project?progress-report">Open Still preview →</a></section><section id="b"><h2>B · Shared platform — incomplete</h2><p>PostgreSQL native creation compiler and transaction mechanics, IAP verifier, private object adapter and fenced cleanup are prepared. Native HTTP/custody integration, real storage and the authenticated Still → Forma → Still journey remain required. The API deliberately fails readiness.</p></section><section id="c"><h2>C · Separate Memory — local proof</h2><p>Real pgvector tests cover synthetic partition isolation, replacement, revocation, deletion and rejection of stale restores. Native intent integration, IAM and hosted restore remain unqualified. Three-dimensional test vectors make no semantic quality claim.</p></section><section><h2>Infrastructure request</h2><p>Routes, shared resources, proposed quotas and cleanup are documented. Exact owners, accounts, budget, cost quote and expiry are unresolved.</p><p><a href="/infrastructure-request.md">Request packet</a> · <a href="/proposal.json">Machine-readable proposal</a> · <a href="/qualification.md">Gates and later work</a></p></section><details><summary>Local receipts and limitations</summary><pre>${escape(receipt)}</pre></details>`;
  }else{const entry=files.get(path);if(!entry){res.writeHead(404);res.end();return;}[body,type]=[await readFile(new URL(entry[0],import.meta.url)),entry[1]];}
  res.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(500);res.end('Evidence unavailable');}
}).listen(5208,'127.0.0.1',()=>console.log('Local evidence: http://127.0.0.1:5208/'));
