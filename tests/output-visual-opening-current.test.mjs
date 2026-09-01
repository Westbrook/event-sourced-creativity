import assert from "node:assert/strict";
import test,{after} from "node:test";
import { lifecyclePage, ports } from "./helpers/creative-next-action-navigation-fixture.mjs";
const originalFetch=globalThis.fetch;let external=0;
globalThis.fetch=async()=>{external++;throw Error("No external/provider transport in lifecycle opening controls");};
after(()=>{assert.equal(external,0);globalThis.fetch=originalFetch;});

for(const boundary of["pointerdown","keydown"])test("actual child image promotion refuses newer "+boundary+" during deferred render",async t=>{
  const f=await lifecyclePage(t,{route:"document"}),OutputVisual=(await ports.loadActual("src/components/output-visual.ts")).OutputVisual;
  const output={id:"exact-image",documentId:f.documentId,sequence:1,provider:"fixture",quality:"high",purpose:"final",mediaUrl:"/api/media/exact",width:800,height:600};
  const host=new OutputVisual();host.tag="forma-output-visual";host.attributes={};host.output=output;host.viewerOnly=true;host.isConnected=true;
  const previousHost=f.host;f.host=host;f.renderer.draw(host);
  const {captureOutputNavigationFocus}=await ports.loadActual("src/components/output-navigation-focus.ts");
  const focus=captureOutputNavigationFocus(f.native.document);
  assert.equal(host.openImageViewer(undefined,{current:()=>focus.current()}),true);
  f.native.emit(boundary);f.renderer.draw(host);
  assert.equal(host.querySelector("dialog")?.open??false,false);
  assert.ok(!f.trace.some(value=>value==="open:modal generated-image-viewer"));
  focus.dispose();host.disconnectedCallback();f.host=previousHost;
});

test("actual image opening releases only its opening guard and keeps healthy fan controls",async t=>{
  const f=await lifecyclePage(t,{route:"document"}),OutputVisual=(await ports.loadActual("src/components/output-visual.ts")).OutputVisual;
  const first={id:"fan-a",documentId:f.documentId,sequence:1,provider:"fixture",quality:"high",purpose:"final",mediaUrl:"/api/media/a",promptFanId:"fan",promptTechnique:"prose",width:800,height:600};
  const second={...first,id:"fan-b",sequence:2,mediaUrl:"/api/media/b",promptTechnique:"bullets"};
  const host=new OutputVisual();host.tag="forma-output-visual";host.attributes={};host.output=first;host.fanOutputs=[second];host.readOnly=true;host.viewerOnly=true;host.isConnected=true;
  const previousHost=f.host;f.host=host;
  let current=true;assert.equal(host.openImageViewer(undefined,{current:()=>current}),true);f.renderer.draw(host);
  assert.equal(host.querySelector("dialog")?.open,true);current=false;
  const next=f.renderer.ownNodes(host,"button").find(value=>value.classList.contains("next"));assert.ok(next);
  next.handlers.click.call(host,{target:next,currentTarget:next});f.renderer.draw(host);
  assert.equal(host.querySelector("dialog")?.open,true);
  assert.equal(host.querySelector("dialog").getAttribute("aria-labelledby"),"generated-image-title-fan-b");
  assert.deepEqual(f.store.events.get().map(value=>value.eventId),JSON.parse(f.originalSource).map(value=>value.eventId));
  host.disconnectedCallback();f.host=previousHost;
});
