import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { presentationCandidateEditableFields, applyPresentationCandidateEdits, historicalPresentationValidationRejection, safePresentationCandidateIssues, sanitizePresentationCitationChecks } from "../src/model/presentation-candidates.ts";
import { publicEventPayload } from "../worker/event-privacy.ts";

const current = "test-current-adapter";
const viewerSource = await readFile(new URL("../src/components/presentation-rejected-drafts.ts", import.meta.url), "utf8");
const syntax = ts.createSourceFile("presentation-rejected-drafts.ts", viewerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const viewerClass = syntax.statements.find((entry) => ts.isClassDeclaration(entry) && entry.name?.text === "PresentationRejectedDrafts");
const actualMethod = (name) => {
  const method = viewerClass?.members.find((entry) => ts.isMethodDeclaration(entry) && entry.name.getText(syntax) === name);
  assert.ok(method, `the real private viewer method ${name} remains present`);
  return method.getText(syntax);
};
const harness = ts.transpileModule(`
const nothing = Symbol("nothing");
const html = (strings, ...values) => ({strings:[...strings],values});
export class PrivateViewer {
  #preserving = "";
  #revisionBusy=false;
  #revisionEditor(){return nothing;}
  #editCandidate(){throw new Error("No implicit revision");}
  i18n = { number:(value,options={})=>new Intl.NumberFormat("en",options).format(value), date:()=>"fixture retention", t:(_key,fallback,values={})=>fallback.replace(/\\{(\\w+)\\}/g,(_match,key)=>String(values[key]??"")) };
  #slide() { return nothing; }
  #preserveCandidate() { throw new Error("test must not preserve a rejected draft"); }
  ${actualMethod("#requestedCountLabel")}
  ${actualMethod("#citationChecks")}
  ${actualMethod("#candidate")}
  render(detail) { return this.#candidate(detail); }
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { PrivateViewer } = await import(`data:text/javascript,${encodeURIComponent(harness.outputText)}`);
const visibleText = (value) => {
  if (value === null || value === undefined || typeof value === "symbol" || typeof value === "function") return "";
  if (Array.isArray(value)) return value.map(visibleText).join("");
  if (value && typeof value === "object" && Array.isArray(value.strings)) return value.strings.map((part,index)=>part+visibleText(value.values[index])).join("");
  return String(value);
};

test("previous source and structure rejections remain review-only across adapter upgrades", () => {
  for (const version of [undefined, "test-previous-adapter"]) {
    for (const evidence of [
      { generationReceipt: { failure_stage: "source_fidelity_validation" } },
      { generationReceipt: { failure_code: "source_fidelity_validation_failed" } },
      { errorDetail: { code: "provider_returned_incomplete_document_artifact" } },
      { errorDetail: { validationIssues: [{ code: "ungrounded_citation_excerpt" }] } },
    ]) {
      const checkpoint = { ...evidence, generationReceipt: { ...evidence.generationReceipt, ...(version ? { presentation_adapter_version: version } : {}) } };
      const before = structuredClone(checkpoint);
      assert.equal(historicalPresentationValidationRejection(checkpoint, current), true);
      assert.deepEqual(checkpoint, before, "historical accounting and validation evidence stay immutable");
    }
  }
});

test("current adapter and legacy valid responses with only persistence failures keep existing recovery checks", () => {
  assert.equal(historicalPresentationValidationRejection({ generationReceipt: {
    presentation_adapter_version: current, failure_code: "source_fidelity_validation_failed",
  } }, current), false);
  for (const version of [undefined, "test-previous-adapter"]) assert.equal(historicalPresentationValidationRejection({
    generationReceipt: { presentation_adapter_version: version, failure_stage: "local_persistence", failure_code: "local_persistence_failed" },
    errorDetail: { code: "local_persistence_failed" },
  }, current), false);
});

test("public citation issues discard provider wording and private citation evidence", () => {
  const issues = safePresentationCandidateIssues([{
    code: "ungrounded_citation_excerpt", path: "items.0.slide.citations.0.excerpt",
    message: "PRIVATE submitted excerpt", excerpt: "PRIVATE excerpt", passages: [{ content: "PRIVATE frozen source" }],
  }], { pageIndex: 0, pageCount: 1, globalStartIndex: 0, providerAttempt: 2, stage: "repair" });
  assert.equal(issues[0].category, "source-integrity");
  assert.doesNotMatch(JSON.stringify(issues), /PRIVATE|frozen source/u);
  assert.equal(Object.hasOwn(issues[0], "excerpt"), false);
  assert.equal(Object.hasOwn(issues[0], "passages"), false);
  const projected = publicEventPayload("private-diagnostic-event", { validation_issues: [
    { ...issues[0], citationChecks: [{ excerpt: "PRIVATE excerpt", passages: [{ content: "PRIVATE frozen source" }] }] },
  ], citationChecks: [{ excerpt: "PRIVATE excerpt" }] });
  assert.doesNotMatch(JSON.stringify(projected.payload), /PRIVATE|citationChecks|passages/u);
});

test("private citation checks retain separate validation statuses but never expose passage identifiers", () => {
  const input = [{ slideIndex: 0, citationIndex: 0, sourceLabel: "Research PRIVATE_BLOCK_ID", excerpt: "Exact evidence from blk_007.",
    sourceStatus: "unassigned", excerptStatus: "grounded", anchorStatus: "incorrect",
    passages: [{ id: "PRIVATE_PASSAGE_ID", content: "Frozen evidence from PRIVATE_BLOCK_ID. " + "x".repeat(12_000) }],
  }];
  const checks = sanitizePresentationCitationChecks(input, ["PRIVATE_BLOCK_ID"]);
  assert.equal(checks[0].sourceStatus, "unassigned");
  assert.equal(checks[0].excerptStatus, "grounded", "a legitimate quotation can still cite evidence not assigned to this slide");
  assert.equal(checks[0].anchorStatus, "incorrect");
  assert.equal(checks[0].excerpt, "Exact evidence from [private source].");
  assert.equal(checks[0].passages[0].content.length, 12_000);
  assert.equal(checks[0].passages[0].truncated, true);
  assert.doesNotMatch(JSON.stringify(checks), /PRIVATE_BLOCK_ID|PRIVATE_PASSAGE_ID|blk_007/u);
  assert.equal(Object.hasOwn(checks[0].passages[0], "id"), false);
  assert.equal(input[0].passages[0].id, "PRIVATE_PASSAGE_ID", "display sanitization never rewrites original private evidence");
});

test("the real restricted viewer separates citation assignment, quotation text, and total job charges", () => {
  const detail = {
    title: "Synthetic rejected response", summary: "Synthetic review fixture", stage: "repair", providerAttempt: 2, providerCalls: 2,
    requestedSlideCount: 14, plannedSlideCount: 14, pageIndex: 1, pageCount: 2, globalStartIndex: 8, generatedSlideCount: 6,
    settledCostMicrousd: 135008, accounting: { settled_cost_microusd: 135008, settled_cost_complete: true,
      reservation_microusd: 0, reservation_status: "settled", actual_provider_call_count: 2,
      attempted_provider_call_count: 2, unresolved_provider_call_count: 0, provider_submission_uncertain: false }, model: "fixture-model", expiresAt: "2026-08-30T00:00:00.000Z", retentionClass: "transient-private",
    missingContextGroupLabels: [], issues: [], normalizationChanges: [], slides: [],
    reviewOnlyReason: "historical-validation-rejection",
    citationChecks: [{ slideIndex: 0, citationIndex: 0, sourceLabel: "Frozen research", excerpt: "Synthetic exact quotation.", excerptTruncated: false,
      sourceStatus: "unassigned", excerptStatus: "grounded", anchorStatus: "valid", passages: [{ content: "Synthetic exact quotation. Frozen supporting research.", truncated: false }],
    }],
  };
  const rendered = visibleText(new PrivateViewer().render(detail));
  for (const text of ["Settled job cost · all calls", "$0.135008", "2 of 2", "earlier validation contract", "Inspect citation grounding", "Slide 9 · citation 1", "Authorized source, but not assigned to this slide", "Matches a contiguous source quotation", "Synthetic exact quotation.", "Resolved frozen source passage"]) assert.ok(rendered.includes(text), text);
  assert.doesNotMatch(actualMethod("#citationChecks"), /@click|<button|href=|navigator\.clipboard|fetch\s*\(/u, "the check panel adds no action that can release private evidence");
  const legacy = visibleText(new PrivateViewer().render({ ...detail, citationChecks: undefined, reviewOnlyReason: undefined }));
  assert.doesNotMatch(legacy, /Inspect citation grounding|earlier validation contract/u);
  assert.match(legacy, /Settled job cost/u);
  const flexible = visibleText(new PrivateViewer().render({ ...detail, requestedSlideCount: null, plannedSlideCount: 8, generatedSlideCount: 9,
    slideCountPolicy: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 },
  }));
  assert.match(flexible, /5–15 \/ 8 slides/u, "the actual viewer shows the accepted range separately from the attempt aim");
  assert.match(visibleText(new PrivateViewer().render({ ...detail, requestedSlideCount: null })), /— \/ 14 slides/u, "unknown exact counts never masquerade as zero");
});


test("visible-field revision patches cannot change evidence, layout, numerical precision, array shape or private identifiers",()=>{
  const raw=JSON.stringify({title:"Synthetic frozen provider response",content_markdown:"Old readable text",items:[{
    title:"Exact authored headline",body:"A retained source claim",notes:"Private unchanged notes",image_prompt:"Private provider directions",context_group_ids:["context_group_1"],
    slide:{layout:"comparison",kicker:"Introduction",bullets:["A visible bullet"],quote:{text:"Protected quote",source_id:"blk_1"},source_ids:["blk_1"],citations:[{source_id:"blk_1",excerpt:"Frozen citation"}],
      visual:{kind:"comparison",label:"Two claims",value:"",exact_value:"61.125",display_value:"61.13",data:[{label:"First",value:"First",source_ids:["blk_1"],weight:1}]}}
  }]});
  const fields=presentationCandidateEditableFields(raw);
  assert.ok(fields.some(field=>field.path==="items.0.slide.visual.data.0.value"));
  assert.ok(fields.every(field=>!/(?:source_|citation|quote|notes|image_prompt|layout|exact_value|display_value|weight|context_group)/u.test(field.path)));
  const edited=applyPresentationCandidateEdits(raw,[{path:"items.0.slide.visual.data.0.value",value:"Distinct visible evidence"}]);
  assert.ok(edited);assert.deepEqual(edited.changedPaths,["items.0.slide.visual.data.0.value"]);
  const before=JSON.parse(raw),after=JSON.parse(edited.raw);after.items[0].slide.visual.data[0].value=before.items[0].slide.visual.data[0].value;
  assert.deepEqual(after,before,"only the selected existing visible leaf can change");
  for(const edit of [
    {path:"items.0.slide.source_ids.0",value:"blk_2"}, {path:"items.0.slide.layout",value:"closing"},
    {path:"items.0.slide.visual.exact_value",value:"100"}, {path:"items.0.slide.bullets.1",value:"An inserted bullet"},
    {path:"items.0.__proto__.body",value:"forged"}, {path:"items.0.body",value:"Leaked blk_007"},
    {path:"items.0.body",value:"Leaked PRIVATE_SOURCE_881"}, {path:"items.0.body",value:{forged:true}},
  ])assert.equal(applyPresentationCandidateEdits(raw,[edit],["PRIVATE_SOURCE_881"]),null);
  assert.equal(applyPresentationCandidateEdits(raw,[{path:"items.0.body",value:"One"},{path:"items.0.body",value:"Two"}]),null);
  assert.equal(applyPresentationCandidateEdits(raw,[{path:"items.0.body",value:"x".repeat(8_001)}]),null);
  assert.equal(JSON.parse(raw).items[0].slide.visual.data[0].value,"First","the retained original stays immutable");
});

const revisionMember = (name) => {
  const member = viewerClass.members.find(entry => entry.name?.getText(syntax) === name);
  assert.ok(member, `the actual private revision member ${name} is tested`);
  return member.getText(syntax);
};
const revisionHarness=ts.transpileModule(`
const nothing=Symbol("nothing"),html=(strings,...values)=>({strings:[...strings],values});
export class PrivateRevisionViewer {
  documentId="authorized-document";isConnected=true;
  #jobId="revision-job";#jobDocumentId="authorized-document";#privateRevision=0;
  #referenceSource={id:"authorized-source"};#open=true;#busy=false;#preserving="";
  #candidates=[];#details=new Map();#selected=[];#comparison="alternatives";
  ${["#editingResponse","#editValues","#editIssues","#revisionKey","#revisionBusy"].map(revisionMember).join("\n")}
  sourceActive=true;requests=[];messages=[];refreshes=0;response=null;
  i18n={number:value=>String(value),t:(_key,fallback)=>fallback};
  store={captureSourceOwnership:()=>this.#referenceSource,sourceOwnershipActive:()=>this.sourceActive,
    revisePresentationCandidate:async(...args)=>{this.requests.push(args);return await this.response;},
    toast:message=>this.messages.push(message),refreshEvents:async()=>{this.refreshes++;}};
  #rememberJob(){}querySelector(){return null;}requestUpdate(){}
  ${revisionMember("#clearPrivateDrafts")}
  ${["#editCandidate","#cancelRevision","#saveRevision","#revisionEditor"].map(actualMethod).join("\n")}
  begin(detail){this.#editCandidate(detail);}save(detail){return this.#saveRevision(detail);}
  render(detail){return this.#revisionEditor(detail);}
  change(path,value){this.#editValues.set(path,value);}retire(){this.sourceActive=false;this.#clearPrivateDrafts();}
  get state(){return {response:this.#editingResponse,fields:[...this.#editValues],issues:this.#editIssues,key:this.#revisionKey,busy:this.#revisionBusy};}
}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {PrivateRevisionViewer}=await import(`data:text/javascript,${encodeURIComponent(revisionHarness.outputText)}`);
const revisionDetail={jobId:"revision-job",documentId:"authorized-document",responseId:"response-2",slides:[{title:"Synthetic authorized slide"}],
  revision:{token:"a".repeat(64),fields:[{path:"items.0.body",value:"Original private claim"}]}};

test("private editor requires explicit validation action and keeps failed edits out of shared state",async()=>{
  const viewer=new PrivateRevisionViewer();viewer.begin(revisionDetail);
  assert.equal(viewer.requests.length,0,"opening a private editor is neither generation nor promotion");
  assert.match(visibleText(viewer.render(revisionDetail)),/separate unapproved draft/u);
  assert.match(visibleText(viewer.render(revisionDetail)),/no provider request/u);
  viewer.change("items.0.body","A revised private claim");
  viewer.response={issues:[{path:"items.0.body",message:"Still missing source evidence"}]};
  await viewer.save(revisionDetail);
  assert.equal(viewer.requests.length,1);assert.equal(viewer.requests[0][2].confirmed,true);
  assert.deepEqual(viewer.requests[0][2].edits,[{path:"items.0.body",value:"A revised private claim"}]);
  assert.deepEqual(viewer.state.fields,[["items.0.body","A revised private claim"]]);
  assert.equal(viewer.state.issues.length,1);assert.equal(viewer.state.busy,false);assert.equal(viewer.refreshes,0);assert.deepEqual(viewer.messages,[]);
});

test("source retirement clears private edit text and ignores a late successful revision response",async()=>{
  const viewer=new PrivateRevisionViewer();viewer.begin(revisionDetail);viewer.change("items.0.body","PRIVATE unsaved text");
  let resolve;viewer.response=new Promise(done=>{resolve=done;});const save=viewer.save(revisionDetail);
  viewer.retire();resolve({revision:{artifactId:"some-original-scope-artifact",approval:"unapproved"}});await save;
  assert.deepEqual(viewer.state,{response:"",fields:[],issues:[],key:"",busy:false});
  assert.deepEqual(viewer.messages,[]);assert.equal(viewer.refreshes,0);assert.equal(visibleText(viewer.render(revisionDetail)),"");
});

test("successful private revision clears the editor and refreshes the ordinary document without modifying the rejected detail",async()=>{
  const viewer=new PrivateRevisionViewer(),original=structuredClone(revisionDetail);viewer.begin(revisionDetail);
  viewer.response={revision:{artifactId:"new-unapproved-artifact",approval:"unapproved"}};await viewer.save(revisionDetail);
  assert.equal(viewer.requests.length,1);assert.deepEqual(viewer.requests[0][2].edits,[],"explicit reuse is still a new validated human draft");
  assert.equal(viewer.refreshes,1);assert.match(viewer.messages[0],/original failure and charges are unchanged/u);
  assert.deepEqual(viewer.state,{response:"",fields:[],issues:[],key:"",busy:false});assert.deepEqual(revisionDetail,original);
});
