import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {ref} from 'lit/directives/ref.js';
import {PartType} from 'lit/directive.js';

const source=await readFile(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8');
const start=source.indexOf('  #videoPresentation?'),end=source.indexOf('  #imageLoaded',start);
assert(start>=0&&end>start);const block=source.slice(start,end);
// Execute the actual host fields/ref/updated method with only lifecycle ports.
// Actual Lit ref is used; this does not claim full DOM rendering or browser media.
class ElementPort { isConnected=false; }
const body=ts.transpileModule(`class Host extends Base {
 #result; i18n={}; visible=true; nodes=new Set();
 #visible(){return this.visible;}
 contains(node){return this.nodes.has(node);}
 ${block}
 select(result){this.#result=result;}
 bind(node){return this.#mountVideo(node);}
 commit(){if(typeof this.updated==='function')this.updated(new Map());}
}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(){
 const log=[];class Base {updated(){log.push('super.updated');}}
 const Host=new Function('Base','HTMLElement',body+';return Host;')(Base,ElementPort),host=new Host();
 let current=true;
 const result={output:'video',video:Object.freeze({}),current:()=>current,mount(node,_dto,options){
  log.push(['mount',node]);assert(node.isConnected);assert(options.isCurrent());
  let retired=false;return{refresh(){assert(!retired);log.push(['refresh',node]);},dispose(){retired=true;log.push(['dispose',node]);},options};
 }};
 host.select(result);
 const callback=node=>host.bind(node),value=ref(callback);
 const bind=node=>{const directive=new value._$litDirective$({type:PartType.ELEMENT});
  directive.isConnected=true; // Connected Lit part; its new element is not yet inserted.
  return directive.update({type:PartType.ELEMENT,element:node,options:{host}},[callback]);};
 const node=()=>{const n=new ElementPort();host.nodes.add(n);return n;};
 return{host,log,result,bind,node,withdraw(){current=false;}};
}
test('installed Lit invokes ref update before fragment commit; host mounts only from updated',async()=>{
 const litHtml=createRequire(import.meta.resolve('lit')).resolve('lit-html');
 const lit=await readFile(new URL('../development/lit-html.js',pathToFileURL(litHtml)),'utf8');
 const branch=lit.indexOf('const fragment = instance._clone(this.options);');
 const update=lit.indexOf('instance._update(values);',branch),commit=lit.indexOf('this._commitNode(fragment);',branch);
 assert(branch>=0&&update>branch&&commit>update);
 const f=fixture(),node=f.node();f.bind(node);assert.deepEqual(f.log,[]);
 node.isConnected=true;f.host.commit();assert.equal(f.log[0],'super.updated');assert.equal(f.log[1][0],'mount');
 f.host.commit();assert.equal(f.log.filter(x=>Array.isArray(x)&&x[0]==='mount').length,1);assert.equal(f.log.at(-1)[0],'refresh');
});
test('replacement ref for the same result disposes old presentation and mounts only connected new node',()=>{
 const f=fixture(),first=f.node(),second=f.node();f.bind(first);first.isConnected=true;f.host.commit();
 f.bind(second);assert.equal(f.log.at(-1)[0],'dispose');assert.equal(f.log.filter(x=>Array.isArray(x)&&x[0]==='mount').length,1);
 second.isConnected=true;f.host.commit();assert.deepEqual(f.log.at(-1),['mount',second]);
});
test('withdrawn, hidden, foreign or detached nodes cannot mount, and ref removal disposes immediately',()=>{
 for(const mode of ['withdrawn','hidden','foreign','detached','replaced-result']){
  const f=fixture(),node=f.node();f.bind(node);node.isConnected=true;
  if(mode==='withdrawn')f.withdraw();if(mode==='hidden')f.host.visible=false;if(mode==='foreign')f.host.nodes.delete(node);
  if(mode==='detached')node.isConnected=false;if(mode==='replaced-result')f.host.select(undefined);
  f.host.commit();assert(!f.log.some(x=>Array.isArray(x)&&x[0]==='mount'),mode);
 }
 const f=fixture(),node=f.node();f.bind(node);node.isConnected=true;f.host.commit();f.host.bind(undefined);
 assert.deepEqual(f.log.at(-1),['dispose',node]);f.host.commit();assert.equal(f.log.filter(x=>Array.isArray(x)&&x[0]==='mount').length,1);
 assert.match(source,/#clearResult\(\)\s*\{\s*this\.#videoNode = undefined;/u);
});
