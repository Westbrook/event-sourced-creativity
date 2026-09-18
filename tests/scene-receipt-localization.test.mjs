import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { documentGenerationInputInspection } from "../src/model/generation-inputs.ts";

// Reuse the actual full composer, Store, source Worker and input-dialog fixture.
// Only test registration is omitted. No production method or locale dependency is replaced.
const fixtureUrl=new URL("./scene-composer-recovery.test.mjs",import.meta.url);
const fixtureSource=fs.readFileSync(fixtureUrl,"utf8"),fixtureTree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fixtureDeclarations=fixtureTree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)
  ||ts.isExpressionStatement(node)&&ts.isBinaryExpression(node.expression)&&node.expression.left.getText(fixtureTree)==="fixtureModule"
  ||ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(fixtureTree)==="fixtureHook.deregister");
const fixtureModule=fixtureDeclarations.map(node=>node.getFullText(fixtureTree)).join("\n")
  +"\nexport { originalScene, createSceneComposer, invokeReceipt, receiptReady, closeReceipt, receiptComponent, sceneJobs, loadActual, GenerationInputDialog };\n";
const fixtureModuleUrl=new URL("./scene-receipt-localization-fixture.mjs",import.meta.url).href;
const fixtureHook=registerHooks({resolve(specifier,context,next){return specifier===fixtureModuleUrl?{url:fixtureModuleUrl,shortCircuit:true}:next(specifier,context);},
  load(url,context,next){return url===fixtureModuleUrl?{format:"module",source:fixtureModule,shortCircuit:true}:next(url,context);}});
const {originalScene,createSceneComposer,invokeReceipt,receiptReady,closeReceipt,receiptComponent,sceneJobs,loadActual,GenerationInputDialog}=await import(fixtureModuleUrl);
fixtureHook.deregister();
const {localizeTemplateResult}=await loadActual("src/components/design-system/localized-template.ts");

const labels={
  en:{format:"Scene",attempt:"attempt",completed:"Completed generation inputs",failed:"Failed generation inputs",in_progress:"Generation in progress"},
  fr:{format:"Scène",attempt:"tentative",completed:"Entrées de génération terminée",failed:"Entrées de génération échouée",in_progress:"Génération en cours"},
  ar:{format:"مشهد",attempt:"المحاولة",completed:"مدخلات عملية الإنشاء المكتملة",failed:"مدخلات عملية الإنشاء الفاشلة",in_progress:"الإنشاء قيد التقدم"},
  ja:{format:"シーン",attempt:"試行",completed:"完了した生成の入力",failed:"失敗した生成の入力",in_progress:"生成中"},
};
// Match the presentational-element localization boundary for every actual nested template.
// The template-to-node and native-modal ports remain the existing fixture, not browser/AT evidence.
function withAutomaticLocalization(f){
  const value=f.renderer.value;
  f.renderer.value=function(template,...args){return value.call(this,localizeTemplateResult(template,f.i18n),...args);};
  f.draw();return f;
}
const decode=value=>value.replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&amp;","&").replaceAll("&quot;",'"').replaceAll("&#39;","'");
function nodeText(markup,node){
  const start=markup.indexOf(node.full);assert.notEqual(start,-1,"actual node belongs to rendered markup");
  const bodyStart=start+node.full.length,end=markup.indexOf("</"+node.tag+">",bodyStart);assert.notEqual(end,-1);
  return decode(markup.slice(bodyStart,end).replace(/<[^>]+>/gu,"")).trim();
}
function header(f,component){
  const dialog=f.renderer.ownNodes(component,"dialog").find(node=>node.attributes.class==="generation-input-dialog");
  assert.ok(dialog?.open,"the actual input dialog native port is open");
  const titleId=dialog.attributes["aria-labelledby"];assert.equal(typeof titleId,"string");assert.ok(titleId);
  const headings=f.renderer.ownNodes(component,"h2").filter(node=>node.attributes.id===titleId);
  assert.equal(headings.length,1,"the dialog has one exact labelled-by heading");
  const subtitle=f.renderer.ownNodes(component,"span")[0];assert.ok(subtitle);
  return{title:nodeText(component.markup,headings[0]),subtitle:nodeText(component.markup,subtitle)};
}
function unchangedPrivatePresentation(f,component,before){
  assert.deepEqual(component.inspection,before,"rendering never rewrites the inspection or original receipt");
  const textareas=f.renderer.ownNodes(component,"textarea");
  const receipt=textareas.find(node=>node.attributes.class==="generation-input-receipt");assert.ok(receipt);
  assert.equal(receipt.value,JSON.stringify(before.receipt,null,2),"copyable private JSON stays byte-for-byte intact");
  if(before.prompt)assert.ok(textareas.some(node=>node.value===before.prompt),"the exact authored or private prompt remains intact");
}

