// Bounded P1 interface sketch only. No transport, credentials, source reader or runtime import.
import { seal, verifySeal, hash } from '../core.mjs';

export function suppliedInput(bytes, { author = 'agent-proposed-study-draft', review = null, expiresAt } = {}) {
  if (typeof bytes !== 'string' || !bytes.isWellFormed() || Buffer.byteLength(bytes) > 16000 || !bytes.trim()) throw Error('supplied_input_invalid');
  if (!Number.isFinite(Date.parse(expiresAt))) throw Error('supplied_input_deadline_required');
  return seal('p1-supplied-input', {
    version: 'p1-supplied-bytes-v1', bytesSha256: hash(bytes), byteLength: Buffer.byteLength(bytes),
    declaredAuthor: author, review, expiresAt,
    claim: 'exact supplied bytes, declared authorship/review, configuration and observed response only',
    excludedClaims: ['workspace-completeness', 'historical-authorship', 'source-rights-lineage', 'old-provider-witness'],
    evidenceClass: 'proposed-input-not-user-authored-fact',
  });
}

export function validateSuppliedInput(manifest, bytes, { now = Date.now(), revoked = false } = {}) {
  verifySeal('p1-supplied-input', manifest);
  if (revoked || Date.parse(manifest.expiresAt) <= now) throw Error('supplied_input_unavailable');
  if (hash(bytes) !== manifest.bytesSha256 || Buffer.byteLength(bytes) !== manifest.byteLength) throw Error('supplied_input_changed');
  if (manifest.version !== 'p1-supplied-bytes-v1' || manifest.declaredAuthor !== 'agent-proposed-study-draft') throw Error('supplied_input_contract_changed');
  return { integrity: true, reviewed: manifest.review !== null, executionAuthority: false };
}

export function assessInvocation(manifest, bytes, options) {
  validateSuppliedInput(manifest, bytes, options);
  return { ready: false, newPurchases: 0, reason: 'supplied_input_to_existing_admission_binding_missing' };
}
