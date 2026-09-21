import { memoryDerivationSourceWindow } from "../model/memory-derivation-policy.ts";
import { MEMORY_DERIVATION_HEALTH, parseMemoryDerivationHealth, type MemoryDerivationHealth } from '../model/memory-derivation-health.ts';
import { MEMORY_EVIDENCE_RESOURCES, type MemoryResourceCitation } from '../model/memory-evidence-resource.ts';
import { DOCUMENT_VIEWS } from '../model/document-view-signals.ts';
import { beginMemoryPrivacyMutation } from './memory-privacy-mutation.ts';
import { createMemoryElapsed } from "../model/memory-lifetime.ts";
/** Explicit consent transport only. No storage, enrollment, processing or retry. */
import { parseMemoryCustody, type MemoryCustody } from "../model/memory-custody.ts";
import { memoryDigest } from "../model/scoped-memory.ts";
import { MEMORY_DERIVATION_CONTROL, MEMORY_DERIVATION_POLICY, MEMORY_DERIVATION_PURPOSES, derivationExact,
  derivationHash, derivationConsentId, derivationId, derivationInteger, derivationTime, derivationCanonical,
  parseMemoryDerivationTerms, type MemoryDerivationTerms, type MemoryDerivationFinanceView, type MemoryDerivationPurpose } from "../model/memory-derivation-policy.ts";
export { MEMORY_DERIVATION_CONTROL, MEMORY_DERIVATION_POLICY } from "../model/memory-derivation-policy.ts";
export type DerivationScope = { projectId: string; documentId: string; custody: MemoryCustody };
export type DerivationScopeRequest = { projectId: string; documentId: string; expectedCustody: MemoryCustody; enrollmentId: string; enrollmentRevision: number };
export type DerivationGrant = { scope: DerivationScope; grantId: string; revision: number; consentId: string; purpose: MemoryDerivationPurpose;
  enrollmentId: string; enrollmentRevision: number; qualificationId: string; termsSha256: string; monthlyCapMicroUsd: number;
  sourceAfterSequence: number; background: boolean; retentionDays: number; consentedAt: string; expiresAt: string; revokedAt: string | null };
export type DerivationOffer = { qualificationId: string; termsSha256: string; expiresAt: string; terms: MemoryDerivationTerms };
export type DerivationSettings = { financial?: MemoryDerivationFinanceView; enabled: boolean; available: boolean; processingImplemented: boolean; grants: readonly DerivationGrant[]; qualifications: readonly DerivationOffer[] };
export type DerivationEnable = { version: typeof MEMORY_DERIVATION_CONTROL; policyVersion: typeof MEMORY_DERIVATION_POLICY;
  purpose: MemoryDerivationPurpose; qualificationId: string; termsSha256: string; projectId: string; documentId: string;
  enrollmentId: string; enrollmentRevision: number; revision: number; expectedConsentId: string | null; expectedCustody: MemoryCustody;
  monthlyCapMicroUsd: number; background: boolean; retentionDays: number; expiresAt: string; sourceWindow: "future-originals" | "future-originals-and-actions" | "future-originals-actions-and-fields";
  chargeMyAiAllowance: true; confirmation: "ENABLE_DERIVED_MEMORY" };
