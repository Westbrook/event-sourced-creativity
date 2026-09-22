import { readStudyBody } from '../native-host/transport.mjs';
import { hash } from '../core.mjs';
import { LIMITS,identifier,parseExact,usageReceipt,inspectResponse } from './contract.mjs';
/** Invoked only after irreversible intent. No default retry, redirect, SDK, polling, checker or evaluator. */
export async function submitPreparation(plan,{fetchOnce,signal,checkpoint}){
  const response=await fetchOnce(plan.request.endpoint,{method:'POST',body:plan.request.body,redirect:'error',signal,headers:{'content-type':'application/json','X-Client-Request-Id':`forma-preparation-${hash(plan.id).slice(0,32)}`}});
  const header=response.headers.get('x-request-id'),requestId=identifier(header)?header:null;
  await checkpoint({phase:'headers',requestId,httpStatus:response.status});
  const raw=await readStudyBody(response,signal,LIMITS.responseBytes),receiptHash=hash(raw);
  let body=null;try{body=parseExact(raw,LIMITS.responseBytes);}catch{/* Retain bounded malformed bytes after financial identity. */}
  const usage=usageReceipt(body);
  await checkpoint({phase:'receipt',requestId,httpStatus:response.status,receiptHash,responseId:identifier(body?.id)?body.id:null,returnedModel:identifier(body?.model)?body.model:null,usage});
  const result=body?inspectResponse(body,plan,response.status):{outcome:'invalid'};
  return {...result,raw,requestId,receiptHash,usage};
}
