# Memory: recovery of oversized legacy jobs

Feature-branch implementation only. No deployment, provider request, real-user enrollment, scheduling registration or budget activation is authorized by this record. Synthetic tests do not qualify a production provider or hosted scheduler.

## Implemented

The native worker now handles both source-capture and provider-request capacity failures by atomically subdividing an **unsubmitted** multi-reference job. It replaces the parent with two contiguous child windows, preserving every source reference, original timestamp and retention ceiling. Each reference still represents a whole original pair or typed observation: no body is clipped, silently skipped or treated as completed.

- Native access, enrollment, purpose, qualification, lease and source-reference guards accompany the replacement transaction.
- The original deterministic financial identity, both reservation namespaces, the private finance link, retained results and completion records must be absent. A missing private bridge is not proof that a request was never submitted.
- Child jobs need new native admission and source proofs before any purchase. A copied lease, stale parent, changed schema, changed source, lost ACK or failed transaction cannot grant execution authority.
- Registration and completion cursors remain unchanged. Completing the later child cannot advance past the earlier unfinished child.
- A transaction-local command contains only job/reference metadata and consumes itself inside its insert trigger. A retained command is rejected by native and guest-isolation proofs.
- Normal registration retains its 32-pending-job cap. Subdivision has bounded headroom up to 160 pending children, avoiding deadlock at a full registration queue. Equally due jobs prefer smaller source counts so subdivision can reach processable leaves. One invocation performs at most one subdivision or one provider operation; subdivision reports `processed: 0`.
- An indivisible, still-oversized original is not truncated or falsely completed; it remains capacity-limited for the existing recovery/backoff path.

## Migration and compatibility

`0051_memory_derivation_split` is schema-only, but **not purely additive**: it adds one transaction-local command table and three triggers, and replaces the exact job-insert trigger to permit only command-bound child intervals. Existing data and financial history are not rewritten. The original registration path remains intact.

The local migration runner accepts only the hash-pinned 0051 replacement, validates the before/after trigger definitions, and executes the replacement within its existing transaction. General `DROP` remains unsupported. Dry run rolls back schema and receipts; reruns verify the new definition; altered upgrade SQL, missing/modified old guards and a reverted receipted guard fail closed. The paired drop/create is counted as one local reconciliation operation (five operations, six SQL statements).

Native and guest schema inventories accept the new job fingerprint only alongside the complete split family. Old deployments remain readable under their exact previous profile; partial hybrids do not qualify.

## Verification

Coverage includes local SQLite and isolated workerd/D1, complete 65/128-reference boundaries, full registration queue headroom, no-gap completion, native model transport mocked locally, existing financial holds/dispatches, damaged finance links, stale/copied leases, rollback, lost acknowledgements, schema drift and retained-command guest isolation. Verification passed: 321 native/privacy/worker tests; 79 migration/schema tests; 55 guest-isolation tests, followed by five overlapping split-profile checks after final headroom adjustment; TypeScript; changed-source ESLint; production build; and diff whitespace checks. The build retains existing large-chunk warnings. These are focused suites, not a claim that every repository test passes.

## Still in scope

This closes oversized-job subdivision, **not** rolling semantic rebase or the entire Memory plan. Remaining native work includes semantic history reconciliation, nested project and page/block identities, independent Chat Studio and broader interaction producers, guarded summary/profile/suggestion/autocomplete consumers, index outbox/deletion acknowledgements and end-to-end qualification. Existing Output request-budget failures remain tracked and are not waived.

External provisioning, hosted delivery qualification, provider qualification, a measured benchmark cap and individual affirmative enrollment remain separate operational gates. See the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
