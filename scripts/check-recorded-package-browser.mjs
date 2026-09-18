import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';

// New browser control of the real built component and CSS, with a synthetic Store boundary.
// No held fixtures, real API, paid call, or production export is used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist/client');
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
const entry = Object.values(manifest).find(row => /^assets\/forma-output-requirements-.*\.js$/.test(row.file));
assert.ok(entry, 'Build the current application first');
const styles = [...(manifest['index.html'].css ?? []), ...(entry.css ?? [])];
// Reuse the previously authored two-pixel local control, never production media.
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([size,body,crc]);};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,220,100,50,255,30,140,180,255]))),chunk('IEND',Buffer.alloc(0))]);
const pngHash=createHash('sha256').update(png).digest('hex');
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${styles.map(css => `<link rel="stylesheet" href="/${css}">`).join('')}
<style>body{display:block;margin:0;padding:24px}main{max-width:960px;margin:auto}#test-ledger{display:block;margin:1rem 0}</style>
<main><h1>Recorded package recovery · isolated check</h1><output id="test-ledger">Exports: 0; downloads: 0</output></main>
<script type="module">
import '/${entry.file}';
const doc='recovery-document', auth={key:'recovery-auth'}, source={key:'recovery-source',generation:1};
const path='/api/output-requirements/deliveries/recovery-manifest?documentId='+doc;
let exports=0,downloads=0,imageReads=0;
const options={selected_optional_ids:[],selected_target_ids:[],count_policies:{},suggested_counts:{}};
const snapshot={schemaVersion:1,documentId:doc,projectId:'recovery-project',scope:{kind:'personal',organizationId:null,projectAccessId:null,actorUserId:'user'},revision:'r1',sourceRevision:'s1',requirementRevision:'q1',requirements:[],
  sourceVerification:{status:'verified',reasonCodes:[]},confirmedPlan:{id:'plan',revisionId:'p1',revision:1,sourceDigest:'s1',requirementsDigest:'q1',plan:{targets:[],groups:[],unresolved:[]},confirmationOptions:options,targetContractDigests:{}},
  summary:{scope_known:true,delivery_ready:true,completion:'complete',required_groups:0,selected_optional_obligations:0,next_actions:[]},requirementSummaries:{},requirementFileCounts:{},targetStates:[],results:[],assets:[],grants:[],scopeAmendments:[],
  permissions:{canDownload:true,canAuthor:false,canRequest:false,canReview:false,independentReview:false},capabilities:{nativeGeneration:false,ownedFileAdoption:false,supportedFileExtensions:[],limitations:[],limitationCodes:[]}};
