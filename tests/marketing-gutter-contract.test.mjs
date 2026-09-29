// Public Welcome stylesheet-boundary contracts, not rendered geometry or AT proof.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const postcss=createRequire(import.meta.resolve("vite"))("postcss");
const read=relative=>readFile(new URL(relative,import.meta.url),"utf8");
const [source,html,enhancement,pickerSource]=await Promise.all([
  read("../src/marketing/marketing.css"),read("../marketing.html"),
  read("../src/marketing/main.ts"),read("../src/components/design-system/language-picker.css"),
]);
const root=postcss.parse(source,{from:"src/marketing/marketing.css"});
const value=(rule,property)=>rule.nodes.filter(node=>node.type==="decl"&&node.prop===property).at(-1)?.value;
const rules=(parent,selector)=>parent.nodes.filter(node=>node.type==="rule"&&node.selectors?.includes(selector));
function ownedRule(parent,selector,property){
  const found=rules(parent,selector).filter(rule=>value(rule,property)!==undefined);
  assert.equal(found.length,1,selector+" has one direct owner for "+property);
  return found[0];
}
function media(params,ownerSelector){
  const found=root.nodes.filter(node=>node.type==="atrule"&&node.name==="media"&&node.params===params
    &&(ownerSelector===undefined||rules(node,ownerSelector).length>0));
  assert.equal(found.length,1,"one existing media boundary: "+params
    +(ownerSelector===undefined?"":" owning "+ownerSelector));return found[0];
}
const compact=media("(min-width: 761px) and (max-width: 960px)");

test("E Welcome: compact header and body share the existing page-gutter token",()=>{
  const token=ownedRule(compact,":root","--marketing-gutter");
  assert.equal(value(token,"--marketing-gutter"),"clamp(1.25rem, 4vw, 2.5rem)");
  assert.equal(value(ownedRule(root,".marketing-header","padding-inline"),"padding-inline"),"var(--marketing-gutter)");
  assert.equal(value(ownedRule(root,".marketing-hero","padding"),"padding"),
    "clamp(3.5rem, 8vw, 7rem) var(--marketing-gutter) clamp(5rem, 9vw, 8rem)");
  for(const selector of [".marketing-header",".marketing-hero",".marketing-section",".marketing-footer"]){
    assert.equal(value(ownedRule(root,selector,"inline-size"),"inline-size"),"min(100%, var(--marketing-max))",selector);
    assert.equal(value(ownedRule(root,selector,"margin-inline"),"margin-inline"),"auto",selector);
  }
});

test("E Welcome: compact header cannot bypass the shared safe-area gutter owner",()=>{
  const peers=[".marketing-header",".marketing-hero",".marketing-section",".marketing-exhibit",
    ".marketing-team",".marketing-finale",".marketing-footer"];
  for(const selector of peers){
    assert.equal(value(ownedRule(root,selector,"padding-left"),"padding-left"),
      "max(var(--marketing-gutter), env(safe-area-inset-left, 0px))",selector+" left");
    assert.equal(value(ownedRule(root,selector,"padding-right"),"padding-right"),
      "max(var(--marketing-gutter), env(safe-area-inset-right, 0px))",selector+" right");
  }
  for(const rule of rules(compact,".marketing-header")){
    const competing=rule.nodes.filter(node=>node.type==="decl"&&/^(?:padding|padding-inline(?:-start|-end)?|padding-left|padding-right)$/u.test(node.prop));
    assert.deepEqual(competing.map(node=>node.prop),[],"medium header does not override physical safe-area padding with an inline shorthand");
  }
});

test("E Welcome: compact navigation keeps its direct links and native public controls",()=>{
  assert.equal(value(ownedRule(compact,".marketing-header","gap"),"gap"),".6rem");
  assert.equal(value(ownedRule(compact,".marketing-navigation","gap"),"gap"),".625rem");
  assert.equal(value(ownedRule(compact,".marketing-navigation a","font-size"),"font-size"),".8125rem");
  const header=html.slice(html.indexOf('<header class="marketing-header">'),html.indexOf('<main id="main-content"'));
  const navigation=header.match(/<nav class="marketing-navigation"[^>]*>([\s\S]*?)<\/nav>/u)?.[1];
  assert.ok(navigation);
  assert.deepEqual([...navigation.matchAll(/href="([^"]+)"/gu)].map(match=>match[1]),
    ["#how-it-works","#motion-study","#for-teams"]);
  assert.match(header,/class="marketing-language__trigger" popovertarget="marketing-language-menu"/u);
  assert.match(header,/id="marketing-language-menu" popover="auto"/u);
  assert.match(header,/class="marketing-button marketing-button--header" href="\/projects"/u);
  assert.equal(value(ownedRule(root,".marketing-navigation a","min-block-size"),"min-block-size"),"2.75rem");
  assert.equal(value(ownedRule(root,".marketing-navigation a","min-inline-size"),"min-inline-size"),"2.75rem");
  assert.equal(value(ownedRule(root,".marketing-language__trigger","min-block-size"),"min-block-size"),"2.75rem");
  assert.match(pickerSource,/min-block-size:\s*var\(--forma-control-min-size,\s*2\.75rem\)/u);
});

test("E Welcome: ordinary narrow and wide postures retain the isolated public contract",()=>{
  assert.equal(value(ownedRule(root,":root","--marketing-gutter"),"--marketing-gutter"),"clamp(1.25rem, 6vw, 7rem)");
  assert.equal(value(ownedRule(root,":root","--marketing-max"),"--marketing-max"),"96rem");
  assert.equal(value(ownedRule(media("(min-width: 1800px)"),":root","--marketing-max"),"--marketing-max"),"100rem");
  const narrow=media("(max-width: 760px)",".marketing-header");
  assert.equal(value(ownedRule(narrow,".marketing-header","display"),"display"),"grid");
  assert.equal(value(ownedRule(narrow,".marketing-navigation","overflow-x"),"overflow-x"),"auto");
  assert.equal(value(ownedRule(narrow,".marketing-navigation a","flex"),"flex"),"0 0 auto");
  const shallow=media("(min-width: 560px) and (max-height: 480px)");
  assert.equal(value(ownedRule(shallow,".marketing-navigation","overflow-x"),"overflow-x"),"auto");
  assert.equal(value(ownedRule(shallow,".marketing-header__actions","flex"),"flex"),"0 0 auto");
  assert.match(html,/<link rel="stylesheet" href="\/src\/marketing\/marketing\.css"\s*\/>/u);
  assert.doesNotMatch(source,/@import|overflow-x:\s*(?:hidden|clip)/u);
  assert.doesNotMatch(enhancement,/fetch\(|navigator\.sendBeacon|FormaStore|\/src\/main/u);
});
