import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript'),source=readFileSync(new URL('../src/components/document-artifacts.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('artifact.ts',source,ts.ScriptTarget.Latest,true),klass=ast.statements.find(s=>ts.isClassDeclaration(s)&&s.members.some(m=>m.name?.getText(ast)==='#download'));
const member=klass.members.find(m=>m.name?.getText(ast)==='#download').getText(ast).replace(/#/gu,'_');
const js=ts.transpileModule('class Actual {'+member+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
function fixture({authorize=async()=>true,current=true,shared=false,clickThrows=false,binding={artifact_revision:0,content_sha256:'a'.repeat(64)},content={content_markdown:'# Scene\n\nINT. STATION — NIGHT\n\nA: Original Scene text.'}}={}){
 const actions=[],links=[],blobs=[],timers=[];
 const document={createElement(tag){assert.equal(tag,'a');const a={href:'',download:'',isConnected:false,click(){assert.equal(this.isConnected,true);actions.push('click');if(clickThrows)throw Error('synthetic browser click failure');},remove(){this.isConnected=false;actions.push('remove');}};links.push(a);return a;},body:{append(link){link.isConnected=true;actions.push('append');}}};
 const URL={createObjectURL(blob){blobs.push(blob);actions.push('blob');return'blob:synthetic';},revokeObjectURL(url){actions.push(['revoke',url]);}};
 const window={setTimeout(fn,delay){actions.push(['cleanup',delay]);timers.push(fn);return 1;}};
 const Actual=Function('Blob','document','URL','window','documentArtifactDefinition',js+';return Actual;')(Blob,document,URL,window,()=>({label:'Scene'}));
 const host=new Actual(),artifact={id:'scene-artifact',kind:'scene',documentId:'scene-document',title:'Station at Night'};
 Object.assign(host,{_content:()=>content,_artifactBinding:async()=>binding,source:'document',i18n:{locale:'en',system:x=>x},store:{captureAuthorizationScope:()=>({shared}),authorizationScopeActive:()=>current,authorizeProjectExport:async(receipt,scope)=>{actions.push(['receipt',receipt]);return authorize(receipt,scope);}}});
 return{host,artifact,actions,links,blobs,timers};
}
test('actual Scene handler exports exact retained Markdown with Scene-derived filename',async()=>{const f=fixture();await f.host._download(f.artifact);assert.equal(await f.blobs[0].text(),'# Scene\n\nINT. STATION — NIGHT\n\nA: Original Scene text.');assert.equal(f.links[0].download,'station-at-night.md');assert.equal(f.blobs[0].type,'text/markdown;charset=utf-8');assert.equal(f.actions.filter(x=>x==='click').length,1);assert.equal(f.actions[0][1].type,'DocumentArtifactExported');assert.equal(f.actions[0][1].payload.artifact_kind,'scene');});
test('pending export receipt produces no browser download even after UI click',async()=>{let resolve;const f=fixture({authorize:()=>new Promise(r=>resolve=r)}),work=f.host._download(f.artifact);await Promise.resolve();await Promise.resolve();assert.equal(f.links.length,0);assert.equal(f.blobs.length,0);resolve(true);await work;assert.equal(f.links.length,1);});
test('refused receipt silently returns without download',async()=>{const f=fixture({authorize:async()=>false});await f.host._download(f.artifact);assert.equal(f.links.length,0);});
test('withdrawn authorization never downloads after receipt',async()=>{const f=fixture({current:false});await f.host._download(f.artifact);assert.equal(f.links.length,0);});
test('shared output without exact binding never requests release',async()=>{const f=fixture({shared:true,binding:null});await f.host._download(f.artifact);assert.deepEqual(f.actions,[]);});
test('acknowledged export connects anchor only for dispatch, with delayed immutable URL cleanup',async()=>{const f=fixture();await f.host._download(f.artifact);assert.deepEqual(f.actions.slice(1),['blob','append','click','remove',['cleanup',60000]]);assert.equal(f.links[0].isConnected,false);f.links[0].href='blob:unrelated';f.timers[0]();assert.deepEqual(f.actions.at(-1),['revoke','blob:synthetic']);});
test('browser dispatch failure removes anchor and still schedules cleanup without retry',async()=>{const f=fixture({clickThrows:true});await assert.rejects(f.host._download(f.artifact),/synthetic browser click failure/u);assert.equal(f.links[0].isConnected,false);assert.equal(f.actions.filter(x=>x==='click').length,1);assert.deepEqual(f.actions.at(-1),['cleanup',60000]);});
