import { canonicalJson } from "../src/experiences/compiler.ts";
import { readExperienceOutputLineage } from "./experience-output-originals.ts";
import { outputCommandReceiptAssertion } from "./output-command-core.ts";
import { outputSlotFromRow, OutputConflictError } from "./output-requirements-ledger.ts";
import { captureModel3dReplacementParent, model3dReplacementIndexAssertion } from "./experience-model3d-replacement-proof.ts";
import type { ExperienceOutputBinding } from "./experience-output-binding.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";

const fail = (): never => { throw new OutputConflictError("experience_model3d_replacement_lineage_unavailable", 409); };
/** Select only the child's retained confirmation, never arbitrary latest-plan
 * metadata. Original source/custody resolution remains the caller's job. */
export async function resolveModel3dReplacementSource(input: OutputBridgeTargetInput, root: ExperienceOutputBinding, retentionExpiresAt: string) {
  const lineage = await readExperienceOutputLineage({ env: input.env, scope: input.scope }, root), cycle = lineage.binding.replacementCycle;
  if (!cycle) return null;
  if (lineage.originals.confirm?.receipt.payload.plan_revision_id !== input.confirmedPlan.revisionId
    || canonicalJson(lineage.originals.confirm.receipt.payload.confirmed_plan) !== canonicalJson(input.confirmedPlan)
    || cycle.predecessor.targetId !== input.target.id || cycle.predecessor.targetContractDigest !== input.confirmedPlan.targetContractDigests[input.target.id]
    || cycle.predecessor.sourceDigest !== input.sourceDigest || cycle.predecessor.requirementsDigest !== input.requirementsDigest) return fail();
  const row = await input.env.DB.prepare("SELECT * FROM output_operation_slots WHERE scope_key=? AND slot_id=? AND job_id=? AND grant_id=?")
    .bind(input.scope.key, cycle.predecessor.slotId, cycle.predecessor.jobId, cycle.predecessor.grantId).first<Record<string, unknown>>();
  const job = await input.env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND document_id=?")
    .bind(cycle.predecessor.jobId, input.scope.ownerUserId, input.scope.documentId).first<DocumentJobRow>();
  if (!row || !job) return fail();
  const assertions = [...(input.sourceAssertions ?? []),
    ...lineage.witnesses.map(value => outputCommandReceiptAssertion(input.scope, value.receipt)),
    model3dReplacementIndexAssertion(input.scope, root.draftId, lineage.cycleCommandKeys)];
  const childJobId = typeof lineage.originals.authorize?.receipt.payload.authorized_targets === "object"
    ? (lineage.originals.authorize?.receipt.payload.authorized_targets as Array<{ job_id?: string }>)?.[0]?.job_id : undefined;
  const parent = await captureModel3dReplacementParent(input.env, input.scope, outputSlotFromRow(input.scope.key, row), job, {
    assertions, current: { sourceDigest: input.sourceDigest, requirementsDigest: input.requirementsDigest, retentionExpiresAt }, childJobId,
    childDeadlineMs: Date.parse(input.confirmedPlan.confirmedAt) + 15 * 60_000,
  });
  if (parent.checkpoint.providerRequestId !== cycle.predecessor.providerRequestId) return fail();
  return { cycle, assertions: parent.assertions };
}
