# Still generation recovery — production integration

The user authorized integration into `main` and production publication on 22 September 2026. Recovery implementation `31301ccb` was cherry-picked as `68b6a5a4` onto current main/Production 520 (`aec1252c7a353726b8b9096f793cd534668dd7c4`). The E4 evidence-reader and scene recovery changes, inactive H5/F4 modules and historical evidence remain intact. An unused toolbar variable was removed during qualification.

## Qualification on current main

- 479/479 Still, failure classification, identity, exact isolation, actual D1 and mocked delivery tests pass.
- The broader current integration run passes 616/623 tests. Its seven failures reproduce with identical test names on a freshly built, unchanged Production 520 checkout (190/197 in the corresponding reliability file). They concern three unacknowledged advisory-preflight fixtures, three conservative presentation subrequest-budget assertions, and one stale shared presentation status expectation. No assertions were weakened.
- Current E4 scene/recovery, H5/F4 preparation and bundled reservation-recovery tests pass within that combined run.
- Build, TypeScript and both migration-release guard tests pass. Changed-source lint has four existing empty-catch findings in StillApp, also present in unchanged main; it introduces no new findings.
- Production's read-only isolation receipt still identifies `empty-memory-trigger-isolation-v1` with manifest `fd1752125f0e8818adc70a7805e74413c00d165adc898ccb2b2ad8ab25bd3ef9`. Environment revision 16 has no Memory enablement values. Audience revision 7 remains workspace-wide. No runtime setting or audience change is included.

The first regression invocation overlapped build cleanup and could not import the not-yet-built Worker in the route test. The sequential final run above passes in full. This transient test-ordering failure is retained in the local evidence and is not counted as a product regression.

## Packaging and scope

The official Sites source workflow pushes the exact integrated commit. As in Production 520, only the separately guarded release archive is eligible for upload: its migration prefix and journal must match the established 41-migration allowlist byte for byte. The generic workflow archive includes candidate migrations and is never uploaded. Candidate/pending schemas and inactive study modules are not enabled by this release; historical offline study envelopes remain historical and do not certify the changed application source.

No paid generation probe is part of this authorization. Successful deployment confirms publication, not provider effectiveness or image fidelity. Production version/deployment receipts, final archive digest, source commit and raw verification logs are retained in the independent Progress Report. Original attempt receipts remain immutable and new paid requests still require explicit review.
