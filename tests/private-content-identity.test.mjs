import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateContentIdentityAllowed } from '../worker/private-content-identity.ts';

// Actual import-free production predicate only; no storage/auth/schema/provider
// or application module is imported. These cases do not prove fresh persistence.
const digest = '0123456789abcdef'.repeat(4);
const copyId = `copy-preview-${digest}`;
const canvasId = `canvas-arrangement-preview-${digest}`;
const experienceId = `experience-draft-${digest}`;

test('both existing preview kind/prefix pairs remain accepted', () => {
  assert.equal(privateContentIdentityAllowed('authoring-preview', { contentId: copyId }), true);
  assert.equal(privateContentIdentityAllowed('authoring-preview', { contentId: canvasId }), true);
});

test('the dedicated experience-draft kind accepts its server-derived ID grammar', () => {
  assert.equal(privateContentIdentityAllowed('experience-draft', { contentId: experienceId }), true);
});

test('prefixes cannot be transferred across content kinds', () => {
  for (const contentId of [copyId, canvasId]) {
    assert.equal(privateContentIdentityAllowed('experience-draft', { contentId }), false);
  }
  assert.equal(privateContentIdentityAllowed('authoring-preview', { contentId: experienceId }), false);
  for (const kind of ['prompt', 'document-artifact', 'memory-structured-origin', '', 'Experience-draft']) {
    for (const contentId of [copyId, canvasId, experienceId]) {
      assert.equal(privateContentIdentityAllowed(kind, { contentId }), false);
    }
  }
});

test('all three grammars retain exact lowercase prefix and 64-hex constraints', () => {
  for (const [kind, prefix] of [
    ['authoring-preview', 'copy-preview-'],
    ['authoring-preview', 'canvas-arrangement-preview-'],
    ['experience-draft', 'experience-draft-'],
  ]) {
    for (const contentId of [
      `${prefix}${digest.slice(1)}`, `${prefix}${digest}0`, `${prefix}${digest.toUpperCase()}`,
      `${prefix}${'g'.repeat(64)}`, `${prefix.toUpperCase()}${digest}`, `${prefix}${digest}/extra`,
      ` ${prefix}${digest}`, `${prefix}${digest} `, `${prefix}${digest};`, prefix, digest, '',
    ]) assert.equal(privateContentIdentityAllowed(kind, { contentId }), false, contentId);
  }
});

test('unsupported kinds short-circuit before an identity getter is inspected', () => {
  let reads = 0;
  const sentinel = new Error('Identity getter must not run for an unsupported kind');
  const identity = { get contentId() { reads++; throw sentinel; } };
  for (const kind of ['prompt', 'document-artifact', 'memory-structured-origin', '']) {
    assert.equal(privateContentIdentityAllowed(kind, identity), false);
  }
  assert.equal(reads, 0);
});

test('preview getter access order and original thrown identities are preserved', () => {
  let reads = 0;
  assert.equal(privateContentIdentityAllowed('authoring-preview', {
    get contentId() { reads++; return copyId; },
  }), true);
  assert.equal(reads, 1, 'The second preview regex is not evaluated after a copy match');

  reads = 0;
  assert.equal(privateContentIdentityAllowed('authoring-preview', {
    get contentId() { reads++; return reads === 1 ? 'unmatched-first-read' : canvasId; },
  }), true);
  assert.equal(reads, 2, 'Canvas matching retains the second ordered identity access');

  reads = 0;
  assert.equal(privateContentIdentityAllowed('experience-draft', {
    get contentId() { reads++; return experienceId; },
  }), true);
  assert.equal(reads, 1);

  const sentinel = new Error('Original identity access failure');
  assert.throws(() => privateContentIdentityAllowed('authoring-preview', {
    get contentId() { throw sentinel; },
  }), error => error === sentinel);
});