const previewMode=new URLSearchParams(location.search).has('preview');
if(previewMode){
  snapshot.confirmedPlan.plan.targets=[{id:'test-target',label:'Exact image preview',media_kind:'image',required:true,selected:false,blocking_issues:[],source_scope:{kind:'document'},coverage:{kind:'document_context'}}];
  snapshot.confirmedPlan.targetContractDigests={'test-target':'test-contract'};
  snapshot.assets=[{id:'test-image',name:'Two-pixel test image.png',available:true,mediaKind:'image',mimeType:'image/png',byteLength:${png.length},sha256:'${pngHash}',downloadUrl:'/preview-image',inspection:{status:'inspected',facts:{width:2,height:1}}}];
  snapshot.results=['result-a','result-b'].map(id=>({id,targetId:'test-target',planRevisionId:'p1',assetId:'test-image',resultRevision:'result-v1',targetContractDigest:'test-contract',sourceDigest:'s1',sha256:'${pngHash}',checksStatus:'passed',review:'approved',problems:[]}));
}
let resource={state:'ready',snapshot,privateRevision:0};
const element=document.createElement('forma-output-requirements');
const ledger=()=>document.querySelector('#test-ledger').textContent='Exports: '+exports+'; downloads: '+downloads+'; image reads: '+imageReads;
const store={subscribe:()=>()=>{},captureAuthorizationScope:()=>auth,authorizationScopeActive:v=>v===auth,captureSourceOwnership:()=>source,sourceOwnershipScopeActive:v=>v===source,sourceOwnershipActive:v=>v===source,
  route:{get:()=>'/recovery'},session:{get:()=>({capabilities:['project.read']})},projection:{get:()=>({projectId:'recovery-project',documentId:doc,documents:[],libraryBlocks:[],jobs:[]})},
  documentJobs:{get:()=>[]},
  outputRequirements:{resource:()=>resource,retainedWrite:()=>null,
    ensure:async()=>{resource={...resource,state:'ready'};element.requestUpdate();return resource;},
    download:async(_doc,url,init)=>{if(url==='/preview-image'){imageReads++;ledger();const bytes=Uint8Array.from(atob('${png.toString('base64')}'),c=>c.charCodeAt(0));return{status:'saved',body:{blob:new Blob([bytes],{type:'image/png'}),filename:'test.png'}};}if(url!==path)throw Error('Wrong package');downloads++;ledger();await new Promise(r=>setTimeout(r,120));if(init.signal.aborted)return{status:'unavailable',body:null};return{status:'saved',body:{blob:new Blob(['synthetic package bytes'],{type:'application/zip'}),filename:'recovery-synthetic.zip'}};}},
  outputRequirementCommand:async request=>{if(request.action!=='export')throw Error('Unexpected command');exports++;ledger();resource={...resource,state:'unavailable'};element.requestUpdate();return{status:'saved',body:{ok:true,replayed:false,command:{action:'export',eventId:'recovery-event',manifestId:'recovery-manifest',downloadUrl:path,downloadUrls:[path],partCount:1},snapshot}};}};
