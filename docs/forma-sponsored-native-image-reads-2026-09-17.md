# Sponsored native Image reads

This change connects the dormant sponsored read ledger to the existing native
`GET /api/generated-images/:outputId` and `GET /api/media/:key` boundaries. It
does not install schema, approve a policy, supply launch values, enable an
issuer, or register a second API. Production sponsorship remains inactive.

## Resource admission and actual creative custody

The bounded lookup identifies an original native job using public completion
identifiers, its slot/plan/execution records, and original storage-write evidence.
Edited-media lookup follows its retained revision to that same original event.
These are resource-accounting hints, not permission to disclose creative data.
An ordinary result stays on its ordinary path. A sponsored or damaged sponsored
candidate cannot fall back to the ordinary R2 reader when a policy, schema,
receipt, or lineage proof is unavailable.

Every actual HTTP attempt receives a fresh immutable debit from the existing
read ledger. Its one-use context is bound to the exact request, environment,
database, authenticated actor, and requested lookup. Failed, canceled, stalled,
or abandoned reads retain their request and full byte reservation. Generation
expiry, campaign disabling, budget exhaustion, and historical generation
approval revocation do not themselves revoke current retained owner access.

After admission, the existing native Image witness and revision reader proves
current Document/Project ownership, source retention, private completion,
nonremoved/nondiscarded output, and the complete original/current edit chain.
The original native job Document/Project, public generation, provider/model,
approved dimensions, exact original storage-write key/hash, and current private
completion content reference must all match. The content reference is private
evidence read after admission; it is not falsely described as a public immutable
identifier. Owner namespace, caller tags, and R2 metadata alone never authorize
creative bytes.

The generated-image GET retains its existing current snapshot and historical
operation Check response. The direct-media route accepts only the exact original
or retained edited media from that same verified native chain. It uses the
existing bounded private reader to verify PNG bytes, hash, MIME, dimensions,
length, and ownership, then rechecks current native custody and the original
ticket immediately before returning a response. Reads do not execute Run,
recovery, reconciliation, settlement, or provider work.

## Limits and passive response streams

The attempt's single byte allowance covers bounded post-admission lookup work,
actual retained D1 result bytes, R2 bytes, and emitted response bytes. The native
DB adapter admits only the reader's finite query families and checks their
maximum response sizes before dispatch. It bounds malformed scalar cells and
epoch row cardinality in SQL, before native validation. No unknown query gets a
free allowance. Conservative query ceilings can reject a policy too small for
the native reader even when a particular retained object is small; this is not a
default operational policy.

The original monotonic deadline is never restarted. It covers database/R2 work,
blocked producers, and each response-stream pull; the existing database-clock
ticket predicate is included in final disclosure proof. Response bytes are
charged before exposure, emitted in bounded chunks, and zeroed on completion,
cancellation, or refused continuation. The existing final native custody check
precedes response creation; it does not promise atomic revocation of bytes
already delivered to a client.

## Explicit schema prerequisites and compatibility

`SPONSOR_NATIVE_IMAGE_READ_INDEXES` declares four exact inactive indexes:

- Public completed-output lookup by stream and output ID.
- Public completed-generation lookup by stream and generation ID.
- Retained edited-media lookup by owner and exact media URL.
- Immutable sponsor-consumption history by actor and original job.

A separately reviewed provisioning step must install/certify these definitions
and the existing read-policy/attempt schemas before sponsorship is offered.
Importing the native hooks installs none of them. The hook accepts no client
policy, caller-selected payer, configurable bypass, or permissive missing-schema
fallback. Trusted policy-approval/provisioning source work is independent from
actual policy activation and is not prohibited by this change.

An ordinary installation without the dormant sponsor schemas retains its existing
behavior. Once any sponsored consumption exists, its actor-history index is a
required classification prerequisite for every owner; a partially provisioned
installation can refuse ordinary requests rather than guessing that sponsor
history is absent. The indexes must precede sponsored admission. With those
prerequisites provisioned, exact ordinary
generated outputs, revisions, and uploaded media remain ordinary in mixed
histories. Legacy original PNGs can be identified through the public generation
index even when they have no native storage-write ledger. A legacy job and its
completion may both carry the caller-supplied Outputs surface label; exact
absence of sponsorship and native slot lineage keeps that job ordinary even
after its owner has other sponsored results. The label alone is not authority.
An unidentifiable
generated PNG belonging to an owner with sponsored history fails closed instead
of guessing that it is ordinary. Missing required lookup schema similarly
refuses ambiguous reads until configuration is repaired.

The fallback owner-job metadata probe materializes at most 50,001 indexed rows
before joining unique native records and refuses above the existing native
Image 50,000-history ceiling. It is not an unbounded `LIMIT 1` search. This can
refuse ambiguous classification for an exceptionally large legacy owner history;
it never truncates history and returns a guessed ordinary result.

## Remaining boundaries

This slice does not establish complete sponsored-read protection. Native Jobs
detail/inspection/lists, Outputs snapshots/assets/deliveries, Experience output
state, and events/hot-events are separate actual aliases requiring coordinated
integration. It also does not meter the Image editor's write/prepare commands or
change existing editing permissions. No public sponsored launch can claim all
read aliases are protected solely from these two native GET hooks.

Qualification uses actual native HTTP handlers, disposable SQLite, authored
Image revisions, and owned in-memory object bytes. Any native generation needed
to prepare a fixture uses the existing intercepted local provider responder.
No live provider journey, production data/media read, downloaded customer file,
real financial hold, migration, policy activation, or scheduled task is involved.
Read resource debits are not money, app-recorded generation cost, or provider
invoices.