export class MemoryDerivationClientError extends Error {
  constructor(readonly mutationUnknown = false, readonly status: number | null = null) {
    super(mutationUnknown ? "The change is unconfirmed. Reload before trying again." : "Memory purpose controls are unavailable. Reload to check.");
    this.name = "MemoryDerivationClientError";
  }
}
const PATH = "/api/memory/derivation/settings", CAP_SCOPE = "payer-utc-calendar-month-all-memory-purposes";
const GRANT_KEYS = ["scope", "grantId", "revision", "consentId", "purpose", "enrollmentId", "enrollmentRevision", "qualificationId", "termsSha256", "monthlyCapMicroUsd", "sourceAfterSequence", "background", "retentionDays", "consentedAt", "expiresAt", "revokedAt"];
function check(value: unknown): asserts value { if (!value) throw new Error("invalid-memory-derivation-contract"); }
function own(value: unknown, keys: readonly string[]): Record<string, unknown> { check(derivationExact(value, keys)); return value; }
function frozen<T>(value: T): T { if (value && typeof value === "object") { for (const item of Object.values(value)) frozen(item); Object.freeze(value); } return value; }
function sameScope(a: DerivationScope, b: DerivationScope): boolean { return derivationCanonical(a) === derivationCanonical(b); }
function scope(value: unknown): DerivationScope {
  const row = own(value, ["projectId", "documentId", "custody"]), custody = parseMemoryCustody(row.custody);
  check(derivationId(row.projectId) && row.projectId.length <= 120 && derivationId(row.documentId) && row.documentId.length <= 120 && custody);
  return { projectId: row.projectId, documentId: row.documentId, custody };
}
function requestScope(value: unknown): DerivationScopeRequest {
  const row = own(value, ["projectId", "documentId", "expectedCustody", "enrollmentId", "enrollmentRevision"]);
  const result = scope({ projectId: row.projectId, documentId: row.documentId, custody: row.expectedCustody });
  check(derivationId(row.enrollmentId) && derivationInteger(row.enrollmentRevision, 1));
  return frozen({ projectId: result.projectId, documentId: result.documentId, expectedCustody: result.custody, enrollmentId: row.enrollmentId, enrollmentRevision: row.enrollmentRevision });
}
function grant(value: unknown): DerivationGrant {
  const row = own(value, GRANT_KEYS), selected = scope(row.scope);
  check(derivationHash(row.grantId) && derivationConsentId(row.consentId) && derivationInteger(row.revision, 1)
    && MEMORY_DERIVATION_PURPOSES.some(p => p === row.purpose) && derivationId(row.enrollmentId) && derivationInteger(row.enrollmentRevision, 1)
    && derivationId(row.qualificationId) && derivationHash(row.termsSha256) && derivationInteger(row.monthlyCapMicroUsd, 1, 1000000000)
    && derivationInteger(row.sourceAfterSequence) && typeof row.background === "boolean" && derivationInteger(row.retentionDays, 1, 365)
    && derivationTime(row.consentedAt) && derivationTime(row.expiresAt) && row.expiresAt > row.consentedAt
    && (row.revokedAt === null || derivationTime(row.revokedAt) && row.revokedAt >= row.consentedAt));
  return frozen({ ...structuredClone(row), scope: selected } as DerivationGrant);
}
async function settings(raw: unknown, expected: DerivationScopeRequest): Promise<DerivationSettings> {
  if (derivationExact(raw, ["version", "enabled", "available", "reason", "grants", "qualifications"])) {
    check(raw.version === MEMORY_DERIVATION_CONTROL && raw.enabled === false && raw.available === false && raw.reason === "schema-unavailable"
      && Array.isArray(raw.grants) && raw.grants.length === 0 && Array.isArray(raw.qualifications) && raw.qualifications.length === 0);
    return frozen({ enabled: false, available: false, processingImplemented: false, grants: [], qualifications: [] });
  }
  const hasFinancial=!!raw&&typeof raw==='object'&&Object.hasOwn(raw,'financial');
  const row = own(raw, ["version", "enabled", "available", "reason", "policyVersion", "scope", "enrollmentId", "enrollmentRevision", "grants", "qualifications", "capScope", "sourceWindow", "processingImplemented",...(hasFinancial?['financial']:[])]);
  let financial:MemoryDerivationFinanceView|undefined;
  if(hasFinancial){
    const f=own(row.financial,['period','checkedAt','capMicroUsd','usedMicroUsd','reservedMicroUsd','remainingMicroUsd','retention']);
    check(derivationTime(f.checkedAt)&&f.period===f.checkedAt.slice(0,7)&&Date.parse(f.checkedAt)<=Date.now()+5000
      &&Date.now()-Date.parse(f.checkedAt)<60000&&(f.capMicroUsd===null||derivationInteger(f.capMicroUsd,1,1000000000))
      &&derivationInteger(f.usedMicroUsd)&&derivationInteger(f.reservedMicroUsd)&&Number.isSafeInteger(f.usedMicroUsd+f.reservedMicroUsd)
      &&f.remainingMicroUsd===(f.capMicroUsd===null?null:Math.max(0,f.capMicroUsd-f.usedMicroUsd-f.reservedMicroUsd))&&f.retention==='independent-of-memory-erasure');
    financial=structuredClone(f) as MemoryDerivationFinanceView;
  }
  check(row.version === MEMORY_DERIVATION_CONTROL && row.policyVersion === MEMORY_DERIVATION_POLICY && typeof row.enabled === "boolean"
    && typeof row.available === "boolean" && typeof row.processingImplemented === "boolean" && row.capScope === CAP_SCOPE && ["future-originals","qualified-recipe"].includes(String(row.sourceWindow))
    && row.enrollmentId === expected.enrollmentId && row.enrollmentRevision === expected.enrollmentRevision
    && [null, "disabled", "qualification-required"].includes(row.reason as string | null)
    && sameScope(scope(row.scope), { projectId: expected.projectId, documentId: expected.documentId, custody: expected.expectedCustody })
    && Array.isArray(row.grants) && row.grants.length <= 192 && Array.isArray(row.qualifications) && row.qualifications.length <= 16);
  const grants = Array.from(row.grants).map(grant), ids = new Set<string>(), active = new Set<string>();
  for (const item of grants) {
    const key = item.grantId + ":" + item.revision;
    check(!ids.has(key) && sameScope(item.scope, scope(row.scope)) && item.enrollmentId === expected.enrollmentId && item.enrollmentRevision <= expected.enrollmentRevision);
    ids.add(key); if (item.revokedAt === null) { check(!active.has(item.purpose)); active.add(item.purpose); }
  }
  const qualifications: DerivationOffer[] = [], qualifiedIds = new Set<string>();
  for (const value of Array.from(row.qualifications)) {
    const item = own(value, ["qualificationId", "termsSha256", "expiresAt", "terms"]), terms = parseMemoryDerivationTerms(item.terms);
    check(terms && derivationId(item.qualificationId) && !qualifiedIds.has(item.qualificationId) && derivationHash(item.termsSha256)
      && derivationTime(item.expiresAt) && Date.parse(item.expiresAt) > Date.now()
      && await memoryDigest(derivationCanonical(terms)) === item.termsSha256);
    qualifiedIds.add(item.qualificationId); qualifications.push({ qualificationId: item.qualificationId, termsSha256: item.termsSha256, expiresAt: item.expiresAt, terms });
  }
  check(qualifications.every(item => Date.parse(item.expiresAt) > Date.now()));
  check(row.sourceWindow===(qualifications.some(item=>memoryDerivationSourceWindow(item.terms.recipeVersion)!=='future-originals')?'qualified-recipe':'future-originals'));
  check(row.available === (qualifications.length > 0) && (row.enabled || !row.available));
  return frozen({ enabled: row.enabled, available: row.available, processingImplemented: row.processingImplemented, grants, qualifications,...(financial?{financial}:{}) });
}
function enable(value: unknown): DerivationEnable {
  const row = own(value, ["version", "policyVersion", "purpose", "qualificationId", "termsSha256", "projectId", "documentId", "enrollmentId", "enrollmentRevision", "revision", "expectedConsentId", "expectedCustody", "monthlyCapMicroUsd", "background", "retentionDays", "expiresAt", "sourceWindow", "chargeMyAiAllowance", "confirmation"]);
  const selected = requestScope(Object.fromEntries(["projectId", "documentId", "expectedCustody", "enrollmentId", "enrollmentRevision"].map(k => [k, row[k]])));
  check(row.version === MEMORY_DERIVATION_CONTROL && row.policyVersion === MEMORY_DERIVATION_POLICY && MEMORY_DERIVATION_PURPOSES.some(p => p === row.purpose)
    && derivationId(row.qualificationId) && derivationHash(row.termsSha256) && derivationInteger(row.revision, 0, Number.MAX_SAFE_INTEGER - 1)
    && (row.revision === 0 ? row.expectedConsentId === null : derivationConsentId(row.expectedConsentId))
    && derivationInteger(row.monthlyCapMicroUsd, 1, 1000000000) && typeof row.background === "boolean" && derivationInteger(row.retentionDays, 1, 365)
    && derivationTime(row.expiresAt) && Date.parse(row.expiresAt) > Date.now() && Date.parse(row.expiresAt) <= Date.now() + 365 * 86400000
    && ["future-originals","future-originals-and-actions","future-originals-actions-and-fields"].includes(String(row.sourceWindow)) && row.chargeMyAiAllowance === true && row.confirmation === "ENABLE_DERIVED_MEMORY");
  const result = frozen({ ...structuredClone(row), ...selected } as DerivationEnable);
  check(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 4096); return result;
}
function cancel(body: Pick<ReadableStream<Uint8Array>, "cancel"> | null) { try { void body?.cancel().catch(() => undefined); } catch { /* best effort */ } }
async function read(response: Response, signal?: AbortSignal): Promise<unknown> {
  check(/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "") && response.body);
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
  let reject: (reason: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, no) => { reject = no; }); void interrupted.catch(() => undefined);
  const abort = () => { cancel(reader); reject(new Error("cancelled")); };
  signal?.addEventListener("abort", abort, { once: true });
  try { check(!signal?.aborted); for (;;) { const value = await Promise.race([reader.read(), interrupted]); check(!signal?.aborted);
      if (value.done) break; bytes += value.value.byteLength; check(bytes <= 524288); text += decoder.decode(value.value, { stream: true }); }
    return JSON.parse(text + decoder.decode());
  } catch (error) { cancel(reader); throw error; }
  finally { signal?.removeEventListener("abort", abort); try { reader.releaseLock(); } catch { /* cancelled read may settle */ } }
}
export type DerivationProgress = {health?:MemoryDerivationHealth;purpose:MemoryDerivationPurpose;pending:number;completed:number;retained:number;uncertain:number;registeredThrough:number|null;completedThrough:number|null;producers?:ReadonlyArray<{producer:"creator"|"chat-studio";registeredThrough:number;completedThrough:number}>};
export type DerivationResultEntry = {jobId:string;purpose:MemoryDerivationPurpose;scopeKey:string;expiresAt:string};
export type DerivationCitation = {sourceIndex:number;start:number;end:number;text:string};
export const DERIVATION_OBSERVED_ACTIONS=['encounter','inspect','compare','edit','commit','reuse','remove','restore','critique','request','accept','reject','defer'] as const;
export type DerivationObservedCitation={observationIndex:number;action:typeof DERIVATION_OBSERVED_ACTIONS[number];recordedAt:string;role:'support'|'counterevidence'};
export type DerivationProfileRelation={relationship:'revises'|'contradicts';claimKey:string;category:'preference-hypothesis'|'workflow-hypothesis';supports:readonly DerivationCitation[]};
export type DerivationResultItem = {claimKey:string;category:string;text:string;lineageIds:readonly string[];
  citationStatus:'support-cited'|'conflicting-citations';supports:readonly DerivationCitation[];counterevidence:readonly DerivationCitation[];observationCitations?:readonly DerivationObservedCitation[];reconciles?:readonly DerivationProfileRelation[];resourceCitations?:readonly MemoryResourceCitation[];fieldTarget?:{blockId:string;field:'text';revision:number;sequence:number;textHash:string};replacement?:string;locale?:string};
