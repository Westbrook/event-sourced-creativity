import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { revealAudioTrimFocus } from '../src/components/audio-trim-focus.ts';

function fixture(){
 const rect=(top,height,width=325)=>({top,bottom:top+height,left:25,right:25+width,width,height});
 const state={scrolled:[],top:702,current:true,hidden:false,headerBottom:402,footerTop:724,scrollTop:329};
 const document={visibilityState:'visible',activeElement:null,defaultView:{innerHeight:844,visualViewport:{offsetTop:0,height:844},getComputedStyle:()=>({outlineStyle:'solid',outlineWidth:'2',outlineOffset:'2',display:'block',visibility:'visible',opacity:'1'})}};
 const dialog={isConnected:true,open:true,matches:()=>true,getBoundingClientRect:()=>rect(8,828)};
 const header={getBoundingClientRect:()=>rect(8,state.headerBottom-8)},footer={getBoundingClientRect:()=>rect(state.footerTop,112)};
 const reader={isConnected:true,parentElement:dialog,matches:()=>true,querySelectorAll:selector=>selector.includes('header')?[header]:[footer]};
 const content={isConnected:true,parentElement:reader,offsetHeight:354,clientTop:0,clientHeight:354,scrollHeight:1100,get scrollTop(){return state.scrollTop;},getBoundingClientRect:()=>rect(402,354),scrollTo({top}){state.top-=top-state.scrollTop;state.scrollTop=top;state.scrolled.push(top);}};
 const host={isConnected:true,ownerDocument:document,contains:node=>node===target,closest:()=>content};
 const target={isConnected:true,ownerDocument:document,offsetHeight:54,matches:selector=>selector===':disabled'?false:true,getAttribute:()=>null,getClientRects:()=>[1],getBoundingClientRect:()=>rect(state.top,54),closest:selector=>selector==='forma-audio-trim-editor'?host:selector==='dialog'?dialog:state.hidden?{}:null};
 document.activeElement=target;
 return{state,document,dialog,content,host,target,current:()=>state.current};
}

test('actual reveal helper clears player and outline above sticky footer using only owned content scroll',()=>{
 const f=fixture();assert.equal(revealAudioTrimFocus(f.host,f.target,f.current),true);assert.equal(f.state.scrolled.length,1);
 assert(f.target.getBoundingClientRect().bottom+4<f.state.footerTop);assert.equal(f.document.activeElement,f.target);
});
test('already-clear control does not move focus or scroll',()=>{
 const f=fixture();f.state.top=500;assert.equal(revealAudioTrimFocus(f.host,f.target,f.current),true);assert.deepEqual(f.state.scrolled,[]);
});
test('withdrawn, hidden, closed, foreign-focus and oversized lanes refuse scrolling',()=>{
 for(const change of [f=>{f.state.current=false;},f=>{f.state.hidden=true;},f=>{f.dialog.open=false;},f=>{f.document.activeElement={};},f=>{f.state.footerTop=440;},f=>{f.target.closest=()=>null;}]){
  const f=fixture();change(f);assert.equal(revealAudioTrimFocus(f.host,f.target,f.current),false);assert.deepEqual(f.state.scrolled,[]);
 }
});
test('fresh ownership check before scroll prevents late withdrawal',()=>{
 const f=fixture();let calls=0;assert.equal(revealAudioTrimFocus(f.host,f.target,()=>++calls===1),false);assert.deepEqual(f.state.scrolled,[]);
});

// Run the actual edited async source method, not a duplicate implementation.
const source=readFileSync(new URL('../src/components/audio-trim-editor.ts',import.meta.url),'utf8');
const method=source.slice(source.indexOf('  async #loadPreview('),source.indexOf('  async #previewError(')).replaceAll('#','_');
// The canonical development dependency transpiles only this explicitly owned
// method. No application module, provider, DOM runner or held suite is imported.
import { createRequire } from 'node:module';
const require=createRequire(process.env.FORMA_SOURCE_ROOT ? process.env.FORMA_SOURCE_ROOT+'/package.json' : new URL('../package.json',import.meta.url));
const ts=require('typescript');
const executable=ts.transpileModule('return class {'+method+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
function loadFixture(){
 let resolve;const pending=new Promise(done=>{resolve=done;});let reveals=0,focuses=0,disposed=0;
 const document={activeElement:null},origin={isConnected:true},selection={bytes:new Uint8Array(44),startFrame:0,endFrame:1};
 const audio={isConnected:true,getAttribute:()=>host._previewUrl,focus(){focuses++;document.activeElement=audio;},play(){throw Error('Never auto-play');}};
 const lease={current:()=>true,run:(_target,action)=>action(),dispose(){disposed++;}};
 const Class=Function('trimPcmWav','captureOutputNavigationFocus','revealAudioTrimFocus',executable)(()=>({bytes:new Uint8Array(44)}),()=>lease,()=>{reveals++;});
 const host=new Class();Object.assign(host,{selection,isConnected:true,disabled:false,_invalidRange:false,_previewUrl:null,_audio:audio,ownerDocument:document,updateComplete:pending,requestUpdate(){},contains:node=>node===audio||node===origin});document.activeElement=origin;
 return{host,origin,audio,document,resolve,read:()=>({reveals,focuses,disposed})};
}
test('actual Load method focuses and reveals only after render, without playback',async()=>{
 const f=loadFixture(),pending=f.host._loadPreview({currentTarget:f.origin});assert.deepEqual(f.read(),{reveals:0,focuses:0,disposed:0});f.resolve();await pending;
 assert.deepEqual(f.read(),{reveals:1,focuses:1,disposed:1});URL.revokeObjectURL(f.host._previewUrl);
});
test('actual Load method never reacquires moved focus or withdrawn selection',async()=>{
 for(const change of [f=>{f.document.activeElement={};},f=>{f.host.selection={};},f=>{f.host.isConnected=false;},f=>{f.host.disabled=true;}]){
  const f=loadFixture(),pending=f.host._loadPreview({currentTarget:f.origin});change(f);f.resolve();await pending;
  assert.deepEqual(f.read(),{reveals:0,focuses:0,disposed:1});URL.revokeObjectURL(f.host._previewUrl);
 }
});
test('source keeps native controls, explicit load, retirement and narrow aria-disabled style',()=>{
 assert.match(source,/<audio controls preload="none" tabindex="0"/);assert.doesNotMatch(method,/\.play\(/);
 for(const text of ['audio?.pause()','audio?.removeAttribute("src")','audio?.load()','URL.revokeObjectURL(url)'])assert(source.includes(text));
 const css=readFileSync(new URL('../src/components/audio-trim-editor.css',import.meta.url),'utf8');
 assert.match(css,/dialog\.document-artifact-view\[data-artifact-kind="audio"\].*\[aria-disabled="true"\] \{ cursor: not-allowed; opacity: \.48; \}/);
});
