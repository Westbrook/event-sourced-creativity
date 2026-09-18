# Memory financial execution continuation

Branch-only implementation on `codex/forma-memory-foundation`, continuing
[the full native plan](forma-memory-native-continuation-2026-09-18.md).
**Not whole-plan completion, a main merge, a deployment, or user activation.**

## Implemented

- Original full-source/lease-bound atomic paired reservations and a separate,
  one-consumer dispatch claim. Configuration, consent, custody, current sources,
  native allowances and the shared Memory cap are replayed before transport.
- Bounded, fixed-endpoint OpenAI Responses transport with no automatic retries.
  Requests use the separately accepted model and limits, no tools, `store:false`,
  `background:false` and `truncation:disabled`. A conservative byte bound plus
  framing must fit the approved input-token allowance before any reservation.
- Receipt persistence and original-price settlement are separate from semantic
  success. Actual zero, cached usage and overruns are retained; invalid output,
  stale source access or privacy withdrawal do not invent refunds. An ambiguous
  dispatch remains reserved. A proven never-dispatched request must be permanently
  fenced before its original holds can be released.
- Organization erasure retains exact financial IDs, original-period counters and
  settlement sidecars while deleting private purpose jobs and content. Existing
  and racing legal holds prevent the destructive admission step. Late settlement
  does not require rereading private data or restoring deleted membership.
- Current-month cap synchronization is separate from a failed reservation. The
  revised **unapplied** migration0045 is schema-only; historical accepted minima
  survive first reconsent/erasure and active prior-month consent carries forward.
- Purpose controls show only the authenticated payer's aggregate effective cap,
  verified usage, pending exposure and remaining cap, plus accounting retention
  disclosure. The UI remains inactive for enrollment (`processingImplemented:false`).
- The existing Scene source proof now balances its exact conjunctions, avoiding
  D1 expression-depth failure without materializing whole history, dropping
  comparisons or increasing capacity limits. Its diagnostic fixture now binds
  the actual diagnostic helper instead of throwing an unrelated ReferenceError.

## Verification and limits

All records are isolated test data. Transport is mocked. No production database,
credential, flags, audience, enrollment, provider spending or schedule changed.

- Passed: 169 native execution/privacy/accounting checks; 158 Scene/history/proof
  checks; 518 client/component checks; 44 conversation-capture schema checks;
  76 migration/schema/native-budget checks; eight guest financial-inventory checks;
  and two synthetic browser journeys. Typecheck and production build pass.
  These are focused suites, not a claim that the full repository suite passes.
- English desktop and Arabic 320px browser journeys use finite synthetic GET
  responses only. They verify disclosure and control reachability, not hosted
  authorization, provider behavior or individual consent.
- The complete paid-Scene suite's 117 previously failing cases now pass. Other
  history/proof cases retain exact byte, mutation, bounds and receipt checks.
- Eight older `output-execution-http-budget.test.mjs` failures still exceed the
  original whole-request subrequest budget (50–54 operations). Their unchanged
  failures were reproduced on `297acaa`; they are not waived or fixed here.
- The Sites build wrapper attempted dependency downloads unavailable in the
  sandbox. Those two task-owned processes were stopped. The unchanged application
  build script succeeded with the already-installed local toolchain; no dependency
  manifest or lockfile was changed. Existing large-chunk warnings remain.

## Remaining native work

The transport returns an unverified, citation-checked candidate, **not a persisted
summary/profile, completed semantic cursor, learned suggestion or index entry**.
Still implement the durable result/dependency/correction/suppression lifecycle,
processing windows and worker/outbox integration, interrupted-response recovery,
nested/broader native scopes, independent Chat Studio jobs, rolling rebase and
broader genuine consumption/source coverage. Complete integration and request-budget
qualification remain part of the native scope.

## External and operational work

Continue tracking unsupported Sites capabilities separately in the
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md) and
[non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md):
PostgreSQL/pgvector, supported hosted scheduling, hosted atomic migration execution,
provider/model/pricing/retention qualification, measured cap acceptance, release
integration and explicit individual consent. Local mocks do not close those gates.
