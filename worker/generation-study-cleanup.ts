import type {StudyApprovalEnv,StudyApprovalProposal} from './authoring-study-types.ts';
import {studyPrivateGuard,studySchemaGuard,studyFail,studyDate} from './authoring-study-proof.ts';
import type {PilotUser} from './pilot-policy.ts';
import type {StudySqlGuard} from './authoring-study-types.ts';
// @ts-expect-error Existing authenticated recovery and atomic assertions.
import {authenticateStudy,checkedBatch} from '../evals/generation-reliability/native-host/authority.mjs';

/** Expired proposal custody, including an abandoned preview with no purchase.
 * Does not delete immutable evidence references, decisions, charges or holds.
 * Object/per-operation cleanup remains the existing one-attempt P2 operation. */
export async function cleanupStudyProposal(request:Request,env:StudyApprovalEnv,p:StudyApprovalProposal){
 const a=await authenticateStudy(request,env,{recovery:true,supplied:true}) as {user:PilotUser;guard:StudySqlGuard};
 const expiry=p.plan.packet.input.expiresAt;
 if(a.user.userId!==p.ownerId||!studyDate(expiry)||Date.now()<Date.parse(expiry))studyFail('cleanup_not_due');
 const schema=await studySchemaGuard(env),scope=await studyPrivateGuard(env,p.ownerId);
 const b=p.plan.candidate.suppliedInputs;
 const statements=[env.DB.prepare(`DELETE FROM private_content WHERE owner_id=? AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${scope.sql} AND (
  (kind='authoring-study-preview' AND json_valid(content) AND json_extract(content,'$.proposalId')=? AND json_extract(content,'$.ownerId')=?)
  OR (kind='study-financial-evidence' AND content_id IN(SELECT content_ref FROM authoring_study_evidence WHERE proposal_id=? AND owner_id=?))
  OR (kind='supplied-study-source' AND content_id=?) OR (kind='agent-authored-study-direction' AND content_id=?))`).bind(p.ownerId,...scope.bindings,p.proposalId,p.ownerId,p.proposalId,p.ownerId,b.sourceRef,b.directionRef)];
 const results=await checkedBatch(env,[a.guard,schema],statements);
 return {action:'expired_proposal_copies_deleted',deleted:results[0]?.meta?.changes??null,accountingPreserved:true,newPurchases:0};
}
