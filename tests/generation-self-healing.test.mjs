import test from "node:test";
import assert from "node:assert/strict";
import { DOCUMENT_ARTIFACT_KINDS } from "../src/model/document-artifacts.ts";
import { generationRepairPages, generationValidationReceipt } from "../worker/generation-self-healing.ts";

const issue=(overrides={})=>({
  code:"duplicate_artifact_content",
  path:"items.0.body",
  message:"PRIVATE authored source text and https://private.example/secret must never become reconciliation evidence.",
  ...overrides,
});

test("records privacy-safe, pending adapter reconciliation after successful self-healing for every medium",()=>{
  for(const kind of DOCUMENT_ARTIFACT_KINDS){
    const receipt=generationValidationReceipt(kind,[
      {stage:"initial",issues:[issue()],pageIndex:0,providerAttempt:1},
      {stage:"repair",issues:[],pageIndex:0,providerAttempt:2},
    ],{adapterId:"openai-document",adapterVersion:"2026-08-26-v1",finalIssues:[]});

    assert.deepEqual(receipt.validation_history.map(({stage,issue_count})=>[stage,issue_count]),[["initial",1],["repair",0]],kind);
    assert.deepEqual(receipt.adapter_reconciliation.issue_codes,["duplicate_artifact_content"],kind);
    assert.deepEqual(receipt.adapter_reconciliation.issue_frequencies,{duplicate_artifact_content:1},kind);
    assert.deepEqual(receipt.adapter_reconciliation.issue_fingerprints,["duplicate_artifact_content@items.0.body"],kind);
    assert.equal(receipt.adapter_reconciliation.artifact_kind,kind);
    assert.equal(receipt.adapter_reconciliation.status,"pending",kind);
    assert.equal(receipt.adapter_reconciliation.required,true,kind);
    assert.equal(receipt.adapter_reconciliation.self_healed,true,kind);
    assert.equal(receipt.adapter_reconciliation.final_issue_count,0,kind);
    assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|private\.example|authored source text/u,kind);
  }
});

test("rejects unsafe authored strings, structural paths, and adapter identifiers in reconciliation evidence",()=>{
  const receipt=generationValidationReceipt("slides",[{
    stage:"initial",
    issues:[issue({code:"PRIVATE secret value",path:"items.0.PRIVATE-source-id"})],
    pageIndex:-1,
    providerAttempt:0,
  }],{adapterId:"https://private.example/adapter",adapterVersion:"PRIVATE adapter version",finalIssues:[]});

  assert.deepEqual(receipt.validation_history[0],{
    stage:"initial",
    issue_count:1,
    issues:[{code:"generation_validation_failed",path:"$"}],
  });
  assert.equal(receipt.adapter_reconciliation.adapter_id,"document-artifact");
  assert.equal(receipt.adapter_reconciliation.adapter_version,"unknown");
  assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|private\.example/u);
});

test("distinguishes clean generations from repaired and unresolved validation failures",()=>{
  const clean=generationValidationReceipt("audio",[{stage:"initial",issues:[]}],{finalIssues:[]});
  assert.equal(clean.adapter_reconciliation.status,"not_required");
  assert.equal(clean.adapter_reconciliation.required,false);
  assert.equal(clean.adapter_reconciliation.self_healed,false);

  const unresolved=generationValidationReceipt("video",[
    {stage:"initial",issues:[issue()]},
    {stage:"repair",issues:[issue()]},
  ],{finalIssues:[issue()]});
  assert.equal(unresolved.adapter_reconciliation.status,"pending");
  assert.equal(unresolved.adapter_reconciliation.self_healed,false);
  assert.equal(unresolved.adapter_reconciliation.final_issue_count,1);
  assert.deepEqual(unresolved.adapter_reconciliation.issue_frequencies,{duplicate_artifact_content:2});
});

test("bounds retained evidence without losing its actual validation failure count",()=>{
  const issues=Array.from({length:130},(_,index)=>issue({path:`items.${index}.body`}));
  const receipt=generationValidationReceipt("storyboard",[{stage:"initial",issues}],{finalIssues:[]});

  assert.equal(receipt.validation_history[0].issue_count,130);
  assert.equal(receipt.validation_history[0].issues.length,128);
  assert.equal(receipt.adapter_reconciliation.issue_count,130);
});

test("repairs only affected pages unless an issue is global, unknown, or outside the production",()=>{
  const options={pageCount:3,pageSize:8};
  assert.deepEqual(generationRepairPages([issue({path:"items.8.body"}),issue({path:"items.17.title"})],options),[1,2]);
  for(const path of ["content_markdown","items","$","items.32.body"]){
    assert.deepEqual(generationRepairPages([issue({path})],options),[0,1,2],path);
  }
  assert.deepEqual(generationRepairPages([],options),[]);
  assert.deepEqual(generationRepairPages([issue()],{pageCount:0,pageSize:8}),[]);
  assert.deepEqual(generationRepairPages([issue()],{pageCount:3,pageSize:0}),[]);
});
