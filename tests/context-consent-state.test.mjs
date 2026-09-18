import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {contextConsentAction,contextConsentFailure} from "../src/model/context-consent-state.ts";

test("consent retrieval remains reachable without new provider access",()=>{
  assert.deepEqual(contextConsentAction("quoted",false),{action:"execute",label:"context.consent.approve",disabled:true});
  for(const status of ["reserved","uncertain","completed","failed"]){
    assert.deepEqual(contextConsentAction(status,false),{action:"retrieve",label:"context.consent.reuse",disabled:false});
  }
});
test("uncertain, running and lost-response states preserve their identity and only retrieve",()=>{
  const quote={executionId:"one-paid-request",status:"quoted",providerAvailable:true};
  for(const outcome of [{status:"reserved"},{status:"uncertain"},{transport:true},{error:"gateway_error"},{error:"context_consent_changed"},{status:"quoted"}]){
    const state=contextConsentFailure(quote,outcome);assert.equal(state.quote.executionId,quote.executionId);assert.equal(state.uncertain,true);
    assert.equal(contextConsentAction(state.quote.status,true).action,"retrieve");
  }
});
test("only proven-unused changed or expired consent can return to a free preview",()=>{
  const quote={executionId:"original",status:"uncertain",providerAvailable:true};
  for(const error of ["context_consent_changed","context_consent_expired"]){
    assert.equal(contextConsentFailure(quote,{error}).quote.executionId,"original");
    const known=contextConsentFailure(quote,{error,submission:"not-submitted"});assert.equal(known.quote,null);assert.equal(known.notice,"refresh");
  }
  const unused=contextConsentFailure(quote,{submission:"not-submitted",status:"quoted"});assert.equal(unused.quote.executionId,"original");assert.equal(unused.quote.status,"quoted");
});
test("completed UI evidence does not regress after retrieval transport loss",()=>{
  const quote={executionId:"saved",status:"completed",providerAvailable:false};
  const next=contextConsentFailure(quote,{transport:true});assert.equal(next.quote.status,"completed");assert.equal(next.uncertain,false);
  assert.equal(contextConsentFailure(quote,{error:"gateway_error"}).quote.status,"completed");
  assert.equal(contextConsentFailure(quote,{error:"context_consent_expired",submission:"not-submitted"}).quote.status,"completed");
});
test("the actual context dialog uses the tested action and error state transitions",()=>{
  const source=readFileSync(new URL("../src/components/context-intelligence.ts",import.meta.url),"utf8");
  assert.match(source,/contextConsentAction\(quote.status,quote.providerAvailable\).action/u);
  assert.match(source,/contextConsentAction\(this.#quote.status,this.#quote.providerAvailable\).disabled/u);
  assert.match(source,/contextConsentFailure\(this.#quote,outcome\)/u);
  assert.match(source,/#consentFailure\(\{transport:true\}\)/u);
  assert.match(source,/if\(result.quote\)this.#quote=result.quote/u);
  assert.doesNotMatch(source,/this.#quote=\{\.\.\.this.#quote,executionId:/u);
  assert.doesNotMatch(source,/#begin\("decompose",true\)/u);
});
