# Disabled canonical Image entry and native confirmation

This increment is being qualified in an isolated checkout based on
`72f39996f4905b14f4f803517e367f443b88ee51`. The baseline already contains the
reviewed actual-POST intake transport (`595412bcce05c1374cefebe189b0276ddeacfb16`).
It adds client transport and deliberate native output confirmation for the
canonical-principal, text-only Image path. No real campaign, payer terms,
audience, schema, provider call, or financial reservation is activated.

## Authority and terms

The original three-operation read policy remains version 1, with its original
parser, digest, and schema contract. Version 2 explicitly adds
`image-output-confirmation`. It requires a separately reviewed direct-payer
approval and a freshly provisioned V2 attempt schema. Exporting that schema
does not install or upgrade it. An installed immutable V1 policy/table is not
silently upgraded. Request and full-byte charges remain aggregated by campaign
and actor across operations and policy digests; expiry and unsuccessful work
do not refund a charge.

Confirmation GET and POST use a separate opaque capability bound to the actual
Request, environment, database, canonical actor, original marked draft and its
native intake receipt. The new operation is charged before private draft or
native creative history reads. The same byte allowance and deadline cover the
whole operation, including native replay reads and final disclosure. Native
pages must be returned intact or refused; an exhausted allowance cannot turn a
partial event history into an apparently complete history.

The fixed native projection reads the actor's entire personal creative event
stream, including private event payloads from other Documents and operations
such as grant or job events. The allowance covers this actual footprint. It is
not a caller-selected history API or a claim that only current-Document bytes
cross the database boundary.

The unchanged native confirmation command also checks indexed existing
commitments. Those bounded control reads include original slot/grant/job
identities and an active/pending predicate. There is no separate grant, job or
provider table-body endpoint and no generation or financial mutation.

## Native composition

The client preserves the server-marked plan and original intake receipt. It
uses an explicitly injected finite transport; ordinary default transports are
unchanged. Bootstrap and reopening do not save an output requirement, confirm
an output plan, preflight, authorize, or run generation.

The deliberate confirmation POST carries exactly the original draft hash and
`explicitRequirementsConfirmation: true`. The server uses the actual native
save and confirm commands, with the same deterministic requirement, deliverable,
variant, and stage identities as the canonical Image host. It does not invoke
the ordinary output prepare operation, which also performs preflight.

Native save and confirmation are separate transactions. Each keeps the native
principal, source, retained-body, exact-head and command guards, plus the full
original intake and read-attempt proof in that transaction. After its own
durable stage, the composer reloads exact native evidence without replacing the
attempt or extending its deadline. An interrupted operation may leave one
valid saved requirement; a later charged request recovers that same stage key.
There is no compensating delete or invented successor receipt.

Completed original confirmation can be read or replayed after generation
eligibility expires, subject to its separately approved read policy and current
native custody. Missing stages require current campaign approval and the
current registered Image release. Confirmation does not mint a generation
grant or an execution authority.

## Inactive integration contract

The new entry factory accepts an explicit closed V2 configuration for Image
intake and confirmation, including `generation: "disabled"`. Omitted or disabled
configuration is inert. The factory composes the existing reviewed intake
routes and a separate `output-confirmation` GET/POST endpoint. A configuration
object supplies no payer approval or schema. Existing ordinary and guest paths
retain their own defaults and guards.

Worker index dispatch is conditional on the explicit configuration. Its handled
responses do not trigger an unrelated detached private-content retention sweep;
unconfigured and ordinary paths retain their previous behavior. No configuration
is supplied by this increment. Entry/host UI integration and Run composition
remain unqualified at this checkpoint. Run must retain its own actual request and
native driver semantics; its reads cannot borrow or relabel a confirmation
allowance. Launch requires explicit real terms and provisioning, separately
from completing dormant source wiring.

## Qualification

The V2 policy lane passes 36 selected tests (14 new and 22 V1 compatibility),
with source review and scoped lint. Its fourth-operation accounting fixtures
are clearly distinguished from actual confirmation capability evidence.

The mandatory client transport passes 17 cases, including actual bootstrap,
runtime review, native intake commit and retained reopening. The separate
confirmation controller passes 14 unit cases. Eighteen native confirmation cases
cover exact save/confirm and reopening, partial-save recovery, lost responses,
source changes, cancellation, byte/deadline refusal and approval revocation.
These include two boundary cases that erase an original intake private body or remap a
real intake receipt immediately before the first native private history SELECT.
Both now refuse that SELECT before any private body crosses into the Worker.

Two integration cases join the actual client controller to the real server
composer, including the complete Worker fetch wrapper. They start with empty
creative state and preserve the original plan and native receipts. The enabled
synthetic route schedules no detached work and performs no paid work or network
request. Strict SQLite qualification of the repaired native positive path compiles
135 distinct statements from 341 executed queries with expression-depth 100,
function-argument 32, parameter 100 and SQL-byte 100,000 limits; observed maxima
are 77 parameters and 93,697 SQL bytes. This models the limits in disposable
SQLite; separate local workerd/D1 evidence is recorded below.

Independent source review identified a real initial privacy-boundary defect:
after erasure of an original intake private body, seven other native private
bodies crossed into the Worker before the later final refusal. The repair pins
the original receipt's complete support and exact ordered event/mapping/private
rows once, excluding only the mutable current head, and requires that full
conjunction before every native private SELECT. Refresh may replace only the
head-sensitive witness; it cannot adopt changed original rows or discard the
supporting authority. Writes and final disclosure retain the full current-head
proof. The original failing query, returned rows, source snapshots, first green
and remapped-receipt regression remain preserved.

The ordinary fresh-intake extraction loads a reviewed finite closure of 110
production modules plus its fixture. Its four tests preserve the exact loader,
network and module-set guards. The ordinary private-storage closure remains
76 production modules plus its fixture, unchanged and not rerun. Moving schema
readiness inheritance into the upper confirmation composer preserves the proper
dependency boundary; it neither installs a schema nor marks an unready database
as ready.

Freeze 1's independent local workerd/D1 seven-call lifecycle passed on its saved
source version but did not close the later privacy finding. Freeze 2 separately passes that seven-call local D1 lifecycle and a targeted
real Worker POST erasure check. The latter returns no private rows, responds
409, and performs no save/confirm write after the injected erasure. The local backend tests exercise the real
Worker fetch wrapper and injected client runtime/controller from empty creative
state through bootstrap, intake, native save/confirm, reopen and replay. They are
local synthetic qualification, not deployed Worker traffic or live payer terms.

Historical import, fixture, transport cleanup, and privacy failures are retained.
The final manifest pins the exact source version for each qualification. No
remote provider, media write, financial hold, schema installation, supplied
configuration, or public UI entry activation is part of this increment.

The selected case inventory is 91 distinct cases: 36 policy/approval, 17 intake
transport, 14 confirmation controller, 18 native confirmation, two client/Worker
integrations, and four ordinary fresh-intake cases. Counts do not add repeated
qualification runs or the separate local D1 lifecycle as new unit cases. Final
typecheck, scoped lint and the standard local build pass. Forty protected native,
financial, UI and fixture paths remain byte-identical to the qualification base.
