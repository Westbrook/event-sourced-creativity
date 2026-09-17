# Storyboard extraction harness maintenance — 2026-09-17

Baseline: frozen release candidate R3 `c32a428dd24363fac4441328089f9f4d877fcaa7`.
This changes only the extraction test and this record. No production source,
provider operation, persisted application data, deployment, or runtime activation
is changed.

The existing correctly configured R3 run passed 10 of 12 tests in
`tests/experience-storyboard-native-result.test.mjs`. The two failures were stale
test dependencies: the extracted server `state` method lacked durable ownership
ports; the extracted host `#check` method lacked `#observationPending` and caught
that missing-method exception before publishing the verified result. The earlier
missing-`FORMA_SOURCE_ROOT` configuration failure remains historical evidence.

Both production methods are byte-identical from production 384
(`6b533ee6130bb73dc691a5162b12828676fa4d8f`) through R3:

| Extracted method | Bytes | SHA-256 |
| --- | ---: | --- |
| `worker/experience-output-api.ts` `state` | 22406 | `4b4e35a9d5649e804d5212b8782ba34042c3b2a3fa9f475a211aada549ba4941` |
| `src/components/forma-experience-host.ts` `#check` | 19169 | `2e88e54a38af8aa331d07232c1f908d9c6d8087e925e67d707d5cea9af0c3472` |

The repaired fixture imports the actual `outputJobIsDurable` and
`readOutputDurableOwnership` functions. An explicit ordinary request makes no
durable query. Marked requests use the exact bound durable observation query:
ready ownership is projected without permitting Run, resume, recovery, or
replacement; missing rows and malformed observations reject with the real
conflict error. Existing authorization, foreign identity, expiry, and no-action
assertions remain.

The host fixture extracts the actual `#observationPending` method. It verifies
completed ordinary and durable reads, preserves all six withdrawal boundaries,
and tests both legacy pending statuses and all five durable pending phases.
Pending work reads no requirements, native job, private content, or DTO and
schedules one observation retry without publishing anything. The network guard
and existing result lease checks remain.

Validation deliberately reruns only the two affected test groups: baseline
0/2, final 2/2. Those groups cover 13 state scenarios and 15 host scenarios. The
other ten accepted tests were not repeated. Scoped ESLint and `git diff --check`
pass. An intermediate missing-predicate failure and a new durable fixture's
exact permission-shape failure were retained before the final successful run.

Artifacts: `/private/tmp/forma-storyboard-harness-r3-evidence/`, including original
R3 logs and source classification, isolated red/green logs, lint, final hashes,
and independent source review. These extraction checks use finite fixture ports;
they do not establish database admission, browser behavior, or a new live
Storyboard provider journey.
