// INTERNAL, disabled, and deliberately absent from product routing. No transport or grant creation.
import { continueOutputTrustedContext } from '../../../worker/output-trusted-context.ts';
import { outputScopeAuthority } from '../../../worker/output-command-core.ts';
import { outputActiveSourceDeadlineAssertions, verifyOutputSourceRead } from '../../../worker/output-disclosure-proof.ts';
import { preparePrivateContent } from '../../../worker/private-content-storage.ts';
import { privateContentScopeGuard } from '../../../worker/pilot-policy.ts';
import { nativeMemoryAnswerExclusion } from '../../../worker/memory-native-boundary.ts';
import { authenticateStudy, checkedBatch } from '../native-host/authority.mjs';
import { hash, canonical } from '../core.mjs';
import { LIMITS, identifier, fail } from './contract.mjs';

export const FREEZE_PRODUCER = 'continueOutputTrustedContext:h5-v1';
const currentHead = t => ({sql:'(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?',bindings:[`creative:${t.scope.ownerUserId}`,t.ownerHead]});
const future = value => typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value && Date.parse(value)>Date.now();
const sourceBytes = t => JSON.stringify({...t.context.snapshot,
  document:{id:t.scope.documentId,title:t.projection.documents.find(d=>d.id===t.scope.documentId).title},standing_constraints:[]});

/** Resolves metadata only from server configuration. Missing billing identity is not inferred from a key/header. */
export function resolveFreezeConfiguration(env) {
  const c=env.FORMA_PREPARATION_CONFIG;
  if(!c)return {available:false,reason:'trusted_configuration_binding_unavailable',configuration:null};
  const model=env.OPENAI_MODEL??'gpt-5.6-terra',basis=env.OPENAI_MODEL?'configured OPENAI_MODEL':'application-default';
  if(!identifier(c.model)||c.model!==model||c.modelBasis!==basis||c.projectHeader!==(env.OPENAI_PROJECT??null)
    ||c.endpoint!=='https://api.openai.com/v1/responses'||c.serviceTier!=='standard'
    ||!['accountId','region','resolutionVersion','resolutionEvidenceRef','credentialBinding'].every(k=>identifier(c[k]))
    ||c.credentialBinding!==env.FORMA_PREPARATION_CREDENTIAL_BINDING||!future(c.expiresAt))fail('freeze_configuration_unqualified');
  return {available:true,configuration:Object.fromEntries(['model','modelBasis','projectHeader','endpoint','serviceTier','accountId','region','resolutionVersion','resolutionEvidenceRef','credentialBinding','expiresAt'].map(k=>[k,c[k]]))};
}

/** This separately bounded private adapter never passes an unsupported expiryCeiling
 * to preparePrivateContent. Native retention supplies an upper limit; our two
 * inserts use an earlier deadline and never update/refresh original content.
 * Deployment/schema qualification remains separate; H3 assertion schema is required.
 */
