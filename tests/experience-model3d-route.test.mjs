import test from 'node:test';
import assert from 'node:assert/strict';
import { isStandaloneExperienceRoute, parseExperienceHostRoute } from '../src/experiences/host-route.ts';
import { parseExperienceEntryRoute } from '../src/experiences/intake.ts';
import { resolveServerRoute } from '../src/platform/applications.ts';

test('Model3D resolves to the standalone authoring entry without enabling a native host', () => {
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
  assert.equal(parseExperienceHostRoute('/document/model/model?experience=model3d&experience-draft=' + draft), null);
});
