import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
const focusImports = registerOutputSourceImports();
const { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus } = await import("../src/components/output-navigation-focus.ts");
focusImports.deregister();

function nativeDocument() {
  const listeners=new Map(),body={tagName:"BODY",isConnected:true},html={tagName:"HTML",isConnected:true};
  const document={activeElement:body,body,documentElement:html,
    addEventListener(type,handler,capture){assert.equal(capture,true);listeners.set(type,[...(listeners.get(type)??[]),handler]);},
    removeEventListener(type,handler,capture){assert.equal(capture,true);listeners.set(type,(listeners.get(type)??[]).filter(value=>value!==handler));},
    querySelectorAll(){return[];}};
  const field=(name,tagName="INPUT")=>({tagName,isConnected:true,name,getAttribute:()=>null});
  const emit=(type,target=document.activeElement)=>{for(const handler of [...(listeners.get(type)??[])])handler({type,target});};
  const focus=target=>{document.activeElement=target;emit("focusin",target);};
  const count=()=>[...listeners.values()].reduce((sum,rows)=>sum+rows.length,0);
  return{document,listeners,field,emit,focus,count};
}
for(const event of["pointerdown","keydown","focusin","unobserved-focus"])test("opening lease is irreversibly interrupted by "+event,()=>{
 const f=nativeDocument(),first=f.field("first"),newer=f.field("newer");f.focus(first);
 const lease=captureOutputNavigationFocus(f.document);assert.equal(f.count(),3);assert.equal(lease.current(),true);
 if(event==="focusin")f.focus(newer);
 else if(event==="unobserved-focus")f.document.activeElement=newer;
 else f.emit(event);
 assert.equal(lease.current(),false);f.document.activeElement=f.document.body;assert.equal(lease.current(),false);
 assert.equal(f.count(),0);lease.dispose();assert.equal(f.count(),0);
});
test("neutral body, document root and disconnected origin permit only the still-owned opening",()=>{
 const f=nativeDocument(),first=f.field("old Canvas control");f.focus(first);const lease=captureOutputNavigationFocus(f.document);
 first.isConnected=false;assert.equal(lease.current(),true);
 for(const value of[f.document.body,f.document.documentElement,null]){f.document.activeElement=value;assert.equal(lease.current(),true);}
 lease.dispose();assert.equal(f.count(),0);assert.equal(lease.current(),false);
});
test("exact synchronous owned focus succeeds; another focus during it cancels later work",()=>{
 const f=nativeDocument(),target=f.field("target","SECTION"),other=f.field("other");
 const positive=captureOutputNavigationFocus(f.document);let scrolled=0;
 assert.equal(positive.run(target,()=>{f.focus(target);if(!positive.current())return false;scrolled++;return true;}),true);
 assert.equal(scrolled,1);positive.dispose();assert.equal(f.count(),0);
 f.document.activeElement=f.document.body;const interrupted=captureOutputNavigationFocus(f.document);
 assert.equal(interrupted.run(target,()=>{f.focus(target);f.focus(other);if(!interrupted.current())return false;scrolled++;return true;}),false);
 assert.equal(scrolled,1);assert.equal(f.document.activeElement,other);assert.equal(f.count(),0);
});
test("a disposed or disconnected target cannot resurrect an opening",()=>{
 const f=nativeDocument(),target=f.field("old target"),lease=captureOutputNavigationFocus(f.document);target.isConnected=false;
 let work=0;assert.equal(lease.run(target,()=>{work++;return true;}),false);lease.dispose();target.isConnected=true;
 assert.equal(lease.run(target,()=>{work++;return true;}),false);assert.equal(work,0);assert.equal(f.count(),0);
});
function linkedAnchor() {
 const f=nativeDocument(),reference={documentId:"document-a",blockId:"direction-a"},store={route:{get:()=>"/document/document-a/owned#context=direction-a"}};
 let active=true;const owner={isConnected:true,store,block:{id:"direction-a",documentId:"document-a"},surface:"document",querySelectorAll:()=>[anchor]};
 const anchor={...f.field("actual linked context","ARTICLE"),getAttribute:name=>name==="data-block-id"?"direction-a":null,closest:()=>owner};
 f.document.querySelectorAll=selector=>{assert.equal(selector,"forma-context-block");return[owner];};
 const owned=outputNavigationOwnedRouteFocus(f.document,store,reference,()=>active);
 return{...f,reference,store,owner,anchor,owned,revoke(){active=false;}};
}
test("only exact bound native ARTICLE is permitted as owned route autofocus",()=>{
 const f=linkedAnchor();assert.equal(f.owned(f.anchor),true);
 const lease=captureOutputNavigationFocus(f.document,{ownedRouteFocus:f.owned});f.focus(f.anchor);assert.equal(lease.current(),true);
 lease.dispose();assert.equal(f.count(),0);
});
for(const change of["wrong-attribute","wrong-tag","descendant-input","different-store","different-document","different-block","different-surface","duplicate-owner","unbound-anchor","different-route","withdrawn-current","no-output-anchor"])
test("owned route focus rejects "+change,()=>{
 const f=linkedAnchor();let element=f.anchor;
 if(change==="wrong-attribute")f.anchor.getAttribute=()=>"other";
 else if(change==="wrong-tag")f.anchor.tagName="SECTION";
 else if(change==="descendant-input")element={...f.anchor,tagName:"INPUT"};
 else if(change==="different-store")f.owner.store={};
 else if(change==="different-document")f.owner.block.documentId="document-b";
 else if(change==="different-block")f.owner.block.id="direction-b";
 else if(change==="different-surface")f.owner.surface="library";
 else if(change==="duplicate-owner")f.document.querySelectorAll=()=>[f.owner,{...f.owner}];
 else if(change==="unbound-anchor")f.anchor.closest=()=>null;
 else if(change==="different-route")f.store.route.get=()=>"/document/document-b/other#context=direction-a";
 else if(change==="withdrawn-current")f.revoke();
 else f.owner.querySelectorAll=()=>[];
 assert.equal(f.owned(element),false);
 const lease=captureOutputNavigationFocus(f.document,{ownedRouteFocus:f.owned});f.focus(element);assert.equal(lease.current(),false);assert.equal(f.count(),0);
});
test("an owned-route predicate failure closes listeners instead of granting focus",()=>{
 const f=nativeDocument(),lease=captureOutputNavigationFocus(f.document,{ownedRouteFocus(){throw Error("withdrawn");}});
 f.focus(f.field("newer"));assert.equal(lease.current(),false);assert.equal(f.count(),0);
});

test("a later focusin on the original connected field is a newer focus, not an unchanged baseline",()=>{
 const f=nativeDocument(),first=f.field("original");f.focus(first);
 const lease=captureOutputNavigationFocus(f.document);assert.equal(lease.current(),true);
 f.document.activeElement=f.document.body;assert.equal(lease.current(),true);
 f.focus(first);assert.equal(lease.current(),false);assert.equal(f.count(),0);
});
