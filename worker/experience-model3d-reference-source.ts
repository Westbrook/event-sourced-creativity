import { canonicalJson } from "../src/experiences/compiler.ts";
import { readModel3dReferencePlan, type Model3dReferencePlan } from "../src/experiences/model3d-reference-plan.ts";
import type { Model3dReferenceIntent } from "../src/experiences/model3d-reference.ts";
import type { ExperiencePlan } from "../src/experiences/intake.ts";
import { inspectModel3dReferenceCustody } from "./model3d-reference-custody.ts";
import { continueOutputTrustedContext } from "./output-trusted-context.ts";
import { projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { outputActiveSourceDeadlineAssertions } from "./output-disclosure-proof.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

function fail(code: string, status = 409): never { throw Object.assign(new Error(code), { code, status }); }
type PreparedSource = Readonly<{ reference: Model3dReferencePlan; head: number; guard: BudgetReservationGuard }>;

/** New request-owned read; previous inspection responses are never accepted here. */
export async function prepareExperienceModel3dReference(request: Request, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, selection: Model3dReferenceIntent): Promise<PreparedSource> {
  // Reuse the actual captured principal in a server continuation. A queue-owned
  // request has no HTTP authentication headers; do not synthesize those headers.
  const trusted = await continueOutputTrustedContext(request, env, selection.sourceDocumentId, "read", auth);
  if (trusted instanceof Response) fail("model3d_reference_source_unavailable", trusted.status);
  const inspection = await inspectModel3dReferenceCustody(trusted, auth, selection);
  const block = trusted.projection.libraryBlocks.find(candidate => candidate.id === selection.sourceBlockId);
  const reference = readModel3dReferencePlan({ version: 1, selection, sourceDigest: inspection.sourceDigest,
    properties: block?.properties }, selection);
  if (!reference || !trusted.context) fail("model3d_reference_copy_unavailable");
  const assertions = [projectIntakeAuthority(env, auth, { projectId: selection.sourceProjectId, documentId: selection.sourceDocumentId }),
    ...trusted.sourceAssertions, ...outputActiveSourceDeadlineAssertions(trusted.context)];
  const guard = { sql: assertions.map(item => `(${item.sql})`).join(" AND "), bindings: assertions.flatMap(item => [...item.bindings ?? []]) };
  request.signal.throwIfAborted();
  return Object.freeze({ reference, head: trusted.ownerHead, guard });
}

/** The existing append is fenced at the captured owner head and exact private/authority proofs.
 * These internal options do not originate in JSON; other intakes keep their existing behavior. */
export function model3dReferenceCommitGuard(env: WorkerEnv, auth: ProjectIntakeAuthorization,
  plan: ExperiencePlan, source: PreparedSource, retained: BudgetReservationGuard) {
  if (plan.release.output.output !== "model3d" || !plan.reference
    || canonicalJson(source.reference) !== canonicalJson(plan.reference)
    || !Number.isSafeInteger(source.head) || source.head < 0) fail("model3d_reference_source_changed");
  const guard = { sql: `(${retained.sql}) AND (${source.guard.sql})`, bindings: [...retained.bindings, ...source.guard.bindings] };
  const destination = projectIntakeAuthority(env, auth, plan);
  // Root receipt statement has18 non-guard bindings; D1's limit is100.
  // Never truncate proof rows or split the actual write into multiple transactions.
  if (guard.bindings.length + destination.bindings.length + 18 > 100
    || new TextEncoder().encode(guard.sql).byteLength > 80_000
    || guard.bindings.some(value => typeof value === "string" && new TextEncoder().encode(value).byteLength > 2_000_000)) {
    fail("model3d_reference_commit_proof_too_large", 413);
  }
  return { guard, expectedHead: source.head };
}
