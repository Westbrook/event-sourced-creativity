import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import ts from "typescript";

const parse=path=>ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const previewSyntax=parse("../src/components/consequential-preview.ts"),previewNode=previewSyntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="consequentialPreview");
assert.ok(previewNode,"The reused production consequential preview exists");
function catalog(locale){
  const syntax=parse(locale==="en"?"../src/components/design-system/localization.ts":`../src/components/design-system/locales/${locale}.ts`),messages={};
  function visit(node){if(ts.isPropertyAssignment(node)&&ts.isStringLiteralLike(node.name)&&ts.isStringLiteralLike(node.initializer))messages[node.name.text]=node.initializer.text;ts.forEachChild(node,visit);}visit(syntax);return messages;
}
function quote(privateInput={}){return{operation:"adaptive-structure",projectId:"project-1",documentId:"document-1",canvasId:"canvas-1",providerAvailable:true,budgetAvailable:true,unavailableReasons:[],provider:"OpenAI",models:["fixture-model"],maximumMicrousd:5000,providerCalls:1,actorLabel:"Fixture actor",workspaceId:null,period:"2026-08",publicQuery:"",sourceHash:"exact-source-hash",expiresAt:"2026-08-27T23:00:00Z",privateInput:{scope:"whole-project",projectTitle:"Projet «Mara»",documentTitle:"Mara — 原文",canvasTitle:"Planche originale",documentCount:1,blockCount:3,libraryBlockCount:1,canvasBlockCount:1,protectedBlockCount:3,...privateInput}};}
// Actual shared preview and catalog strings, with an in-memory Lit rendering port.
// Routed preparation and exact paid serialization are covered in assistant-runtime.test.mjs.
function render(locale,preview=quote()){
  const messages=catalog(locale),nothing=Symbol("nothing"),string=value=>Array.isArray(value)?value.map(string).join(""):value===nothing?"":String(value??""),html=(parts,...values)=>parts.reduce((result,part,index)=>result+part+(index<values.length?string(values[index]):""),"");
  const i18n={number:value=>new Intl.NumberFormat(locale).format(value),t:(key,_fallback,values={})=>{assert.ok(Object.hasOwn(messages,key),`${locale}: ${key} must not fall back to English`);return messages[key].replace(/\{(\w+)\}/gu,(_match,name)=>{assert.ok(Object.hasOwn(values,name),`${key}: ${name}`);return String(values[name]);});}};
  const consequentialPreview=eval(stripTypeScriptTypes("("+previewNode.getText(previewSyntax).replace(/^export\s+/,"")+")")),markup=consequentialPreview(preview,i18n);
  return{markup,summary:markup.split("<details>")[0],messages,i18n};
}
const sourceLabels={en:["Source documents","Library decisions","Canvas decisions"],fr:["Documents sources","Décisions de la bibliothèque","Décisions des tableaux"],ar:["المستندات المصدرية","قرارات المكتبة","قرارات اللوحات"],ja:["参照元の文書","ライブラリの決定事項","キャンバスの決定事項"]};
for(const locale of["en","fr","ar","ja"])test(`adaptive preview: localized source breakdown is human-readable in ${locale}`,()=>{
  const preview=quote(),{summary,messages,i18n}=render(locale,preview),one=i18n.number(1);
  for(const label of sourceLabels[locale])assert.ok(summary.includes(`<dt>${label}</dt><dd>${one}</dd>`),`${locale}: visible ${label} count`);
  assert.ok(summary.includes(i18n.t("planning.consent.scopeProject","",{count:i18n.number(3),title:preview.privateInput.projectTitle})));
  assert.ok(summary.includes(preview.privateInput.documentTitle+" / "+preview.privateInput.canvasTitle));
  assert.ok(summary.includes(i18n.t("planning.consent.protected","",{count:i18n.number(3)})));
  assert.doesNotMatch(summary,/planning\.consent\.|libraryBlockCount|canvasBlockCount/u);
  assert.doesNotMatch(messages["planning.consent.scopeProject"],/\{documents\}/u,"Total active decisions must not all be attributed to documents");
});
test("adaptive preview: older saved quotes do not invent missing Library or Canvas zero counts",()=>{
  const preview=quote();delete preview.privateInput.libraryBlockCount;delete preview.privateInput.canvasBlockCount;
  const{summary}=render("en",preview);assert.ok(summary.includes("<dt>Source documents</dt><dd>1</dd>"));assert.doesNotMatch(summary,/<dt>(?:Library|Canvas) decisions<\/dt>/u);
});
test("adaptive preview: known zero counts remain visible, but invalid counts are not coerced",()=>{
  const zero=render("en",quote({documentCount:0,libraryBlockCount:0,canvasBlockCount:3})).summary;assert.ok(zero.includes("<dt>Source documents</dt><dd>0</dd>"));assert.ok(zero.includes("<dt>Library decisions</dt><dd>0</dd>"));assert.ok(zero.includes("<dt>Canvas decisions</dt><dd>3</dd>"));
  for(const value of["1",-1,null,1.5,Number.POSITIVE_INFINITY])assert.doesNotMatch(render("en",quote({libraryBlockCount:value,canvasBlockCount:value})).summary,/<dt>(?:Library|Canvas) decisions<\/dt>/u);
});
test("adaptive preview: document-only requests do not claim whole-project source counts",()=>{
  const{summary}=render("en",quote({scope:"document",blockCount:1,libraryBlockCount:0,canvasBlockCount:0}));assert.doesNotMatch(summary,/<dt>(?:Source documents|Library decisions|Canvas decisions)<\/dt>/u);assert.ok(summary.includes("1 active decisions"));assert.ok(summary.includes("Mara — 原文"));
});
