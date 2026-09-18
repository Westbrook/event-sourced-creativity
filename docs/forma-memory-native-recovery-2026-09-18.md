# Native Memory interrupted-work recovery

Branch-only continuation after `8bfa4c3`. No production SQL, publication, provider
request, enrollment, schedule registration or spending was performed.

## Implemented

- Expired **unfunded** leases can return to waiting only after an atomic check
  proves absence of both the original deterministic financial record and private
  bridge, and absence of either reservation identity in either native ledger.
  A later claim must rehydrate current native authority and original sources.
- Database-clock exponential backoff starts at one minute. At eight claims, the
  job waits until its original expiry. Neither recovery nor exhaustion advances
  the delivery cursor, removes originals, extends retention or declares success.
- A source-free financial page processes at most two original records. It settles
  retained verified usage, or permanently fences a request proven never sent
  before releasing its holds. A committed dispatch with unknown usage remains
  reserved. Privacy erasure and rollout withdrawal do not invent a refund.
- Schema-only migration `0046_memory_derivation_recovery_cursor` adds a protected,
  compare-and-swap scan position. Maintenance moves past failed financial rows,
  wraps at the end, and revisits failures on another pass. Concurrent runners and
  lost acknowledgements cannot reset the cursor or authorize a provider retry.
  **Scan position is not semantic coverage or verified accounting completion.**
- The existing native scheduled-event handler calls this bounded recovery after
  privacy cleanup. This code hook does not register a hosted schedule or turn on
  derivation. Older installations without the optional recovery schema remain a
  no-op for the hook; partial or altered schema fails closed.
- ORM, generated snapshot/journal, exact schema readers and the guest-result
  inventory recognize the additive schema without relaxing other custody checks.

## Local evidence

- 25 focused recovery checks pass, including isolated workerd/D1 settlement after
  erasure and expired-lease backoff, faulted rows, scan wraparound, lost and racing
  acknowledgements, schema mutation and database replacement.
- Two actual shared native settlements plus cursor maintenance remain below the
  unchanged 50-operation local page bound. This is **not** qualification of the
  whole hosted scheduled handler, which runs other maintenance too.
- 70 migration/schema checks and 11 guest financial/recovery-inventory checks pass.
- Typecheck and production build pass, with existing large-chunk warnings.
- The broader native derivation/tenant-erasure regression group passes 194/194
  checks (including the 25 recovery cases above).

All fixtures are isolated. Provider transport was not invoked by recovery.
No plaintext, vector, document or source identifiers are written to general
analytics. The retained scan position contains only a minimized financial ID.

## Still required

This does not persist or expose semantic candidates, complete semantic processing
windows, deliver the separate Chat Studio producer, or implement the index outbox.
Those and wider native scopes remain in the [native continuation plan](forma-memory-native-continuation-2026-09-18.md).

Unknown submitted usage still requires verified original billing evidence; time
passing alone cannot release it. Hosted scheduling/capacity, external indexing,
provider qualification and individual enrollment remain separate operational
requirements in the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
