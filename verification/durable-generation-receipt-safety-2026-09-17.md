# Provider receipt safety: bounded verification

Scope: the receipt-custody and accounting prerequisites of the durable-generation follow-up. A durable outbox/runner, browser lifetime changes, webhook processing and full end-to-end acceptance are still pending the hosting decision described in `docs/durable-generation-contract-2026-09-17.md`.

## Implemented behavior

- A provider request ID becomes immutable once recorded. Omitted IDs preserve it; a different ID or accepted-to-rejected update cannot overwrite it.
- Native observer updates normally commit the per-call financial checkpoint and provider ledger in one database transaction. A failed or suppressed checkpoint write rolls back settlement.
- Exact replay verifies both canonical records, including provider identity and supplied usage. It does not rewrite completed display summaries.
- Existing source-free financial reconciliation remains available when a non-conflict storage fault prevents the combined commit. Its fallback is restricted to still-unsettled calls and verifies compatible request custody; it never reports successful settlement or permits another provider call.
- In-memory planner totals and receipts update after persistence and preserve previously known fields across duplicate callbacks, including explicitly undefined optional fields.

No schema migration, provider generation, allowance change, historical financial disposition, external runtime, credential change or deployment is part of this patch.

## Executed checks

The following command passes **211/211** tests using actual SQLite transactions and mocked provider transports:

```sh
node --experimental-strip-types --import ./tests/helpers/register-output-source-imports.mjs --test \
  tests/output-requirements-ledger.test.mjs \
  tests/output-native-execution.test.mjs \
  tests/output-audio-recovery.test.mjs \
  tests/output-video-recovery.test.mjs \
  tests/output-model3d-recovery.test.mjs \
  tests/output-model3d-recovery-lease.test.mjs \
  tests/output-image-provider-health.test.mjs
```

The ledger suite includes ten new tests (30 total), covering conflicting/racing accepted identities, omitted IDs, terminal usage regressions, duplicate callbacks, rollback on `RAISE(IGNORE)` and `RAISE(ABORT)`, lost acknowledgment replay, contradictory legacy checkpoints, revoked caller authority, and both fallback failures described below. Existing native tests still prove known-receipt maintenance convergence after a ledger fault without another provider request.

TypeScript `tsc --noEmit`, the existing production build script (invoked with `npm run build` to avoid the pnpm wrapper's attempted dependency reinstallation), localization audit, custom-element manifest generation and `git diff --check` pass. No package or lockfile changes are needed. Existing large-chunk build warnings remain.

## Independent review

The receipt reviewer reproduced two new fallback edge cases before correction:

1. A terminal commit succeeds, its acknowledgment and the following receipt read both fail, and a later published summary is overwritten by the fallback's executing summary. The fallback now checks pending/uncertain status in its own transaction before any write.
2. The ledger and a legacy checkpoint contain different accepted IDs, and a callback omits its ID. The combined transaction rejects this, but an unguarded fallback could still promote the contradictory checkpoint. The fallback now verifies persisted request compatibility after its write, rolling back disagreement.

Both cases have executable regression coverage. The review found no remaining blocking findings. Its optional undefined-field caveat was also addressed by filtering undefined incoming fields before the in-memory merge.

## Existing test limitations

- `output-video-initial-execution.test.mjs` passes its source-change, cancellation and grant-revocation cases, but its complete journey fails at `readRetainedOutputVideo` with `output_video_retained_unavailable`. The same retained-read failure reproduced on the unmodified canonical checkout. This is not claimed passing or used as new live Video acceptance.
- The independent reviewer ran `output-execution-http-budget.test.mjs`. Two Slides fault cases exceed its strict fewer-than-50-operation threshold on this patch (51 and 50). They also fail on canonical `40e56a2a1d5031af1e7ab723309a4e0d7f2e698b`; the patch reduces their counts. This historical budget gate is not claimed passing.
- The source-import preload shown above is required for the Video test's extensionless TypeScript imports. Running that file without the existing preload fails before its tests load.

No browser disconnect/cross-device durability, authenticated webhook, real provider job, playback or download acceptance was exercised by this patch. Historical eight-workflow acceptance remains the report's separate evidence.

## Handoff

Canonical integration and publication stay with the existing release owner. The complete source contract identifies the atomic Run/outbox seam, existing accepted-request recovery lanes, hidden browser/server job drivers, fencing requirements, failure matrix and operational alerts. Resume only after selecting and verifying a supported durable delivery mechanism and authenticated ingress; retain truthful uncertainty for stages without proven recovery.
