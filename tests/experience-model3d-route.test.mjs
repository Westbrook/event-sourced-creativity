import test from 'node:test';
import assert from 'node:assert/strict';
import { isStandaloneExperienceRoute, parseExperienceHostRoute } from '../src/experiences/host-route.ts';
import { parseExperienceEntryRoute } from '../src/experiences/intake.ts';
import { resolveServerRoute } from '../src/platform/applications.ts';

test('Model3D resolves to standalone authoring and a bounded native selector, not authority', () => {
  const draft = 'experience-draft-' + 'a'.repeat(64);
  const path = '/experiences/model3d?draft=' + draft + '&progress-report';
  assert.equal(isStandaloneExperienceRoute(path), true);
  assert.deepEqual(resolveServerRoute(path), {
    application: 'creative', entryPath: '/experiences', canonicalFamily: '/experiences/model3d',
  });
  assert.deepEqual(parseExperienceEntryRoute(new URL(path, 'https://forma.test')), { output: 'model3d', draftId: draft });
  for (const path of ['/experiences/model3d/mesh', '/experiences/model3d#fragment', 'https://other.test/experiences/model3d']) {
    assert.equal(isStandaloneExperienceRoute(path), false);
  }
  const native = '/document/model/model?experience=model3d&experience-draft=' + draft;
  assert.deepEqual(parseExperienceHostRoute(native), {
    output: 'model3d', draftId: draft, documentId: 'model', documentRoute: '/document/model/model',
  });
  for (const path of [native + '&experience=model3d', native + '&grantId=forged', native + '#mesh',
    native.replace(draft, 'invalid-draft'), 'https://other.test' + native]) {
    assert.equal(parseExperienceHostRoute(path), null);
  }
});
