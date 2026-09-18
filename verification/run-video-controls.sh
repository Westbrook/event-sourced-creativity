#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export FORMA_SOURCE_ROOT="$PWD"
exec node --import ./verification/register-source.mjs --experimental-transform-types --test tests/output-video*.test.mjs tests/experience-video*.test.mjs tests/experience-entry-contract.test.mjs tests/experience-output-terms.test.mjs tests/experience-storyboard-native-result.test.mjs tests/output-storyboard-completion.test.mjs tests/model3d-native-join.test.mjs tests/native-retained-video-renderer.test.mjs tests/native-focus-preservation.test.mjs tests/output-budget-admission.test.mjs tests/model3d-publication-head.test.mjs tests/model3d-failure-progress-copy.test.mjs tests/experience-output-recovery-boundary.test.mjs
