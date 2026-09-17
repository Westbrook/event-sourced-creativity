# Workspace upload lifetime repair

The non-GLB Workspace upload could finish after its original source was retired and restored, then append reference events under the restored source and announce success. The initial actual-class/Store/Worker regression reproduced three new events and a success notice after the original upload predicate had become false. A current, uninterrupted upload passed the same fixture.

## Change

Each queued upload now captures its Store, source and authorization, route, project, document and file. A Store subscription latches retirement; cancellation, disconnect and adoption retire the upload and unsubscribe. Confirmation captures the exact queue predicate, document, findings and originating composer. Requeuing even the same File creates a different owner.

The original predicate guards local preparation, media dispatch/body reads and the existing serialized event-write queue. GLB uploads receive that captured predicate through their existing Store guard. Duplicate confirmation cannot start a second upload. Errors, completion, busy-state release and composer cleanup belong to the original interaction and cannot overwrite a newer upload. Existing successful text and GLB behavior remains covered.

No Store, Worker, generation, recovery, financial, schema or audience code changes. An already accepted media PUT or event write is not rolled back: existing retention and truthful Store receipt handling remain authoritative. Automatic image extraction, once validly invoked, remains Store-owned; this component change does not add extraction cancellation or suppress its internal receipt notices.

## Verification

- The new 21-case matrix exercises the complete original Workspace class with access-only test bridges and native ports, actual Store/Worker code and RAM-backed media. It covers source retirement/restoration, route round trips, disconnect/reconnect, adoption, cancellation, delayed media headers/body, same/different-file replacements for text and GLB, duplicate confirmation, current/stale errors, real event-write serialization, local image/audio preparation retirement and committed acknowledgement with a newer upload.
- 44 selected test outcomes passed: the upload matrix plus existing GLB upload/view custody, reference composition, media identity/surfaces and Workspace rename acknowledgement tests. The final exact-source 21-case upload matrix, type checking, changed-file lint and the production build also passed before sealing. Independent review approved the final source and verification boundaries with no blocking findings.
- An unrelated source-shape assertion in `tests/workspace-transitions.test.mjs` fails identically on canonical code; its Store source and test are unchanged by this patch. The other test in that file passes. This is not claimed as a clean whole-repository test run.
- The Sites build helper attempted to reinstall the shared dependency directory and stopped at its noninteractive safeguard. No purge was authorized. The established `npm run build` script successfully reused installed dependencies; the existing large-bundle warning remains.

Commands for the canonical publisher:

```sh
node --experimental-transform-types --test tests/workspace-upload-lifetime.test.mjs tests/model3d-upload-flow.test.mjs tests/reference-composition-persistence.test.mjs tests/reference-media.test.mjs tests/reference-media-surfaces.test.mjs tests/workspace-rename-ack-custody.test.mjs
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint src/components/forma-workspace.ts tests/workspace-upload-lifetime.test.mjs
npm run build
git diff --check
```

The tests use synthetic files and no external/provider transport. They do not certify a physical browser picker/dialog, device behavior, real image/audio decoding or live media cleanup. Initial failing fixtures remain separate from the valid baseline reproduction and final passing evidence. The canonical publisher owns integration and deployment of this isolated repair.