export function createSourceFreezeAdapter(env) {
  async function context(request,target) {
    if(!identifier(target?.documentId)||!identifier(target?.projectId))fail('freeze_target_required');
    const a=await authenticateStudy(request,env,{recovery:true});
    const t=await continueOutputTrustedContext(request,env,target.documentId,'read',{user:a.user});
    if(t instanceof Response)fail(`freeze_source_unavailable_${t.status}`);
    if(t.scope.kind!=='personal'||t.scope.ownerUserId!==a.user.userId||t.scope.projectId!==target.projectId)fail('freeze_scope_requires_separate_binding');
    if(!t.context||t.sourceProblems.length||!t.sourcePrivateCaptured||t.sourceEvidence.status!=='verified')fail('freeze_source_incomplete');
    // No Memory-derived material is relabelled into a newly personal row. Pins and
    // extracted external objects need their own atomic custody binding in a later adapter.
    if(t.context.snapshot.facts.some(f=>f.authorship==='accepted-memory-assisted'
      || Object.keys(f.properties).some(k=>/memory|private_content|content_ref/i.test(k)))
      ||t.context.snapshot.pins.length||t.sourceEvidence.referenceCount
      // Global preferences are outside the reader's document-private-body proof.
      // Until their exact original custody is qualified, refuse rather than omit
      // or adopt the ordinary reducer's lossy 120-character summaries.
      ||t.events.some(e=>['PreferenceAuthored','PreferenceRevoked'].includes(e.type)))fail('freeze_source_binding_unqualified');
    // Custody includes inactive facts too: none may outlive an authored deadline.
    // This deadline-only projection does not change the frozen source or its authority.
    const deadlines=outputActiveSourceDeadlineAssertions({...t.context,snapshot:{...t.context.snapshot,
      facts:t.context.snapshot.facts.map(f=>({...f,active:true}))}});
    const guards=[a.guard,outputScopeAuthority(t.scope,'read'),currentHead(t),...t.sourceAssertions,...deadlines];
    if(env.DB!==a.db)fail('freeze_database_changed');
    return {a,t,guards,deadlines};
  }
  const enabled=()=>env.FORMA_GENERATION_SOURCE_FREEZE_ENABLED==='1';
  async function freezeSource(request,target) {
    if(!enabled())return {status:'disabled'};
    const {a,t,guards,deadlines}=await context(request,target),db=a.db;
    // Exactly the established full-document snapshot: no truncation, rewriting,
    // inferred text, selective source removal, or client-supplied snapshot.
    const bytes=sourceBytes(t);
    if(!bytes.isWellFormed()||Buffer.byteLength(bytes)>LIMITS.sourceBytes)fail('freeze_source_too_large');
    const native=await preparePrivateContent(env,a.user.userId,'document-artifact-input',bytes);
    const frozenAt=native.createdAt;
    const expiresAt=new Date(Math.min(Date.parse(native.expiresAt),Date.parse(frozenAt)+LIMITS.retentionDays*86400000,...deadlines.map(d=>d.deadlineMs))).toISOString();
    if(!future(expiresAt))fail('freeze_source_expired');
    const ref=native.contentId,producerEvidenceRef=`${ref}:freeze`;
    const source={ref,version:t.context.documentRevision,producer:FREEZE_PRODUCER,producerEvidenceRef,
      authorityVersion:hash(a.user.authorizationSnapshot),documentId:t.scope.documentId,projectId:t.scope.projectId,
      sourceHead:t.ownerHead,projectHead:t.projectHead,sourceDigest:t.sourceDigest,
      sourceBlockVersions:t.context.sourceBlockVersions,frozenAt,expiresAt,nativeExpiresAt:native.expiresAt,
      complete:true,scope:'personal-administrator',sha256:hash(bytes),byteLength:Buffer.byteLength(bytes)};
    const receipt=canonical(source);
    if(Buffer.byteLength(receipt)>LIMITS.sourceBytes)fail('freeze_receipt_too_large');
    if(env.DB!==db)fail('freeze_database_changed');
    const expiration={sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[expiresAt]};
    const insert=(id,body)=>db.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,'document-artifact-input',?,?,?,NULL)").bind(id,a.user.userId,body,frozenAt,expiresAt);
    // Ignore native prepared statements (including optional cleanup); use only the
    // retention calculation. Raw bytes and producer receipt commit together.
    const result=await checkedBatch(env,[...guards,expiration],[insert(ref,bytes),insert(producerEvidenceRef,receipt)]);
    if(result.some(r=>r.meta?.changes!==1))fail('freeze_custody_unconfirmed');
    // Read actual stored bytes/expiry through the same current-eligibility checks.
    await readPrivateFreeze(request,{...target,ref});
    return {status:'frozen',source};
  }
  /** Trusted server-only read. Never wire this raw result to a public report/API. */
  async function readPrivateFreeze(request,target) {
    if(!enabled())return {status:'disabled'};
    if(!identifier(target?.ref))fail('freeze_reference_required');
    const {a,t,guards}=await context(request,target),db=a.db;
    const scope=privateContentScopeGuard(a.user.userId),memory=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
    if(env.DB!==db)fail('freeze_database_changed');
    const rows=(await checkedBatch(env,guards,[db.prepare(`SELECT content_id,content,created_at,expires_at FROM private_content
      WHERE content_id IN(?,?) AND owner_id=? AND kind='document-artifact-input' AND redacted_at IS NULL
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${scope.sql} AND ${memory.sql}
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`)
      .bind(target.ref,`${target.ref}:freeze`,a.user.userId,...scope.bindings,...memory.bindings)]))[0].results;
    const sourceRow=rows.find(r=>r.content_id===target.ref),receiptRow=rows.find(r=>r.content_id===`${target.ref}:freeze`);
    if(!sourceRow||!receiptRow)fail('freeze_custody_unavailable');
    let source;try{source=JSON.parse(receiptRow.content);}catch{fail('freeze_receipt_invalid');}
    if(source.ref!==target.ref||source.producer!==FREEZE_PRODUCER||source.producerEvidenceRef!==receiptRow.content_id
      ||source.documentId!==target.documentId||source.projectId!==target.projectId||source.sourceHead!==t.ownerHead
      ||source.sourceDigest!==t.sourceDigest||source.version!==t.context.documentRevision
      ||source.authorityVersion!==hash(a.user.authorizationSnapshot)||source.scope!=='personal-administrator'||source.complete!==true
      ||canonical(source.sourceBlockVersions)!==canonical(t.context.sourceBlockVersions)
      ||source.sha256!==hash(sourceRow.content)||source.byteLength!==Buffer.byteLength(sourceRow.content)
      ||sourceRow.content!==sourceBytes(t)||source.expiresAt!==sourceRow.expires_at||source.expiresAt!==receiptRow.expires_at
      ||source.frozenAt!==sourceRow.created_at||source.frozenAt!==receiptRow.created_at||!future(source.expiresAt)
      ||!Number.isFinite(Date.parse(source.frozenAt))||Date.parse(source.frozenAt)>Date.now()
      ||!future(source.nativeExpiresAt)||Date.parse(source.expiresAt)>Date.parse(source.nativeExpiresAt)
      ||Date.parse(source.expiresAt)>Date.parse(source.frozenAt)+LIMITS.retentionDays*86400000)fail('freeze_binding_changed');
    const custody=rows.map(row=>({sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?
      AND kind='document-artifact-input' AND content=? AND created_at=? AND expires_at=? AND redacted_at IS NULL
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${scope.sql} AND ${memory.sql}
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))`,
      bindings:[row.content_id,a.user.userId,row.content,row.created_at,row.expires_at,...scope.bindings,...memory.bindings]}));
    await verifyOutputSourceRead(env,t.scope,t.ownerHead,[...guards,...custody]);
    if(env.DB!==db)fail('freeze_database_changed');
    return {status:'eligible',source:{...source,bytes:sourceRow.content}};
  }
  return Object.freeze({freezeSource,readPrivateFreeze});
}
