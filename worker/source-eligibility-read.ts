import type { WorkerEnv, EventReadProof } from './runtime.ts';
import { hostedIdentity, readNativeRetainedPrincipal, opaque } from './native-retained-text-custody.ts';
import { readSourceAuthority } from './source-authority-receipt.ts';
import { readSourceEligibilityMetadata, SOURCE_ELIGIBILITY_LIMITS, metadataKind } from './source-eligibility-metadata.ts';
import { sourceAdvisoryInputs } from '../src/model/source-advisory.ts';
import { evidenceSha256 } from './generation-evidence.ts';
import { OPENAI_IMAGE_MODERATION_CONTRACT } from './openai-image-route-contract.ts';
import { canonicalConsent } from './consequential-consent.ts';

export const SOURCE_ELIGIBILITY_PATH='/api/source-advisory-eligibility';
const headers={'cache-control':'private, no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'};
const safeCodes=new Set(['source_principal_unsupported','source_identity_unsupported','source_capacity','source_envelope_invalid','source_custody_unavailable','source_envelope_mismatch','source_semantics_unsupported','source_document_unavailable','source_pins_unsupported','source_snapshot_capacity','source_scope_unsupported','source_scope_changed','source_database_changed','source_census_incomplete','source_census_capacity','source_census_changed','metadata_incomplete','metadata_changed','authority_changed','principal_changed','personal_principal_required','selected_document_unavailable']);
const safeReason=(error:unknown)=>error instanceof Error&&safeCodes.has(error.message)?error.message:'authority_unavailable';
const fail=(code:string):never=>{throw Error(code);};

/** Owner-selected diagnostic, not a preflight or evidence capture. All stages
 * are read-only. No account initializer, content dereference or provider import. */
export async function handleSourceEligibilityRead(request:Request,env:WorkerEnv):Promise<Response>{
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 const base={schemaVersion:'source-advisory-eligibility-v1',limits:SOURCE_ELIGIBILITY_LIMITS,observationReady:false,executionAuthorized:false};
 const url=new URL(request.url),documentId=url.searchParams.get('documentId');
 if(request.method!=='GET')return json({...base,status:'unavailable',reason:'method_not_allowed'},405);
 if(!documentId||!opaque.test(documentId)||url.searchParams.getAll('documentId').length!==1||[...url.searchParams.keys()].some(k=>k!=='documentId'))return json({...base,status:'unavailable',reason:'invalid_selection'},400);
 const db=env.DB;
 // Raw credential is held only for reference equality during this request, never
 // hashed, logged, serialized or reported as a verified account identity.
 const key=env.OPENAI_API_KEY,config=canonicalConsent({project:env.OPENAI_PROJECT,pilot:env.FORMA_PILOT_COHORT_ID,admins:env.FORMA_ADMIN_EMAILS});
 const live=()=>{if(env.DB!==db||env.OPENAI_API_KEY!==key||config!==canonicalConsent({project:env.OPENAI_PROJECT,pilot:env.FORMA_PILOT_COHORT_ID,admins:env.FORMA_ADMIN_EMAILS}))fail('authority_changed');};
 const proofs:EventReadProof[]=[];
 try{
  const identity=hostedIdentity(request);if(!identity||env.FORMA_PILOT_COHORT_ID?.trim())fail('personal_principal_required');
  const principal=await readNativeRetainedPrincipal(env,identity!);live();
  const statement=db.prepare(`WITH ${principal.auth.cte} SELECT auth_json FROM authorized`).bind(...principal.auth.bindings);
  proofs.push({statements:[statement],verify(results){if(results.length!==1||results[0]?.success!==true||results[0].results?.length!==1||results[0].results[0].auth_json!==principal.principal.auth_json)fail('principal_changed');}});
  const measured=await readSourceEligibilityMetadata(env,identity!.userId,documentId);live();proofs.push(measured.proof);
  if(measured.metadata.complete&&measured.selectedOrigins!==1)fail('selected_document_unavailable');
  const reasons:string[]=[];let source:Record<string,unknown>={status:'not-qualified'};
  const metadata=measured.metadata;
  if(!metadata.complete)reasons.push('metadata_incomplete');
  if(metadata.count!==null&&metadata.count>128)reasons.push('source_census_capacity');
  if(metadata.largestCellBytes>65536||metadata.payloadCodepointLowerBound>512000)reasons.push('source_capacity');
  for(const [code,count] of Object.entries(metadata.exclusions))if(count)reasons.push(code);
  if(!reasons.length){
   const unsupported=new Map<string,number>();
   try{
    const authority=await readSourceAuthority(env,{userId:identity!.userId,streamId:'creative:'+identity!.userId},documentId,(kind,eligible)=>{if(!eligible){const safe=metadataKind(kind);unsupported.set(safe,(unsupported.get(safe)??0)+1);}},proof=>proofs.push(proof));live();proofs.push(authority.proof);
    const inputs=sourceAdvisoryInputs(authority.snapshot),snapshot=JSON.stringify(authority.snapshot);
    source={status:'qualified',receiptVersion:authority.receipt.version,documentRevision:authority.receipt.documentRevision,sourceSha256:authority.receipt.sourceSha256,
     censusSha256:await evidenceSha256(canonicalConsent(authority.receipt.dependencies)),dependencyCount:authority.receipt.dependencies.length,
     snapshotUtf16Length:snapshot.length,snapshotUtf8Length:new TextEncoder().encode(snapshot).length,
     manifest:await Promise.all(inputs.input.map(async(text,i)=>({index:i,kind:inputs.mapping[i]!.kind,sourceIndex:inputs.mapping[i]!.sourceIndex,truncated:inputs.mapping[i]!.truncated,utf16Length:text.length,utf8Length:new TextEncoder().encode(text).length,sha256:await evidenceSha256(text)})))};
   }catch(error){reasons.push(safeReason(error));source={status:'unavailable',unsupportedKinds:[...unsupported].sort(([a],[b])=>a.localeCompare(b)).map(([kind,count])=>({kind,count}))};}
  }
  const statements=proofs.flatMap(p=>[...p.statements]),results=await db.batch<Record<string,unknown>>(statements);let offset=0;
  if(results.length!==statements.length)fail('authority_changed');
  for(const proof of proofs){proof.verify(results.slice(offset,offset+proof.statements.length));offset+=proof.statements.length;}live();
  return json({...base,status:source.status==='qualified'?'eligible':'ineligible',metadataMeasured:metadata.complete,sourceQualified:source.status==='qualified',metadata,source,reasons,
   configuration:{provider:'openai',endpoint:OPENAI_IMAGE_MODERATION_CONTRACT.api,requestedModel:OPENAI_IMAGE_MODERATION_CONTRACT.model,credentialConfigured:Boolean(key),projectHeaderConfigured:Boolean(env.OPENAI_PROJECT),credentialIdentity:'unknown',providerProjectIdentity:'unknown'},
   next:source.status==='qualified'?'Separate exact current configuration/credential/revision and price rechecks plus user approval required before one preflight-only observation.':'Resolve the reported complete-census capacity/custody/semantics gap without changing source or weakening eligibility.'});
 }catch(error){return json({...base,status:'unavailable',metadataMeasured:false,sourceQualified:false,reason:safeReason(error)},409);}
}
