import test from "node:test";
import assert from "node:assert/strict";
import { measureFormaFocusVisibility as observe } from "./helpers/forma-dom-focus-visibility.mjs";

// Pure observer-contract tests. These finite DOM inputs exercise the actual
// observer; they do not simulate browser rasterization or establish native pass.
const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
function fixture() {
  const plain = {
    display: "block", position: "static", zIndex: "auto", opacity: "1", visibility: "visible", pointerEvents: "auto",
    transform: "none", translate: "none", rotate: "none", scale: "none", perspective: "none", transformStyle: "flat",
    filter: "none", backdropFilter: "none", clipPath: "none", clip: "auto", maskImage: "none", contain: "none",
    containerType: "normal", contentVisibility: "visible", mixBlendMode: "normal", isolation: "auto", willChange: "auto",
    zoom: "1", viewTransitionName: "none", maskBorderSource: "none", WebkitMaskBoxImageSource: "none", overlay: "none", overflowX: "visible", overflowY: "visible", overflowClipMargin: "0px",
    borderLeftWidth: "0px", borderRightWidth: "0px", borderTopWidth: "0px", borderBottomWidth: "0px",
    borderTopLeftRadius: "0px", borderTopRightRadius: "0px", borderBottomLeftRadius: "0px", borderBottomRightRadius: "0px",
    scrollbarWidth: "auto", scrollbarGutter: "auto", boxShadow: "none", outlineStyle: "none", outlineWidth: "0px",
    outlineOffset: "0px", outlineColor: "transparent", outline: "none",
  };
  const style = values => {
    const result = { ...plain, ...values };
    result.getPropertyValue = name => name.startsWith("corner-") ? "round"
      : result[name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? "";
    return result;
  };
  const doc = { location: { href: "http://fixture.invalid/" }, hasFocus: () => true };
  class Element {
    constructor(tag, className, box, css = {}) {
      Object.assign(this, { tagName: tag, className, box, css: style(css), ownerDocument: doc, isConnected: true,
        children: [], parentElement: null, shadowRoot: null, assignedSlot: null, id: "", textContent: "", scrollTop: 0, scrollLeft: 0,
        clientLeft: 0, clientTop: 0, clientWidth: box.width, clientHeight: box.height,
        offsetWidth: box.width, offsetHeight: box.height, scrollWidth: box.width, scrollHeight: box.height });
    }
    append(node) { node.parentElement = this; this.children.push(node); }
    get localName() { return this.tagName.toLowerCase(); }
    contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
    closest(selector) { for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current; return null; }
    get firstElementChild() { return this.children[0] ?? null; }
    getBoundingClientRect() { return this.box; }
    getClientRects() { return [this.box]; }
    getAnimations() { return this.animations ?? []; }
    getRootNode() { return doc; }
    getAttribute(name) { return name === "class" ? this.className : name === "aria-label" ? this.ariaLabel ?? null : null; }
    hasAttribute(name) { return this.attributes?.has(name) ?? false; }
    matches(selector) {
      return selector.split(",").some(part => {
        const value = part.trim();
        if (value === ":modal" || value === "dialog:modal") return this instanceof Dialog && this.open === true;
        if (value === ":popover-open") return this.popoverOpen === true;
        const attribute = /^([a-z]*)\[([^=\]]+)(?:=([^\]]+))?\]$/.exec(value);
        if (attribute) return (!attribute[1] || this.localName === attribute[1])
          && (attribute[3] ? this[attribute[2]] === attribute[3] : this.hasAttribute(attribute[2]));
        if (value === ":focus" || value === ":focus-visible") return this === doc.activeElement;
        if (value.startsWith(":")) return false;
        const [tag, ...classes] = value.split(".");
        return (!tag || this.tagName.toLowerCase() === tag) && classes.every(item => this.className.split(" ").includes(item));
      });
    }
    querySelectorAll(selector) {
      if (selector === ":scope > header") return this.children.filter(node => node.tagName === "HEADER");
      const descendants = this.children.flatMap(node => [node, ...node.querySelectorAll("*")]);
      return selector === "*" ? descendants : descendants.filter(node => node.matches(selector));
    }
  }
  class Button extends Element {}
  class Dialog extends Element {}
  const html = new Element("HTML", "", rect(0, 0, 1280, 900));
  const body = new Element("BODY", "", html.box);
  const modal = new Dialog("DIALOG", "modal canvas-document-outputs-dialog", html.box,
    { display: "grid", position: "fixed", zIndex: "100", overflowX: "hidden", overflowY: "hidden", backdropFilter: "blur(10px)", overlay: "auto" });
  modal.open = true;
  const card = new Element("DIV", "modal-card canvas-document-outputs-card", rect(232, 24, 1256, 908),
    { display: "grid", position: "relative", overflowX: "hidden", overflowY: "hidden", scrollbarGutter: "stable",
      borderLeftWidth: "1px", borderRightWidth: "1px", borderTopWidth: "1px", borderBottomWidth: "1px",
      borderTopLeftRadius: "14px", borderTopRightRadius: "14px", borderBottomLeftRadius: "14px", borderBottomRightRadius: "14px" });
  Object.assign(card, { clientLeft: 1, clientTop: 1, clientWidth: 1007, clientHeight: 882, offsetWidth: 1024, offsetHeight: 884 });
  const close = new Button("BUTTON", "icon-button modal-close", rect(1180, 41, 1224, 85),
    { display: "flex", position: "absolute", outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "8px",
      outlineColor: "rgb(36, 69, 175)", outline: "rgb(36, 69, 175) solid 3px" });
  close.ariaLabel = "Close document outputs";
  const header = new Element("HEADER", "", rect(281, 25, 1240, 190));
  const title = new Element("H2", "", rect(281, 100, 600, 140));
  html.append(body); body.append(modal); modal.append(card); card.append(close); card.append(header); header.append(title);
  Object.assign(doc, { documentElement: html, body, activeElement: close,
    querySelectorAll: selector => selector === "*" ? [html, ...html.querySelectorAll("*")]
      : [html, ...html.querySelectorAll("*")].filter(node => node.matches(selector)),
    elementFromPoint: () => close, elementsFromPoint: () => [close, header, card, modal, html] });
  const win = { innerWidth: 1280, innerHeight: 900, devicePixelRatio: 1, navigator: { userAgent: "Chromium/140.0" },
    Element, CSS: { supports: () => true }, HTMLElement: Element, HTMLButtonElement: Button, HTMLDialogElement: Dialog,
    getComputedStyle: (node, pseudo) => pseudo === "::-webkit-scrollbar" ? { width: "auto", height: "auto" }
      : pseudo ? { content: "none", display: "none", position: "static", zIndex: "auto", ...node.pseudo }
      : node.css };
  win.top = win; doc.defaultView = win;
  return { close, card, modal, header, title, doc, Element, Button, Dialog, run: (fn = observe) => fn(close,
    { requireFocusVisible: true, checkVisibleControls: false, overlaySelectors: ["header"] }) };
}


