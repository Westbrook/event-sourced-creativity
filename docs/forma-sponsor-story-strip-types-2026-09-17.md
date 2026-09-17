# Story initial intake: strip-only TypeScript compatibility

This is a narrow successor to the qualified local Story initial-intake supplier
`d710838f1b0c400b3726fd905be419dc193e56a7`. It does not change the five shared
intake, read, storage or event-append seams from that supplier.

The repository test command uses Node's `--experimental-strip-types` mode.
The module-private `Lifetime` constructor in
`worker/experience-sponsor-story-intake-reads.ts` used four parameter
properties, which require TypeScript transformation. The now-shared
`private-content-storage.ts` import reached that constructor and failed with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` before a native fixture could execute.

The constructor now uses four explicit typed field declarations and ordinary
assignments. The readonly types, mutable deadline, field order, initial values,
methods and callers are preserved. A non-executing Node transformation of the
complete original and successor modules emitted byte-identical JavaScript
(SHA-256 `ddae07b28eb3d5167823fb679f334e598a38d0a7495b922a1ccb93ede8e44608`).
Transformation is only a parity diagnostic; acceptance uses strip-only mode.

Validation on the successor source:

- The same genuine `private-content-storage.ts` import failed before the
  repair and passed afterward using only `--experimental-strip-types` and
  the repository's normal source-resolution helper.
- Five existing native controls passed under strip-only mode: the strict
  nine-event prepare/commit/original reopen, final response lifetime check,
  abort across an awaited read, an already aborted request and cancellation
  of a nonsettling read. The positive control covered 95 strict SQL shapes,
  at most 57 bindings, nine events and one original allocation. Fourteen
  captured source/test hashes were unchanged during the run; network attempts
  were zero.
- The seven new Story initial-intake modules were inspected for additional
  non-erasable TypeScript syntax. No other occurrence was found.
- Integrated TypeScript and scoped lint passed. An independent bounded
  review accepted the exact constructor diff and emitted JavaScript parity.

The initial focused run passed the four lifetime controls, while the strict
positive selected the system Python and stopped at the local Xcode license
gate. That environment failure is retained. Setting the strict helper's
documented `FORMA_SQLITE_PYTHON` input to the bundled Python resolved it;
no product or helper change was needed. An intermediate `declare`-field
candidate is also preserved in the evidence: it omitted the original emitted
field slots and was replaced before final qualification.

Evidence is in the existing independent report workspace under
`story-d2-strip-types-successor-20260917`. The original 51 native tests and
actual D1 qualification remain historical evidence for the parent supplier;
they were not repeated or attributed to this syntax-only successor. This
slice adds no HTTP route, policy activation, provider call, real financial
change or publication. Guest's composed stage-history smoke remains owned by
its integration task.
