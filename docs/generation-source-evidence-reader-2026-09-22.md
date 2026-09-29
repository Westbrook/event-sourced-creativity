# Bounded original source and approval evidence reader

This extends the existing authenticated personal-owner generation evidence read with opt-in `includeSource=1`. It is implemented on `codex/forma-original-evidence`, based on `95b9e1ec` (Production 528). This change is local; no deployment, experiment activation, paid operation, schema change or financial settlement is part of it.

## Contract

Use the existing `/api/generation-evidence` JSON route or `/generation-evidence` HTML/download route, with the existing exact document and original GenerationRequested sequence selectors plus `includeSource=1`. Without the flag, the original reader remains available. The flag is a selector, never an authority grant. No arbitrary event, content, approval or execution IDs may be supplied.

The extension requires a currently retained, consenting personal administrator, no selected project/impersonation, and no configured or active pilot scope. It uses the existing non-initializing administrator reader and `continueOutputTrustedContext`, preserving full source/private-body checks and the current source head. All source facts, including inactive and historical facts, retain their rights deadlines. Project-governed and Memory-derived/pointer source is refused; references requiring object reads are unsupported in this initial narrow reader. Preference history and current-vs-historical differences remain explicit eligibility reasons, not silently discarded content.

The original request snapshot is compared against the actual authoritative event history before the selected request; block versions and document revision must agree. Current and historical snapshots remain distinct. Original document, fact and relationship event references are resolved server-side. Raw event bodies must match the same history used for the authoritative fold, with exact sidecar pointers and owner/document/project scope.

For an approved-context-proposal fact, the reader resolves its actual authoring correlation, verified original commit receipt, retained approval plan, original execution, consent and proposal result. It checks approval hashes, scope, event set/tail, selected proposal identity and approved edits. Confirmation deadlines are retained as historical metadata; they are not confused with private-content retention expiry or revived as permission to execute. Missing, expired, redacted, changed or mismatched evidence yields an explicit unavailable error, never an invented binding.

The certificate includes original producer records, complete current snapshot/block versions/source digest, owner/project heads, preference counts, deadlines, current configuration metadata and eligibility reasons. Original account/payer/region/credential attribution remains unavailable unless original evidence actually supplies it; no credentials are exposed through configuration metadata. Human review and execution authorization remain false. A complete certificate is an observation, not an experimental grant or final-charge attestation.

## Read-only and bounded behavior

An endpoint-local database membrane permits only SELECT/WITH read statements, rejects run/exec/raw and foreign batch statements, preserves native atomic `DB.batch`, and enforces a 1,024-statement native-helper budget, plus six fixed principal/footprint entry and final checks. Full history is limited to 50,000 events, 64 MiB of event/private payload data and 2.2 MB per payload. Each native 5,000-row page is admitted against the unchanged complete SQL-side footprint; a changed/incomplete history is refused. Returned-data and final 12 MB response ceilings account separately for pretty JSON and HTML-escaping overhead. These are read/transport ceilings, not a claim that database scanning or billing is bounded to zero.

There are at most 128 original source references, 16 approval previews, 256 approval events per preview and 48 selections per preview. Original retained content is resolved from owned records only. The membrane refuses media operations rather than following unsupported reference objects.

Before disclosure, the reader replays original content/producer witnesses, current source assertions, complete history head/footprint, administrator authority and pilot exclusion. A final synchronous deadline/configuration/database check runs after response serialization. Existing original-job/event/private-record checks still apply. Cache headers remain private/no-store and the HTML remains escaped, script-free and frame-restricted.

No initializer, seed, lease release, cleanup, retention sweep, reconciliation, provider dispatch or background task is invoked. No H5 source/receipt rows are created. This does not alter ordinary generation or accept the proposed accounting alternative.

## Verification and next step

Verification passed on 2026-09-22:

- Focused source and actual production Worker regressions: 2 passed, 0 failed. Both exercise the complete retained approval chain with two learned selections and preserve ordinary mocked generation readiness, admission, checkpoints, settlement and authorized reload.
- Negative cases cover missing administrator authority, invalid selectors, expired original rights, expired/redacted producer records, changed approval/result/binding, changed source history, oversized history and stable-head private-preview tampering. Preference history produces explicit ineligibility.
- The fixtures assert no database writes, background work or additional provider calls, including moderation, during evidence reads.
- TypeScript, changed-file ESLint, localization checks, generated schema consistency, production build and `git diff --check` passed.
- Independent source review checked atomic batching, deadline and authority fences, producer/body identity, full-history bounds and exact serialized response ceilings.

Reproduce the focused pair after a production build with:

```sh
node --import tsx --test --test-name-pattern='(source|production bundle): isolated schema delivers' tests/event-save-repair.test.mjs
```

The regression uses synthetic retained records and mocked providers. It does not assert that the original live attempt still has all required producer records.

Deployment remains a separate concrete review. After authorized deployment, one authenticated read of the already identified attempt can determine whether its original approval evidence survives. A local passing fixture is not a live custody result, source qualification, human fidelity approval or permission to purchase another generation.
