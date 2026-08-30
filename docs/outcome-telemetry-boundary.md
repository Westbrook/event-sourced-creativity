# Outcome telemetry integration boundary

This is an additive, read-only extension of existing analytics. It adds no
event type, table, queue, tracking call, job mutation, scheduling configuration,
provider request, media probe, invoice reconciliation, or release authority.

## Sources and meanings

- `report.outcomes` derives from the same authorized, synthetic-filtered event
  streams as the analytics report. Its selected event window and truncation
  are explicit. Event IDs deduplicate repeated reads; artifact IDs and exact
  output revisions are counted separately from the number of receipts.
- `ArtifactApproved` means a historical approval decision was recorded.
  Revision/hash-bearing receipts are separated from unbound legacy receipts.
  `currentlyApprovedArtifactCount` remains null: current source, output hash,
  rights, review assignment and permission must come from the existing exact
  artifact-delivery authority. Do not reimplement that policy in analytics.
- `DocumentArtifactExported` is an export receipt/acknowledgment, not proof of
  browser bytes, successful download or recipient delivery. Shared export
  authorization can be recorded before the browser file action.
  `ObjectExported` is a separate resource receipt: it can identify a document or
  block as well as an image. Render completion, views and Canvas interaction
  receipts cannot increment approval or export counts.
- Explicit numeric `GenerationUsageRecorded.cost_microusd` is recorded usage.
  Exact zero remains exact, including a no-new-charge recovery. Missing,
  malformed or legacy prices are not silently estimated in this measure.
  Existing legacy estimates remain in the older analytics cost measure.
  Recorded usage is not an independently reconciled provider invoice.

## Separate live snapshot

`readOutcomeTelemetryLiveEvidence` is an internal read for the existing
principal-admin analytics host, not a new API or a new permission. Its current
access snapshot is validated inside the SQL read and again before returning
metadata. Missing/stale authority returns an error, not reassuring zero counts.

`report.outcomes.live.finance` is **the signed-in actor's account**, across
**all original reservation periods**, not the multi-user/project event scope or
the selected analytics date range. It reads `cost_budget_reservations` once,
groups the original periods, and does not add budget counters or usage events
to the same total. Active and executing rows retain their holds; settled usage
is separate; a failed/canceled job does not release money. Unknown states,
invalid amounts, overflow and the bounded period limit make totals null.
A prior-month hold stays visible even when the event filter is seven days.
Amounts remain account facts after a project membership changes.

`report.outcomes.live.jobs` contains only actor-owned, currently readable,
active/unexpired job metadata. Shared work requires exact project/document/job
custody, the original actor anchor, active migration and current scoped
capabilities. Viewer access is limited to original consented planning jobs;
Canvas planning respects its separate capability. Unknown/ambiguous custody
cannot fall through to the personal path. No private job body, prompt,
provider receipt, content reference or media URL leaves the query.

Completion and checkpoint storage are different facts:
`completedExplicitlyUnavailable` uses an explicit boolean result marker.
The remaining completed jobs have **unknown usable-result availability**.
A retained JSON checkpoint is not evidence that the paid result remains
readable or that its media exists or plays. The report never probes media.
`usableResultCount`, download count, recipient delivery and invoice
reconciliation remain null rather than fabricated zero or success.

Live evidence is recomputed on every analytics request, including a zero-row
event-cache hit. The existing safe source cache keeps privacy schema 2 and adds
`outcomeBindings:2`, so older projections that discarded revision/hash fields
are rebuilt. Version 2 also preserves the supported public Output command and
receipt identities in the existing nine-field cache rows. This does not change
runtime cache cleanup or create another store.

### Foreground analytics request budget

The established principal-admin analytics path now has an explicit **three
foreground D1 round-trip** contract: existing authentication, one combined
dashboard/live-evidence batch, then a separate final current-access proof.
This changes the earlier two-trip dashboard-only performance contract; it is
not a claim that an in-batch guard can detect revocation after the batch returns.
The standalone live reader retains its snapshot batch and separate final proof.

The combined batch appends the existing authority, account-ledger and job
metadata statements after the existing dashboard statements: seven statements
on a cold/durable read and six on a warm event delta. The event statement stays
at index two and the durable source statement stays at index three. A corrupt
or invalidated source requiring a rebuild adds one explicit batch (four
foreground trips); only that latest batch's live rows are decoded and checked.
Ledger and retention metadata are never reused from an event cache or checkpoint.

Missing SQL evidence or a failed query returns an error, never empty success.
A revocation observed by the separate final proof discards the whole response.
In-memory source publication and the existing background safe-source checkpoint
are scheduled only after that proof succeeds; there is no further awaited work
before constructing the response. Live metadata adds no foreground writes,
providers, media probes, new cache, or new permission.

## Existing host wiring

- `forma-analytics` uses the existing metrics plus the read-only
  `outcomeTelemetryDisclosure` for historical receipts, explicit recorded usage
  and the separately scoped live account snapshot. Its leading event-cost metric
  is labeled as recorded plus estimated cost: `report.totals.costMicrousd` retains
  the legacy calculation, including token-based estimates when an explicit amount
  is absent or invalid. It is not the explicit-only usage amount, an account hold,
  a settled ledger total or an invoice total; those facts are not combined.
- `forma-account-settings` uses the existing personal monthly budget counters,
  their current-period qualification, and `personalUsageReceiptDisclosure` for
  already-loaded personal records. Shared-project and impersonated views do not
  show this personal spending section.
- `forma-workspace-settings` uses `outcomeSchedulerEvidence` inside its existing
  assurance section. The existing host authority, settings controls, native
  disclosures and localization infrastructure remain in place.
- Label event approvals and exports as historical receipts. Show distinct exact
  revisions alongside action counts only when useful; never rename them
  "currently approved", "delivered", "customers served", or ROI.
- Put actor-account held/settled amounts in a visibly separate scope with their
  original periods and `asOf`. Do not silently apply the event-range filter or
  aggregate financial totals across analytics users. Null means unavailable,
  not $0. Unknown reservation state deserves visible attention.
- A cached report is an explicitly dated snapshot, not current authorization.
  Older client report snapshots can lack `outcomes`; treat that as unavailable
  until fresh data arrives. Keep the existing 401/403 snapshot-clearing path.
- Label retained checkpoints as metadata, and availability as not checked.
  Exact current result/release decisions continue through existing authorized
  artifact and job handlers, not through analytics.
- Supply all visible labels and status announcements in English, French,
  Arabic and Japanese; preserve existing focus, 44px controls, RTL, reduced
  motion and narrow-viewport table handling.
- `/worker/enterprise-api.ts` already distinguishes actual scheduled-handler
  receipts from traffic cleanup and explicitly reports
  `hostingScheduleVerified:false` / `schedulerConfigured:false`. Reuse that
  existing observability evidence under its own authority. Do not add cron
  claims or imply that a successful local handler test proves no-traffic
  hosting execution. Canvas release attestation is not scheduler evidence.

## Verification boundary

The new tests use canonical event fixtures and actual SQLite in memory,
including the actual existing schema, analytics host, principal-access query,
reservation rows, job custody and retention handlers. All identities and
outputs in those tests are fixtures. They do not establish production media
availability, provider billing reconciliation, second-user delivery, hosted
cron operation, native/assistive-technology acceptance, ROI or release approval.
