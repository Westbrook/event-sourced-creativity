# Private Memory processing diagnostics — 2026-09-20

Implemented on the Memory feature branch. **Not deployed, not enrollment, and
not completion of the full Memory plan.** This closes the retained-job diagnostic
slice of the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).

## Actual integration

The authenticated results inventory explicitly negotiates `diagnostics=1` and
returns `memory-derivation-health-v1`. The real Memory review controls request it
when the user loads results or the latest summary/profile/suggestion. Automatic
brief consumers and older callers retain their unchanged response contract.
Unsolicited, missing or unknown diagnostic contracts fail closed in the strict
client; no silent reinterpretation or retry occurs.

Per purpose, diagnostics expose only actor-private retained-job metadata:

- Ready and deferred waiting jobs, active leases, expired leases requiring
  recovery, and expired jobs awaiting cleanup. These disjoint counts sum to the
  existing unfinished count. An expired lease is **not** marked ready and the
  read does not recover it, retry it or dispatch a provider.
- Age of the oldest unfinished job and time of the last completion and newest
  active retained publication. Missing completion/publication records remain
  explicitly absent, not “just updated.”
- Number, total and maximum of registration-to-completion durations, in whole
  seconds. The UI shows a whole-second average and maximum. This is not provider
  latency, source freshness, semantic completeness or a delivery SLA.

Times and counts describe the retained snapshot only. Privacy retirement can
reduce them. Completed processing does not establish inference accuracy, and
recent publication does not establish recent source evidence. Ready jobs still
need independent current consent, funding and source qualification.

## Privacy and request bounds

The same indexed aggregate supplies old counts and new diagnostics. The native
schema, authenticated actor, document/custody, enrollment and complete aggregate
are replayed before returning metadata. A queue change that leaves old counts
unchanged but changes diagnostic classification invalidates the read. The read
lease rejects wall-clock rollback, monotonic expiry and nonfinite clock samples.
No source prose, job/source IDs, provider receipts, vectors or unsent drafts are
added to the diagnostic object. No new table, index, telemetry event, background
poll, service or migration is needed.

The localized EN/FR/AR/JA disclosure is collapsed by default within existing
Memory review. Its metadata has a maximum 60-second wall/monotonic presentation
lease, anchored to the server snapshot rather than the completion of subsequent
inspection. Existing privacy, visibility, navigation and owner-scope invalidation
clear it. The full diagnostic disclosure remains scrollable in the existing
assistant at a 320px Arabic viewport.

## Verification

- 21 native runtime cases: personal/shared queue transitions, old-client
  compatibility, recovery-only expired leases, withdrawal with accounting
  retained, exact final aggregate replay, permission/custody/session races and
  clock anomalies.
- One isolated real-D1 case: mixed Creator/Chat Studio progress and immediate
  refusal after project access retirement. External network disabled.
- 748 strict-client/component cases, including all four locales and privacy,
  expiry, navigation and cancellation regressions.
- Typecheck, changed-source lint and production build passed. Existing bundle
  size warnings remain. The final build used the normal project build after the
  installed Sites wrapper path became unavailable; dependencies were unchanged.
- Whole native diagnostic inventory: 10 operations personal / 8 shared, exactly
  the same as legacy inventory in the tested fixtures; responses 1,166 / 1,477
  bytes. These are local measurements, not hosted capacity qualification.
- 12 browser cases passed against isolated synthetic data. English desktop and
  Arabic 320px diagnostics were visually reviewed, including the end of the
  disclosure; no diagnostic horizontal overflow. These are not production tests.

No real provider calls, charges, scheduler registration, deployment or enrollment
occurred. The remaining assistant/autocomplete, profile consolidation, resource
coverage and downstream lifecycle work remains native implementation. Hosted
scheduling/provider/index qualification remains separately tracked in the
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