export type DerivationHistory = {windowCount:number;originalPairs:number;boundary:'consent'|'bounded'|'capacity';afterSequence:number;throughSequence:number};
export type DerivationResultView = DerivationResultEntry & {validUntil:string;items:readonly DerivationResultItem[];history?:DerivationHistory;controlRevisions:Readonly<Record<string,number>>};
export type DerivationControl = {controlId:string;claimKey:string;lineageId:string;revision:number;action:'corrected'|'suppressed'|'released';correctionText:string|null;expiresAt:string;purpose:MemoryDerivationPurpose;textAvailable:boolean};
const reviewText=(value:unknown,max=16384):value is string=>typeof value==='string'&&value.isWellFormed()&&value.length>0&&value.length<=max;
function resultEntry(value:unknown):DerivationResultEntry{
  const row=own(value,['jobId','purpose','scopeKey','expiresAt']);
  check(derivationHash(row.jobId)&&MEMORY_DERIVATION_PURPOSES.includes(row.purpose as MemoryDerivationPurpose)&&reviewText(row.scopeKey,8192)&&derivationTime(row.expiresAt)&&Date.parse(row.expiresAt)>Date.now());
  return frozen({...row} as DerivationResultEntry);
}
function resultView(value:unknown,expected:DerivationResultEntry,withControls=true,withResources=false):DerivationResultView{
  const hasHistory=!!value&&typeof value==='object'&&Object.hasOwn(value,'history');
  const row=own(value,['version','jobId','expiresAt','candidate',...(withControls?['controlRevisions']:[]),...(hasHistory?['history']:[]),...(withResources?['resourceEvidence']:[])]),candidate=own(row.candidate,['version','purpose','scopeKey','manifestId','manifestRevision','validUntil','semanticAuthority','semanticCompleteness','independentEvidence','items']);
  check(row.version===MEMORY_DERIVATION_CONTROL&&row.jobId===expected.jobId&&row.expiresAt===expected.expiresAt&&['memory-derivation-candidates-v1','memory-derivation-candidates-v2','memory-profile-consolidation-v1','memory-field-suggestions-v1'].includes(String(candidate.version))
    &&candidate.purpose===expected.purpose&&candidate.scopeKey===expected.scopeKey&&candidate.semanticAuthority==='model-derived-unverified'
    &&candidate.manifestId===expected.jobId&&candidate.manifestRevision===1
    &&candidate.semanticCompleteness===false&&candidate.independentEvidence===false&&derivationTime(candidate.validUntil)&&Date.parse(candidate.validUntil)>Date.now()
    &&Date.parse(candidate.validUntil)<=Date.now()+60000&&candidate.validUntil<=row.expiresAt
    &&Date.parse(row.expiresAt as string)>Date.now()&&Array.isArray(candidate.items)&&candidate.items.length<=16);
  const field=candidate.version==='memory-field-suggestions-v1';
  check(!field||expected.purpose==='suggestion'&&candidate.items.length<=8);
  const behavioral=candidate.version==='memory-derivation-candidates-v2',profile=candidate.version==='memory-profile-consolidation-v1';
  check(!profile||expected.purpose==='profile');let relationCount=0;
  const items:DerivationResultItem[]=candidate.items.map(raw=>{
    const item=own(raw,['operation','target','category','text','supports','counterevidence','claimKey','lineageIds','sourceBindings','validUntil','citationStatus',...(profile?['reconciles']:[]),...(field?['fieldTarget','replacement','locale']:[]),...(behavioral?['observationSupports','observationCounterevidence','observationCitations']:[])]);
    check(item.operation==='assert'&&item.target===null&&reviewText(item.claimKey,240)&&reviewText(item.category,120)&&reviewText(item.text)
      &&Array.isArray(item.lineageIds)&&item.lineageIds.length>0&&item.lineageIds.length<=128&&item.lineageIds.every(derivationHash)
      &&item.validUntil===candidate.validUntil&&['support-cited','conflicting-citations'].includes(String(item.citationStatus)));
    let fieldTarget:DerivationResultItem['fieldTarget'];
    if(field){const target=own(item.fieldTarget,['blockId','field','revision','sequence','textHash']);
      check(item.category==='proposal'&&derivationId(target.blockId)&&target.field==='text'&&derivationInteger(target.revision,1)&&derivationInteger(target.sequence,1)&&derivationHash(target.textHash)
        &&typeof item.replacement==='string'&&item.replacement.isWellFormed()&&item.replacement.trim().length>0&&Array.from(item.replacement).length<=600&&['en','fr','ar','ja'].includes(String(item.locale)));
      fieldTarget={...target} as DerivationResultItem['fieldTarget'];
    }
    const seen=new Set<string>();
    const citations=(value:unknown,minimum:number,unique=seen)=>{
      check(Array.isArray(value)&&value.length>=minimum&&value.length<=16);
      return value.map(raw=>{const q=own(raw,['sourceIndex','start','end','text']);
        check(derivationInteger(q.sourceIndex,0,127)&&derivationInteger(q.start)&&derivationInteger(q.end,Number(q.start)+1)
          &&reviewText(q.text,2048)&&q.text.trim().length>0&&Number(q.end)-Number(q.start)<=512
          &&Array.from(q.text).length===Number(q.end)-Number(q.start));
        const key=JSON.stringify([q.sourceIndex,q.start,q.end]);check(!unique.has(key));unique.add(key);return {...q} as DerivationCitation;});
    };
    const supports=citations(item.supports,behavioral?0:1),counterevidence=citations(item.counterevidence,0);
    let reconciles:DerivationProfileRelation[]|undefined;
    if(profile){
      check(['preference-hypothesis','workflow-hypothesis'].includes(String(item.category))&&Array.isArray(item.reconciles)&&item.reconciles.length<=4&&(relationCount+=item.reconciles.length)<=16);
      const linked=new Set<string>();reconciles=item.reconciles.map(raw=>{
        const link=own(raw,['relationship','claimKey','category','supports']);
        check(['revises','contradicts'].includes(String(link.relationship))&&typeof link.claimKey==='string'&&/^derived:[a-f0-9]{64}$/u.test(link.claimKey)
          &&link.claimKey!==item.claimKey&&!linked.has(link.claimKey)&&['preference-hypothesis','workflow-hypothesis'].includes(String(link.category)));linked.add(link.claimKey);
        return{relationship:link.relationship as DerivationProfileRelation['relationship'],claimKey:link.claimKey,category:link.category as DerivationProfileRelation['category'],supports:citations(link.supports,1,new Set())};
      });
    }
    let observationCitations:DerivationObservedCitation[]|undefined;
    if(behavioral){
      check(Array.isArray(item.observationSupports)&&item.observationSupports.length<=8&&Array.isArray(item.observationCounterevidence)&&item.observationCounterevidence.length<=8);
      const supportsObserved=item.observationSupports,countersObserved=item.observationCounterevidence,indexes=[...supportsObserved,...countersObserved];
      check(indexes.every(index=>derivationInteger(index,0,127))&&new Set(indexes).size===indexes.length&&supports.length+supportsObserved.length>0
        &&Array.isArray(item.observationCitations)&&item.observationCitations.length===indexes.length);
      const categories=expected.purpose==='profile'?['preference-hypothesis','workflow-hypothesis']:expected.purpose==='suggestion'?['proposal','next-step']:['goal','decision','proposal','rejected-alternative','question','blocker','next-step'];
      check(categories.includes(String(item.category))&&(supports.length>0||['workflow-hypothesis','proposal','next-step'].includes(String(item.category))&&!counterevidence.length));
      observationCitations=item.observationCitations.map((raw,index)=>{const cited=own(raw,['observationIndex','action','recordedAt','role']);
        check(cited.observationIndex===indexes[index]&&DERIVATION_OBSERVED_ACTIONS.includes(cited.action as DerivationObservedCitation['action'])
          &&cited.role===(index<supportsObserved.length?'support':'counterevidence')&&derivationTime(cited.recordedAt)&&Date.parse(cited.recordedAt)<=Date.now());
        return {...cited} as DerivationObservedCitation;});
    }
    check(item.citationStatus===(counterevidence.length||observationCitations?.some(row=>row.role==='counterevidence')?'conflicting-citations':'support-cited')
      &&new Set(item.lineageIds).size===item.lineageIds.length&&Array.isArray(item.sourceBindings)&&item.sourceBindings.length>0&&item.sourceBindings.length<=128);
    const sourceIds=new Set<string>();for(const raw of item.sourceBindings){const binding=own(raw,['sourceId','revision','contentHash']);
      check(derivationId(binding.sourceId)&&!sourceIds.has(binding.sourceId)&&derivationInteger(binding.revision,1)&&derivationHash(binding.contentHash));sourceIds.add(binding.sourceId);}
    return {claimKey:item.claimKey,category:item.category,text:item.text,lineageIds:[...item.lineageIds] as string[],
      citationStatus:item.citationStatus as DerivationResultItem['citationStatus'],supports,counterevidence,...(fieldTarget?{fieldTarget,replacement:item.replacement as string,locale:item.locale as string}:{}),...(reconciles?{reconciles}:{}),...(observationCitations?{observationCitations}:{})};
  });
  check(!field||new Set(items.map(item=>item.fieldTarget!.blockId)).size===items.length);
  check(new Set(items.map(item=>item.claimKey)).size===items.length&&!items.some(item=>item.reconciles?.some(link=>items.some(peer=>peer.claimKey===link.claimKey))));
  if(withResources){
    const evidence=own(row.resourceEvidence,['version','complete','claims']);
    check(evidence.version===MEMORY_EVIDENCE_RESOURCES&&evidence.complete===false&&Array.isArray(evidence.claims)&&evidence.claims.length===items.length);
    for(const [index,item] of items.entries()){
      const claim=own(evidence.claims[index],['claimKey','citations']);
      const expectedCitations=[...[...new Set([...item.supports,...item.counterevidence].map(row=>row.sourceIndex))].map(index=>({source:'original',index})),
        ...(item.observationCitations??[]).map(row=>({source:'observation',index:row.observationIndex}))];
      check(claim.claimKey===item.claimKey&&Array.isArray(claim.citations)&&claim.citations.length===expectedCitations.length);
      item.resourceCitations=claim.citations.map((raw,offset)=>{
        const citation=own(raw,['source','index','resource']),expectedCitation=expectedCitations[offset]!;
        check(citation.source===expectedCitation.source&&citation.index===expectedCitation.index);
        const r=citation.resource as Record<string,unknown>,zoom=r&&Object.getOwnPropertyDescriptor(r,'zoom')?.value;
        check(zoom==='document'||zoom==='page'||zoom==='block');
        const resource=own(r,['zoom','scopeKey',...(zoom==='page'?['view']:zoom==='block'?['blockId','revision']:[])]);
        check(reviewText(resource.scopeKey,8192)&&(zoom==='document'?resource.scopeKey===expected.scopeKey:resource.scopeKey!==expected.scopeKey)
          &&(citation.source==='observation'||zoom==='document'));
        if(zoom==='page')check(DOCUMENT_VIEWS.includes(resource.view as typeof DOCUMENT_VIEWS[number]));
        if(zoom==='block')check(derivationId(resource.blockId)&&derivationInteger(resource.revision,1));
        return {source:citation.source,index:citation.index,resource:{...resource}} as MemoryResourceCitation;
      });
    }
  }
  const ids=[...new Set(items.flatMap(item=>item.lineageIds))],revisions=withControls?own(row.controlRevisions,ids):{};check(Object.values(revisions).every(value=>derivationInteger(value)));
  let history:DerivationHistory|undefined;
  if(hasHistory){const h=own(row.history,['windowCount','originalPairs','boundary','afterSequence','throughSequence']);
    check(derivationInteger(h.windowCount,1,3)&&derivationInteger(h.originalPairs,0,64)&&['consent','bounded','capacity'].includes(String(h.boundary))
      &&derivationInteger(h.afterSequence)&&derivationInteger(h.throughSequence,Number(h.afterSequence)+1));history={...h} as DerivationHistory;}
  return frozen({...expected,validUntil:candidate.validUntil,items,...(history?{history}:{}),controlRevisions:{...revisions} as Record<string,number>});
}
/** Read-only parser deliberately omits mutation/control revision authority. */
export function parseMemoryDerivationPresentation(value:unknown,expected:DerivationResultEntry){
  const {controlRevisions:_controls,...presentation}=resultView(value,expected,false);
  return presentation;
}
function controlPage(raw:unknown,expected:DerivationScopeRequest){
  const row=own(raw,['version','available','controls','next','scope','enrollmentId','enrollmentRevision','validUntil']);
  check(sameScope(scope(row.scope),{projectId:expected.projectId,documentId:expected.documentId,custody:expected.expectedCustody})&&row.enrollmentId===expected.enrollmentId&&row.enrollmentRevision===expected.enrollmentRevision&&derivationTime(row.validUntil)&&Date.parse(row.validUntil)>Date.now()&&Date.parse(row.validUntil)<=Date.now()+60000);check(row.version===MEMORY_DERIVATION_CONTROL&&typeof row.available==='boolean'&&Array.isArray(row.controls)&&row.controls.length<=128&&(row.next===null||derivationHash(row.next)));
  const controls=row.controls.map(raw=>{const item=own(raw,['controlId','claimKey','lineageId','revision','action','correctionText','expiresAt','purpose','textAvailable']);
    check(derivationHash(item.controlId)&&derivationHash(item.lineageId)&&reviewText(item.claimKey,240)&&derivationInteger(item.revision,1)
      &&['corrected','suppressed','released'].includes(String(item.action))&&derivationTime(item.expiresAt)&&Date.parse(item.expiresAt)>Date.now()
      &&MEMORY_DERIVATION_PURPOSES.includes(item.purpose as MemoryDerivationPurpose)&&typeof item.textAvailable==='boolean'
      &&(item.textAvailable&&item.action==='corrected'?reviewText(item.correctionText,2000):item.correctionText===null));return {...item} as DerivationControl;});
  check(new Set(controls.map(item=>item.controlId)).size===controls.length&&(row.available||!controls.length));
  return frozen({controls,next:row.next as string|null,validUntil:row.validUntil});
}
export function createMemoryDerivationClient(transport: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch) {
  let epoch = 0;
  async function request<T>(method: "GET" | "PUT" | "DELETE" | "POST", query: string, body: unknown, parse: (raw: unknown) => T | Promise<T>, signal?: AbortSignal, path = PATH): Promise<T> {
    if (signal?.aborted) throw new MemoryDerivationClientError();
    const revision = ++epoch, mutation = method !== "GET"; let dispatched = false, response: Response | undefined;
    let reject: (error: Error) => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, no) => { reject = no; }); void interrupted.catch(() => undefined);
    const abort = () => reject(new Error("cancelled")); signal?.addEventListener("abort", abort, { once: true });
    const finishMutation = mutation ? beginMemoryPrivacyMutation() : undefined;
    try {
      dispatched = true;
      const pending = transport(path + query, { method, signal, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
        headers: { accept: "application/json", ...(mutation ? { "content-type": "application/json" } : {}) }, ...(mutation ? { body: JSON.stringify(body) } : {}) });
      response = await Promise.race([pending.then(value => { if (signal?.aborted) cancel(value.body); return value; }), interrupted]);
      if (response.status !== 200) { cancel(response.body); throw new MemoryDerivationClientError(mutation && (response.status < 400 || response.status >= 500), response.status); }
      const raw = await read(response, signal), value = await Promise.race([Promise.resolve(parse(raw)), interrupted]); check(revision === epoch && !signal?.aborted); return value;
    } catch (error) { if (error instanceof MemoryDerivationClientError) throw error; cancel(response?.body ?? null); throw new MemoryDerivationClientError(mutation && dispatched, response?.status ?? null); }
    finally { signal?.removeEventListener("abort", abort); finishMutation?.(); }
  }
  return {
    async results(value:DerivationScopeRequest,after:string|null=null,signal?:AbortSignal,purpose:MemoryDerivationPurpose|null=null,latest=false,diagnostics=false){
      const expected=requestScope(value);check(typeof latest==='boolean'&&typeof diagnostics==='boolean'&&(!latest||purpose!==null&&after===null));check((after===null||derivationHash(after))&&(purpose===null||MEMORY_DERIVATION_PURPOSES.includes(purpose)));
      return request('GET','?projectId='+encodeURIComponent(expected.projectId)+'&documentId='+encodeURIComponent(expected.documentId)+(after?'&after='+after:'')+(purpose?'&purpose='+encodeURIComponent(purpose):'')+(latest?'&latest=1':'')+(diagnostics?'&diagnostics=1':''),undefined,raw=>{
        const row=own(raw,['version','scope','enrollmentId','enrollmentRevision','results','next','checkedAt','progress',...(purpose?['purpose']:[]),...(latest?['latest']:[]),...(diagnostics?['diagnostics']:[])]);
        check(!diagnostics||row.diagnostics===MEMORY_DERIVATION_HEALTH);
        check(purpose===null||row.purpose===purpose);check(!latest||row.latest===true&&Array.isArray(row.results)&&row.results.length<=1&&row.next===null);
        check(derivationTime(row.checkedAt)&&Date.parse(row.checkedAt)<=Date.now()+5000&&Date.now()-Date.parse(row.checkedAt)<60000&&Array.isArray(row.progress)&&row.progress.length<=3);
        const progress=row.progress.map(value=>{const hasProducers=!!value&&typeof value==='object'&&Object.hasOwn(value,'producers');
          const p=own(value,['purpose','pending','completed','retained','uncertain','registeredThrough','completedThrough',...(hasProducers?['producers']:[]),...(diagnostics?['health']:[])]);
          if(hasProducers){check(Array.isArray(p.producers)&&p.producers.length===2);
            const producers=p.producers.map((entry,index)=>{const row=own(entry,['producer','registeredThrough','completedThrough']);
              check(row.producer===(index===0?'creator':'chat-studio')&&derivationInteger(row.registeredThrough)&&derivationInteger(row.completedThrough,0,Number(row.registeredThrough)));return row;});
            check(p.registeredThrough===Math.min(...producers.map(row=>Number(row.registeredThrough)))&&p.completedThrough===Math.min(...producers.map(row=>Number(row.completedThrough))));
          }
          check(MEMORY_DERIVATION_PURPOSES.includes(p.purpose as MemoryDerivationPurpose)&&['pending','completed','retained','uncertain'].every(key=>derivationInteger(p[key]))
            &&['registeredThrough','completedThrough'].every(key=>p[key]===null||derivationInteger(p[key]))&&(p.completedThrough===null||p.registeredThrough!==null&&Number(p.completedThrough)<=Number(p.registeredThrough)));return {...p,...(diagnostics?{health:parseMemoryDerivationHealth(p.health,{pending:Number(p.pending),completed:Number(p.completed),retained:Number(p.retained)},String(row.checkedAt))}:{})} as DerivationProgress;});
        check(new Set(progress.map(p=>p.purpose)).size===progress.length&&progress.every(p=>purpose===null||p.purpose===purpose));
        check(row.version===MEMORY_DERIVATION_CONTROL&&sameScope(scope(row.scope),{projectId:expected.projectId,documentId:expected.documentId,custody:expected.expectedCustody})
          &&row.enrollmentId===expected.enrollmentId&&row.enrollmentRevision===expected.enrollmentRevision&&Array.isArray(row.results)&&row.results.length<=8&&(row.next===null||derivationHash(row.next)));
        const results=row.results.map(resultEntry);check(new Set(results.map(item=>item.jobId)).size===results.length&&results.every(item=>item.jobId!==after&&(purpose===null||item.purpose===purpose))&&(!row.next||row.next===results.at(-1)?.jobId));
        return frozen({results,next:row.next as string|null,progress,checkedAt:row.checkedAt});
      },signal,'/api/memory/derivation/results');
    },
    async inspectResultResources(value:DerivationResultEntry,signal?:AbortSignal){
      const expected=resultEntry(value);return request('GET','?jobId='+expected.jobId+'&resources=1',undefined,raw=>resultView(raw,expected,true,true),signal,'/api/memory/derivation/result');
    },
    async inspectResult(value:DerivationResultEntry,signal?:AbortSignal){
      const expected=resultEntry(value);return request('GET','?jobId='+expected.jobId,undefined,raw=>resultView(raw,expected),signal,'/api/memory/derivation/result');
    },
    async exportResult(value:DerivationResultEntry,signal?:AbortSignal){
      // Always recertify through the native read. Never serialize a cached display
      // lease, native source bindings, or an arbitrary caller-supplied view.
      const expected=resultEntry(value),elapsed=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});
      const view=await request('GET','?jobId='+expected.jobId,undefined,raw=>resultView(raw,expected),signal,'/api/memory/derivation/result');
      check(!signal?.aborted&&elapsed.elapsed({wall:Date.now(),monotonic:performance.now()})<60000&&Date.parse(view.validUntil)>Date.now());
      const json=JSON.stringify({format:'forma-memory-result-export-v1',capturedAt:new Date().toISOString(),
        treatment:'model-derived-unverified',completeHistory:false,independentEvidence:false,
        snapshotOnly:true,accessAuthority:false,downloadedCopyRevocable:false,
        includes:{selectedResult:true,allMemory:false,vectors:false,fullSourceBodies:false,originalQuotes:true,observedActions:true,controlHistory:false},
        result:{purpose:view.purpose,retentionUpperBound:view.expiresAt,
          ...(view.history?{history:{windowCount:view.history.windowCount,originalPairs:view.history.originalPairs,boundary:view.history.boundary}}:{}),
          items:view.items.map(item=>({category:item.category,text:item.text,citationStatus:item.citationStatus,
            originalQuotes:{supports:item.supports,counterevidence:item.counterevidence},
            observedActions:item.observationCitations??[],...(item.fieldTarget?{fieldProposal:{target:item.fieldTarget,replacement:item.replacement,locale:item.locale,applied:false}}:{}),...(item.reconciles?{proposedRelationships:item.reconciles.map(link=>({relationship:link.relationship,category:link.category,originalQuotes:link.supports,establishedFact:false}))}:{})}))}},null,2);
      check(new TextEncoder().encode(json).byteLength<=524288);
      return frozen({json,validUntil:view.validUntil});
    },
    async changeResult(view:DerivationResultView,item:DerivationResultItem,action:'suppressed'|'corrected',correctionText:string|null,signal?:AbortSignal){
      check(view.items.includes(item)&&Date.parse(view.validUntil)>Date.now()&&['suppressed','corrected'].includes(action)
        &&(action==='corrected'?reviewText(correctionText,2000)&&Array.from(correctionText).length<=1000:correctionText===null));
      return request('POST','?jobId='+view.jobId,{version:MEMORY_DERIVATION_CONTROL,claimKey:item.claimKey,action,correctionText,
        expectedRevisions:Object.fromEntries(item.lineageIds.map(id=>[id,view.controlRevisions[id]])),confirmation:'CHANGE_DERIVED_MEMORY'},raw=>{
        const row=own(raw,['version','jobId','state','controls']);check(row.version===MEMORY_DERIVATION_CONTROL&&row.jobId===view.jobId&&row.state==='withdrawn'&&Array.isArray(row.controls)&&row.controls.length===item.lineageIds.length);
        const seen=new Set<string>();
        for(const value of row.controls){const c=own(value,['controlId','claimKey','lineageId','revision','action','correctionText','expiresAt','semanticAuthority']);
          check(derivationHash(c.controlId)&&!seen.has(String(c.lineageId))&&item.lineageIds.includes(String(c.lineageId))&&c.claimKey===item.claimKey&&c.revision===view.controlRevisions[String(c.lineageId)]!+1&&c.action===action&&c.correctionText===correctionText&&c.semanticAuthority==='explicit-user-control');seen.add(String(c.lineageId));}
      },signal,'/api/memory/derivation/result');
    },
    async withdrawResult(value:DerivationResultEntry,signal?:AbortSignal){
      const entry=resultEntry(value);return request('DELETE','?jobId='+entry.jobId,{version:MEMORY_DERIVATION_CONTROL,confirmation:'WITHDRAW_DERIVED_RESULT'},raw=>{
        const row=own(raw,['version','jobId','state']);check(row.version===MEMORY_DERIVATION_CONTROL&&row.jobId===entry.jobId&&row.state==='withdrawn');
      },signal,'/api/memory/derivation/result');
    },
    async controls(value:DerivationScopeRequest,after:string|null=null,signal?:AbortSignal){
      const expected=requestScope(value);check(after===null||derivationHash(after));
      return request('GET','?projectId='+encodeURIComponent(expected.projectId)+'&documentId='+encodeURIComponent(expected.documentId)+(after?'&after='+after:''),undefined,raw=>controlPage(raw,expected),signal,'/api/memory/derivation/controls');
    },
    async releaseControl(value:DerivationControl,signal?:AbortSignal){
      check(derivationHash(value.controlId)&&derivationInteger(value.revision,1)&&Date.parse(value.expiresAt)>Date.now());
      return request('PUT','',{version:MEMORY_DERIVATION_CONTROL,controlId:value.controlId,revision:value.revision,action:'released',correctionText:null,confirmation:'CHANGE_DERIVED_MEMORY'},raw=>{
        const row=own(raw,['version','control']),c=own(row.control,['controlId','revision','action','expiresAt']);
        check(row.version===MEMORY_DERIVATION_CONTROL&&c.controlId===value.controlId&&c.revision===value.revision+1&&c.action==='released'&&c.expiresAt===value.expiresAt);
      },signal,'/api/memory/derivation/controls');
    },
    async settings(value: DerivationScopeRequest, signal?: AbortSignal) {
      let expected: DerivationScopeRequest; try { expected = requestScope(value); } catch { throw new MemoryDerivationClientError(); }
      return request("GET", "?projectId=" + encodeURIComponent(expected.projectId) + "&documentId=" + encodeURIComponent(expected.documentId), undefined, raw => settings(raw, expected), signal);
    },
    async enable(value: DerivationEnable, signal?: AbortSignal): Promise<DerivationGrant> {
      let expected: DerivationEnable; try { expected = enable(value); } catch { throw new MemoryDerivationClientError(); }
      return request("PUT", "", expected, raw => {
        const row = own(raw, ["version", "grant", "capScope", "processingImplemented"]), result = grant(row.grant);
        check(row.version === MEMORY_DERIVATION_CONTROL && row.capScope === CAP_SCOPE && typeof row.processingImplemented === "boolean"
          && result.revision === expected.revision + 1 && result.consentId !== expected.expectedConsentId && result.revokedAt === null
          && result.enrollmentId === expected.enrollmentId && result.enrollmentRevision === expected.enrollmentRevision
          && result.purpose === expected.purpose && result.qualificationId === expected.qualificationId && result.termsSha256 === expected.termsSha256
          && result.monthlyCapMicroUsd === expected.monthlyCapMicroUsd && result.background === expected.background && result.retentionDays === expected.retentionDays
          && result.expiresAt === expected.expiresAt && Date.parse(result.expiresAt) > Date.now()
          && sameScope(result.scope, { projectId: expected.projectId, documentId: expected.documentId, custody: expected.expectedCustody })); return result;
      }, signal);
    },
    async revoke(value: DerivationGrant, signal?: AbortSignal): Promise<void> {
      let expected: DerivationGrant; try { expected = grant(value); } catch { throw new MemoryDerivationClientError(); }
      return request("DELETE", "?grantId=" + encodeURIComponent(expected.grantId), { version: MEMORY_DERIVATION_CONTROL, revision: expected.revision, consentId: expected.consentId, confirmation: "REVOKE_DERIVED_MEMORY" }, raw => {
        const row = own(raw, ["version", "revoked", "grantId", "revision", "consentId", "reEnrollmentRequired"]);
        check(row.version === MEMORY_DERIVATION_CONTROL && row.revoked === true && row.grantId === expected.grantId && row.revision === expected.revision && row.consentId === expected.consentId && row.reEnrollmentRequired === true);
      }, signal);
    },
  };
}
