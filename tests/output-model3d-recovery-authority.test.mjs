import test from 'node:test';
import assert from 'node:assert/strict';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const { resolveOutputModel3dRecoveryAuthority } = await import('../worker/output-requirements-api.ts');

// Actual authority entry: these principal/original-attempt refusals must occur
// before reading any private body, querying the database or contacting a provider.
const scope = { kind: 'personal', key: 'personal:owner:project', ownerUserId: 'owner', actorUserId: 'owner',
  documentId: 'document', projectId: 'project', contextId: null, organizationId: null, projectAccessId: null };
const slot = { scopeKey: scope.key, attemptOrdinal: 0, previousSlotId: null, grantId: 'grant', jobId: 'job' };
for (const [name, scopePatch, slotPatch] of [
  ['organization', { kind: 'organization', organizationId: 'organization' }, {}],
  ['context', { contextId: 'context' }, {}],
  ['shared project', { projectAccessId: 'access' }, {}],
  ['foreign actor', { actorUserId: 'other' }, {}],
  ['foreign scope', {}, { scopeKey: 'other' }],
  ['second attempt', {}, { attemptOrdinal: 1 }],
  ['replacement', {}, { previousSlotId: 'previous' }],
]) test(`original Model3D recovery refuses ${name} before effects`, async () => {
  let reads = 0;
  const env = new Proxy({}, { get() { reads++; throw Error('No effect permitted'); } });
  await assert.rejects(resolveOutputModel3dRecoveryAuthority(env, { ...scope, ...scopePatch }, { ...slot, ...slotPatch }),
    error => error.code === 'output_model3d_recovery_scope_unsupported' && error.status === 403);
  assert.equal(reads, 0);
});