element.store=store;element.documentId=doc;element.documentName='Isolated recovery';element.surface='deliver';document.querySelector('main').append(element);
if(previewMode){const reorder=document.createElement('button');reorder.textContent='Reorder local results';reorder.onclick=()=>{snapshot.results.reverse();element.requestUpdate();};document.querySelector('main').prepend(reorder);}
</script></html>`;
let browserPackageGets=0;
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); return; }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (req.url === '/api/output-requirements/deliveries/recovery-manifest?documentId=recovery-document') {
    browserPackageGets++;res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename="recovery-synthetic.zip"','cache-control':'no-store'});res.end('synthetic package bytes');return;
  }
  if (!pathname.startsWith('/assets/')) { res.writeHead(404); res.end(); return; }
  const file = resolve(dist, '.' + pathname);
  if (!file.startsWith(dist + '/assets/')) { res.writeHead(404); res.end(); return; }
  try { res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
if(process.argv.includes('--serve-only')){
  console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`,scope:'Synthetic local component verification only'}));
  await new Promise(resolve=>process.once('SIGTERM',resolve));
  await new Promise(resolve=>server.close(resolve));
  process.exit(0);
}
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const receipts = [];
  for (const profile of [{ width:1280,height:900,dpr:1 },{ width:360,height:900,dpr:2 }]) {
    const context = await browser.newContext({ viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.dpr,acceptDownloads:true });
    const page = await context.newPage(), errors = [], foreign = [];
    page.on('pageerror', error => errors.push(String(error)));
    await context.route('**/*', route => { if (!route.request().url().startsWith(origin+'/')) { foreign.push(route.request().url()); return route.abort(); } return route.continue(); });
    await page.goto(origin);
    const exportButton=page.getByRole('button',{name:/^Download files and manifest/});
    try { await exportButton.click({timeout:10000}); } catch(error) { throw new Error(JSON.stringify({errors,body:await page.locator('body').innerText(),cause:String(error)})); }
    const recovery=page.getByRole('button',{name:/^Prepare recorded package/});
    await recovery.waitFor(); assert.equal(await recovery.getAttribute('aria-disabled'),'true');
    assert.match(await page.locator('#test-ledger').innerText(),/Exports: 1; downloads: 0/);
    await page.getByRole('button',{name:/^Refresh outputs/}).click();
    await page.waitForFunction(()=>document.querySelector('.output-package-parts button')?.getAttribute('aria-disabled')==='false');
    assert.match(await page.locator('#test-ledger').innerText(),/Exports: 1; downloads: 0/);
    // Navigate from the actual Refresh control, rather than force-focus an offscreen node.
    for(let step=0;step<20 && !await recovery.evaluate(node=>node===document.activeElement);step++) await page.keyboard.press('Tab');
    const focusBefore=await recovery.boundingBox();
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const focusAfterTab=await recovery.boundingBox();
    assert.equal(await recovery.evaluate(node=>node===document.activeElement),true);
    let downloadsObserved=0; page.on('download',()=>downloadsObserved++);
    await page.keyboard.press('Enter');
    assert.equal(await recovery.getAttribute('aria-disabled'),'true');
    assert.equal(await recovery.evaluate(node=>node===document.activeElement),true);
    const save=page.getByRole('link',{name:/^Save prepared package/});
    await save.waitFor();
    assert.equal(downloadsObserved,0,'Preparation must not synthesize a download');
    assert.equal(await recovery.evaluate(node=>node===document.activeElement),true);
    await page.keyboard.press('Tab');
    assert.equal(await save.evaluate(node=>node===document.activeElement && node.matches(':focus-visible')),true);
    const originalBlob=await save.getAttribute('href'); assert.ok(originalBlob.startsWith('blob:'));
    const download=page.waitForEvent('download'); await page.keyboard.press('Enter');
    const received=await download; assert.equal(received.suggestedFilename(),'recovery-synthetic.zip');
    const receivedPath=await received.path();
    assert.equal(readFileSync(receivedPath,'utf8'),'synthetic package bytes');
    const evidence=process.env.FORMA_RECOVERY_EVIDENCE_DIR;
    if(evidence){mkdirSync(evidence,{recursive:true});await received.saveAs(resolve(evidence,`prepared-${profile.width}-dpr${profile.dpr}-synthetic.zip`));}
    await page.waitForFunction(()=>document.querySelector('.output-package-recovery')?.textContent.includes('Check your browser'));
    assert.match(await page.locator('#test-ledger').innerText(),/Exports: 1; downloads: 1/);
    assert.equal(await save.getAttribute('href'),originalBlob);
    assert.equal(await save.evaluate(node=>node===document.activeElement && node.matches(':focus-visible')),true);
    // Native focus can start the application's smooth scroll; wait for the actual
    // focused control to enter the viewport instead of capturing an animation frame.
    await page.waitForFunction(()=>{const r=document.querySelector('.output-package-parts a')?.getBoundingClientRect();return r && r.top>=6 && r.bottom<=innerHeight-6;},{},{timeout:2000});
    const layout=await page.evaluate(()=>{const rect=document.querySelector('.output-package-parts a').getBoundingClientRect();return{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth-innerWidth,focusTop:rect.top,focusBottom:rect.bottom};});
    assert.equal(layout.overflow,0);
    assert.ok(layout.focusTop>=0 && layout.focusBottom<=layout.height, JSON.stringify({layout,focusBefore,focusAfterTab}));
    const shot=await page.screenshot({fullPage:false,scale:'device',...(evidence?{path:resolve(evidence,`recovery-${profile.width}-dpr${profile.dpr}.png`)}:{})});
    const captured={width:shot.readUInt32BE(16),height:shot.readUInt32BE(20)};
    assert.equal(captured.width,layout.width*layout.dpr);assert.equal(captured.height,layout.height*layout.dpr);
    assert.deepEqual(errors,[]);
    // The shipped stylesheet imports Google Fonts. Keep it blocked and declare
    // fallback-font layout coverage; no network access is needed for this check.
    assert.ok(foreign.every(url=>url==='https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap'));
    const repeated=page.waitForEvent('download');await page.keyboard.press('Enter');await repeated;
    assert.equal(await save.getAttribute('href'),originalBlob);
    assert.match(await page.locator('#test-ledger').innerText(),/Exports: 1; downloads: 1/);
    const direct=page.getByRole('link',{name:/^Download through browser/}),beforeDirect=browserPackageGets;
    await page.keyboard.press('Tab');assert.equal(await direct.evaluate(node=>node===document.activeElement),true);
    const directDownload=page.waitForEvent('download');await page.keyboard.press('Enter');const directFile=await directDownload;
    assert.equal(readFileSync(await directFile.path(),'utf8'),'synthetic package bytes');assert.equal(browserPackageGets,beforeDirect+1);
    assert.equal(page.url(),origin+'/');assert.match(await page.locator('#test-ledger').innerText(),/Exports: 1; downloads: 1/);
    await direct.scrollIntoViewIfNeeded();
    if(evidence)await page.screenshot({scale:'device',path:resolve(evidence,`fallback-${profile.width}-dpr${profile.dpr}.png`)});
    receipts.push({profile,layout,captured,exportPosts:1,downloadGets:1,nativeSaves:downloadsObserved,browserFallbackGets:1,keyboardFocus:'preserved',actualBrowserDownload:'exact synthetic fixture bytes only; not a production ZIP',blockedFontRequests:foreign.length});
    await context.close();
  }
  for(const profile of [{width:360,height:900,dpr:2},{width:1280,height:900,dpr:1}]){
    const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.dpr});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await context.route('**/*',route=>route.request().url().startsWith(`http://127.0.0.1:${server.address().port}/`)?route.continue():route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/?preview`);
    const region=page.locator('[data-preview-result="result-a"]'),thumb=region.getByRole('button',{name:/^Enlarge exact file/});
    await region.scrollIntoViewIfNeeded();await thumb.waitFor();
    const image=thumb.locator('img');await image.evaluate(async image=>image.decode());
    const initialBlob=await image.getAttribute('src');
    await region.focus();await page.keyboard.press('Tab');
    assert.equal(await thumb.evaluate(node=>node===document.activeElement),true,JSON.stringify({errors,body:await page.locator('body').innerText()}));
    await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    assert.equal(await thumb.evaluate(node=>node===document.activeElement&&node.matches(':focus-visible')),true);
    assert.equal(await image.getAttribute('src'),initialBlob);
    await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await dialog.waitFor();
    assert.equal(await dialog.locator('img').getAttribute('src'),initialBlob);
    await page.keyboard.press('Escape');assert.equal(await thumb.evaluate(node=>node===document.activeElement&&node.matches(':focus-visible')),true);
    await page.getByRole('button',{name:'Reorder local results'}).click();
    await region.scrollIntoViewIfNeeded();await thumb.waitFor();
    // Existing-result identity must not be recycled onto the other result.
    assert.equal(await region.getAttribute('data-preview-result'),'result-a');
    await region.focus();await page.keyboard.press('Tab');await page.keyboard.press('Enter');await dialog.waitFor();
    await page.keyboard.press('Escape');assert.equal(await thumb.evaluate(node=>node===document.activeElement),true);
    const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth-innerWidth}));
    assert.equal(layout.overflow,0);assert.deepEqual(errors,[]);
    const evidence=process.env.FORMA_RECOVERY_EVIDENCE_DIR;
    const shot=await page.screenshot({scale:'device',...(evidence?{path:resolve(evidence,`preview-${profile.width}-dpr${profile.dpr}.png`)}:{})});
    assert.equal(shot.readUInt32BE(16),layout.width*layout.dpr);assert.equal(shot.readUInt32BE(20),layout.height*layout.dpr);
    receipts.push({profile,mode:'preview',layout,focus:'region-Tab-thumbnail-Tab-ShiftTab-Enter-Escape verified',reorder:'same result opens and restores focus',media:'two-pixel synthetic control only'});
    await context.close();
  }
  console.log(JSON.stringify({status:'passed',component:entry.file,receipts},null,2));
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