// Reuses the retained finite DOM fixture above. This saved R6 geometry proves
// only the observer contract, not browser rasterization or an R6 native pass.
function roundedFixture() {
  const f=fixture();
  f.doc.defaultView.innerWidth=320; f.doc.defaultView.innerHeight=800;
  f.modal.box=rect(0,0,320,800);
  Object.assign(f.modal,{clientWidth:320,clientHeight:800,offsetWidth:320,offsetHeight:800});
  f.card.box=rect(4,4,316,796);
  Object.assign(f.card,{clientLeft:1,clientTop:1,clientWidth:310,clientHeight:790,
    offsetWidth:312,offsetHeight:792,scrollWidth:310,scrollHeight:792});
  f.card.css.scrollbarGutter="auto";
  f.close.box=rect(182.828125,742.609375,302.203125,786.609375);
  f.close.css.outlineOffset="3px";
  f.header.box=rect(20,20,100,60); f.title.box=rect(20,20,80,50);
  return f;
}
const proof=result=>result.focus.ancestors[0].roundedProof;

test("R6-sized envelope requires newly observed exact padding witnesses",()=>{
  const f=roundedFixture(), result=f.run();
  assert.deepEqual(result.failures,[]); assert.deepEqual(result.unassessed,[]); assert.equal(result.pass,true);
  const p=proof(result);
  assert.equal(p.paddingWitness.exact,true); assert.equal(p.integerInset,0); assert.equal(p.radius,14);
  assert.deepEqual(p.client,rect(5,5,315,795));
  assert.deepEqual(result.focus.envelope,rect(176.828125,736.609375,308.203125,792.609375));
  assert.deepEqual(p.paddingWitness.metrics,{clientLeft:1,clientTop:1,clientWidth:310,clientHeight:790,offsetWidth:312,offsetHeight:792});
  assert.equal(p.paddingWitness.rectCount,1); assert.deepEqual(p.paddingWitness.raw,p.paddingWitness.singleRect);
  assert(result.focus.hitSamples.every(hit=>hit.targetFirst));
});

test("fractional origins and RTL preserve matching hidden-overflow geometry",()=>{
  const f=roundedFixture();
  for(const node of [f.card,f.close]) node.box=rect(node.box.left+.25,node.box.top+.25,node.box.right+.25,node.box.bottom+.25);
  f.card.css.direction="rtl"; f.doc.defaultView.devicePixelRatio=2;
  const result=f.run(); assert.equal(result.pass,true); assert.equal(proof(result).paddingWitness.exact,true);
  assert.deepEqual(proof(result).client,rect(5.25,5.25,315.25,795.25));
});

