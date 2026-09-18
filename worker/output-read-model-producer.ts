import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { PilotUser } from "./pilot-policy.ts";
import { rememberOutputPrivateBody, type OutputScope } from "./output-command-core.ts";
import { hasCapability } from "./principal-request-core.ts";
import { readOutputReadModel } from "./output-requirements-read-model.ts";
import { outputAssetDocumentPrefix, outputAssetObjectKeys, outputAssetStorageCustodyMatches } from "./output-asset-storage-identity.ts";
import { outputReadModels } from "./output-read-state.ts";

export function outputReviewEligibility(scope: OutputScope, principal: PilotUser, resultCreatedByUserId: string, assetCreatedByUserId: string | null, origin: Record<string, unknown> | null) {
  const canReview = scope.kind === "project" ? hasCapability(principal, "project.review.approve", { organizationId: scope.organizationId!, projectAccessId: scope.projectAccessId! }) : ["creator", "admin"].includes(principal.role);
  const nativeContributorUnknown = origin?.kind === "native_job" && (typeof origin.createdByUserId !== "string" || !origin.createdByUserId);
  const contributors = [resultCreatedByUserId, assetCreatedByUserId, origin?.createdByUserId, ...(Array.isArray(origin?.editedByUserIds) ? origin.editedByUserIds : [])];
  const independentReviewBlocked = scope.kind === "project" && (!assetCreatedByUserId || !origin || Boolean(nativeContributorUnknown) || contributors.includes(scope.actorUserId));
  return { reviewAllowed: canReview && Boolean(assetCreatedByUserId && origin) && !independentReviewBlocked, independentReviewBlocked };
}

function readOutputModel(trusted: OutputTrustedContext) {
  let pending = outputReadModels.get(trusted);
  if (!pending) {
    pending = readOutputReadModel(trusted.env, trusted.scope, trusted.events, {
      rememberPrivateBody: (id, raw) => rememberOutputPrivateBody(trusted.scope, id, raw),
      reviewEligibility: (resultAuthor, assetAuthor, origin) => outputReviewEligibility(trusted.scope, trusted.principal, resultAuthor, assetAuthor, origin),
      storagePrefixes: () => [outputAssetDocumentPrefix(trusted.scope)],
      legacyStorageKeys: (rows) => rows.flatMap((row) => {
        const extension = /\.([a-z0-9]+)$/u.exec(String(row.storage_key))?.[1];
        if (!extension) return [];
        try { const legacy = outputAssetObjectKeys(trusted.scope, String(row.asset_id), String(row.content_sha256), extension).legacyKey; return legacy && row.storage_key === legacy ? [legacy] : []; }
        catch { return []; }
      }),
      storageIdentityMatches: (row, _inspection, object) => outputAssetStorageCustodyMatches({ ownerUserId: trusted.scope.ownerUserId, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId, assetId: String(row.asset_id), scopeKey: trusted.scope.key, sha256: String(row.content_sha256), storageKey: String(row.storage_key) }, object.customMetadata),
    });
    outputReadModels.set(trusted, pending);
  }
  return pending;
}

export { readOutputModel };