for(const locale of ["en","fr","ar","ja"])for(const shared of [false,true])
test("Scene receipt localization "+locale+"/"+(shared?"shared":"personal")+": all seven exact original statuses",async t=>{
  const {h,f,id}=await originalScene(t,{locale,shared,status:"queued"});withAutomaticLocalization(f);
  for(const [index,status] of sceneJobs.entries())await t.test(status,async()=>{
    if(index){await f.openScene();await f.check();}
    const attempt=[0,1,1,2,2,2,0][index];
    h.worker.sqlite.prepare("UPDATE document_jobs SET status=?,attempt_count=?,completed_at=? WHERE job_id=?")
      .run(status,attempt,["completed","failed","partial","canceled"].includes(status)?new Date().toISOString():null,id);
    await f.check();const counts=h.worker.counts(),job=h.worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(id),requests=h.requests.length;
    await invokeReceipt(f);await receiptReady(f);
    try{
      const component=receiptComponent(f),before=structuredClone(component.inspection);
      const outcome=status==="completed"?"completed":["failed","partial","canceled"].includes(status)?"failed":"in_progress";
      const rendered=header(f,component);
      assert.equal(before.receipt.job.job_id,id);assert.equal(before.receipt.job.status,status);assert.equal(before.receipt.job.document_id,h.request.documentId);
      assert.equal(before.title,labels.en[outcome],"the original system inspection value is not rewritten");
      assert.equal(before.subtitle,"scene · attempt "+attempt,"the original inspection data stays unchanged");
      assert.equal(rendered.title,labels[locale][outcome],"the programmatic dialog name is localized from typed system metadata");
      assert.equal(rendered.subtitle,labels[locale].format+" · "+labels[locale].attempt+" "+f.i18n.number(attempt),"format and exact attempt use the current locale");
      assert.deepEqual(before.systemHeader,{format:"scene",attemptCount:attempt});
      assert.ok(JSON.stringify(before.receipt).includes("The keeper checks the harbor."),"the actual private frozen source is still available");
      f.draw();unchangedPrivatePresentation(f,receiptComponent(f),before);
      assert.deepEqual(h.worker.counts(),counts,"inspection and localization do not create work or budget holds");
      assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(id),job,"localization never rewrites the original job");
      assert.equal(h.requests.slice(requests).every(request=>!request.init?.method||request.init.method==="GET"),true,"the handoff is read-only");
    }finally{await closeReceipt(f);}
  });
});

for(const locale of ["en","fr","ar","ja"])test("Scene receipt localization "+locale+": untyped authored headings, private prompt and receipt are never translated",async t=>{
  const f=withAutomaticLocalization(await createSceneComposer(t,{locale}));
  f.host.disconnectedCallback();f.host.isConnected=false;
  const component=new GenerationInputDialog();component.isConnected=true;f.host=component;component.connectedCallback();
  const inspection={title:"Generation in progress",subtitle:"Scene · attempt 0",prompt:"Completed generation inputs\n<Author> & العميل — 顧客 {source}",
    receipt:{authored_title:"Failed generation inputs",private_source:"Génération en cours — الإنشاء قيد التقدم — 生成中",prompt:"<Author> & {do not translate}",attempt_count:0},
    retained:true,outcome:"in_progress"};
  component.inspection=structuredClone(inspection);component.open=true;f.draw();
  assert.deepEqual(header(f,component),{title:inspection.title,subtitle:inspection.subtitle},"untyped dynamic values are not treated as system strings");
  unchangedPrivatePresentation(f,component,inspection);
  const copy=f.renderer.ownNodes(component,"button").find(node=>nodeText(component.markup,node)===f.i18n.system("Copy receipt"));assert.ok(copy);
  await copy.handlers.click.call(component,{target:copy,currentTarget:copy});
  assert.equal(f.clipboard.at(-1),JSON.stringify(inspection.receipt,null,2),"copying still uses the original private JSON");
  const close=f.renderer.ownNodes(component,"button").find(node=>node.attributes.class==="button primary");assert.ok(close);
  close.handlers.click.call(component,{target:close,currentTarget:close});await f.flush();assert.equal(component.open,false);
});

test("Scene receipt localization: typed metadata is scoped to Scene, leaving other inspection families unchanged",()=>{
  const common={jobId:"system-label-scope",documentId:"document-label-scope",status:"running",kind:"render_document",attemptCount:12,members:[],result:{artifactKind:"scene"}};
  const scene=documentGenerationInputInspection(common,[],{});
  assert.deepEqual(scene.systemHeader,{format:"scene",attemptCount:12});
  assert.equal(scene.title,"Generation in progress");assert.equal(scene.subtitle,"scene · attempt 12");
  for(const kind of ["short_story","slides","storyboard","video","audio"]){
    const inspection=documentGenerationInputInspection({...common,result:{artifactKind:kind}},[],{});
    assert.equal(Object.hasOwn(inspection,"systemHeader"),false,kind+" remains outside this scoped presentation change");
    assert.equal(inspection.subtitle,kind.replaceAll("_"," ")+" · attempt 12");
  }
});
