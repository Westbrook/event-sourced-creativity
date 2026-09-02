# Memory source integration at the E5 checkpoint

Status: the three retained memory slices have been applied in dependency order to accepted E5 commit `2ebff51c9ae5cf70fe79e43a2841e24c09e05c34`. This is an **inactive, source-only integration**, not live memory, enrollment, ingestion, recall, scheduling or a privacy API.

The original 34 files match the final retained feature commit byte-for-byte. No existing application file, active schema/journal, package/lock, hosting configuration, UI component or stylesheet was changed. Original branch reports remain historical; this note records the combined-source check.

## Reused slices and fresh checks

- `6570a78aed27232000d15317acf15734e2a511ef`: offline scoped-memory foundation.
- `c56f87015378bc946a91db840cac97e130fc0ca7`: isolated synthetic persistence.
- `086807d38de4235bbbfc6e14bf353d7d9ffbbe51`: durable synthetic review jobs.

The retained 12-file suite passed **189/189**, with no failure, skip, cancellation or late asynchronous error. Full TypeScript checking, ESLint across all 21 added TypeScript/JavaScript files, and the normal application build completed with exit zero. No test was weakened. The test source aggregate was `c3cf44ed8655d4fab6dabd72cf680b0c68cd49659f7ca5a3e874fe0224bd6de8`; the immutable result receipt has SHA-256 `f7961cff21393a9d627965388779fa91d8e0448a35d3d148efc9e6af0116ff6b`.

All **476 built files are byte-identical to the accepted E5 build**, aggregate `52ed4b3fed79314112ea34b353b736b68d10ec46b59c6e931536892b0f10848f`. Source and packaged migrations remain the same 47 files / 23 SQL entries; all three component manifests remain identical. The existing E5 UI/browser evidence is reused for this unchanged executable build, not falsely described as a new browser replay.

Static checks found no live memory imports, constructors, active migration entries or implementation markers in the built application. Both SQL files remain under `db/memory-shadow/`, outside `drizzle/`. Their installers are confined to the explicit synthetic test harness. No deployed database migration, memory activation or paid provider operation was performed.

## Confirmed prerequisite before any real conversation consumption

The isolated specialist-answer check in [memory-source-adapter.ts](../worker/memory-source-adapter.ts) proves the task, action commit and event receipt, then reads the retained chat copy. It does **not** yet preserve all of the canonical paid-result/consent checks in [assistant-specialist-consent.ts](../worker/assistant-specialist-consent.ts), specifically `assistantPaidReplyReadGuard`.

Before live source capture or publication of memory, the real authority resolver and transaction predicates must also prove current execution authority, retained consent, canonical completed execution/result, matching actor/turn/binding/custody, and exact copied-answer equality. Withdrawal of canonical consent/result or divergence of the copied answer must invalidate memory and its dependent projections. Existing synthetic specialist fixtures do not cover that bridge. This is a live-activation blocker, not an observed production leak.

## Other boundaries remain off

- Explicit, distinct learn/recall enrollment; existing operation consent is not memory consent.
- A real authenticated-principal/resource resolver and lossless native permission-fingerprint mapping.
- Native privacy, organization/account deletion, backup/restore and eventual index erasure.
- Production-scale pagination and deployment-database transaction/query limits.
- A supported, witnessed background invocation without site traffic.
- Model/vector processing, semantic-quality claims and live assistant-context replacement.

Default-off also leaves cleanup inactive. The synthetic forget/maintenance tests are not proof of production erasure or unattended scheduling. The application keeps its original live behavior. The E6 pause and all existing authority, media and spending holds remain unchanged.