for (const [name,change] of [
  ...["auto","scroll","clip","visible"].flatMap(value=>["overflowX","overflowY"].map(axis=>[axis+" "+value,f=>{f.card.css[axis]=value;}])),
  ...["stable","stable both-edges"].map(value=>["reserved gutter "+value,f=>{f.card.css.scrollbarGutter=value;}]),
  ...["0.5px","NaNpx","-1px","calc(1px)"].map(value=>["unsupported border "+value,f=>{f.card.css.borderLeftWidth=value;}]),
  ...["clientLeft","clientTop","clientWidth","clientHeight","offsetWidth","offsetHeight"].map(key=>["inconsistent "+key,f=>{f.card[key]+=.25;}]),
  ["fractional native width",f=>{f.card.box=rect(4,4,316.25,796);}],
  ["fractional native height",f=>{f.card.box=rect(4,4,316,796.25);}],
  ["inconsistent native width field",f=>{f.card.box={...f.card.box,width:312.25};}],
  ["inconsistent native height field",f=>{f.card.box={...f.card.box,height:792.25};}],
  ["nonfinite native origin",f=>{f.card.box={...f.card.box,left:NaN};}],
  ["multiple native boxes",f=>{f.card.getClientRects=()=>[f.card.box,f.card.box];}],
  ["different single native box",f=>{f.card.getClientRects=()=>[rect(4,4,316.25,796)];}],
  ["transform",f=>{f.card.css.transform="matrix(1, 0, 0, 1, 0, 0)";}],
  ["translate",f=>{f.card.css.translate="1px";}],
  ["rotate",f=>{f.card.css.rotate="1deg";}],
  ["scale",f=>{f.card.css.scale="1";}],
  ["perspective",f=>{f.card.css.perspective="100px";}],
  ["CSS zoom",f=>{f.card.css.zoom="1.01";}],
  ["filter",f=>{f.card.css.filter="blur(1px)";}],
  ["clip path",f=>{f.card.css.clipPath="inset(0)";}],
  ["legacy clip",f=>{f.card.css.clip="rect(0px, 310px, 790px, 0px)";}],
  ["mask",f=>{f.card.css.maskImage="linear-gradient(black,black)";}],
  ["paint containment",f=>{f.card.css.contain="paint";}],
  ["unsupported intervening target transform",f=>{f.close.css.transform="matrix(1, 0, 0, 1, 0, 0)";}],
  ["non-round corner",f=>{f.card.css.getPropertyValue=name=>name.startsWith("corner-")?"bevel":"";}],
  ["custom scrollbar",f=>{const read=f.doc.defaultView.getComputedStyle; f.doc.defaultView.getComputedStyle=(node,pseudo)=>pseudo==="::-webkit-scrollbar"?{width:"8px",height:"8px"}:read(node,pseudo);}],
  ["unsupported engine",f=>{f.doc.defaultView.navigator.userAgent="Firefox/140.0";}],
  ["table fragmentation category",f=>{f.card.css.display="table";}],
]) test("exact padding proof refuses "+name,()=>{
  const f=roundedFixture();change(f);const result=f.run(),p=proof(result);
  assert.equal(p?.paddingWitness?.exact??false,false);
  if(p?.integerInset!==null&&p?.integerInset!==undefined) assert.equal(p.integerInset,1);
  assert.equal(result.pass,false);
});

test("exact padding cannot admit an envelope outside the conservative round corner",()=>{
  const f=roundedFixture();f.close.box=rect(183.828125,742.609375,303.203125,786.609375);
  const result=f.run(),p=proof(result);
  assert.equal(p.paddingWitness.exact,true);assert.equal(p.integerInset,0);assert.equal(p.inside,false);
  assert(result.unassessed.some(row=>row.code==="focus-complex-geometry"));assert.equal(result.pass,false);
});

test("actual rectangular clipping remains a failure with exact padding and five owned hits",()=>{
  const f=roundedFixture();f.close.box=rect(182.828125,746,302.203125,790);
  const result=f.run();assert.equal(proof(result).paddingWitness.exact,true);
  assert(result.focus.hitSamples.every(hit=>hit.targetFirst));
  assert(result.failures.some(row=>row.code==="focus-envelope-clipped"));assert.equal(result.pass,false);
});

test("ordinary rounding fallback still admits envelopes that fit its entire conservative region",()=>{
  const f=roundedFixture();f.card.css.overflowY="auto";
  f.close.box=rect(181.828125,740.609375,301.203125,784.609375);
  const result=f.run();assert.equal(proof(result).paddingWitness.exact,false);
  assert.equal(proof(result).integerInset,1);assert.equal(proof(result).inside,true);assert.equal(result.pass,true);
});

test("body obstruction is not cleared by exact rounded containment",()=>{
  const f=roundedFixture();f.doc.elementFromPoint=()=>f.header;
  const result=f.run();assert.equal(proof(result).paddingWitness.exact,true);
  assert(result.failures.some(row=>row.code==="target-hit-obstructed"));assert.equal(result.pass,false);
});
