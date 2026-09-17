# Selected-output sharing — disabled text projection

This increment prepares the public data contract for exact current Short story, Scene and Slides outputs. It does not issue shares, grant publishing authority, install tables, register routes, introduce a visible sharing action, read private media or call a provider. Whole-Document sharing remains unchanged.

The original mini-app requirement is still open: share only an explicitly selected output, safe title and necessary approved media; exclude private inputs and claim powers; enforce current publishing authority, expiry and revocation. Accepted whole-Document sharing and the completed E/F journeys do not satisfy that distinct requirement.

## Implemented contract

`src/model/selected-output-share.ts` captures a closed output selection: kind, Document ID, artifact ID, exact revision and SHA-256 of the complete retained native JSON. It accepts only the three text kinds and validates their existing native retained DTOs against that exact identity. It refuses Image, Storyboard, Audio, Video and 3D before inspecting the supplied native DTO.

A review candidate contains a separate private selection envelope and `publicOutput`. Only `publicOutput` is intended for eventual recipient delivery. It contains the output kind, reviewed share title, explicit expiry, literal audience content and Forma attribution. Native IDs, content hashes, owner or project identity, retained title, context blocks, source receipts, prompts, notes and private evidence fields are excluded. Slides uses explicit nested public types; even empty citation excerpts and producer fields are omitted. Existing public attribution policy remains in force.

The share title is separately reviewed, nonblank, at most 512 UTF-8 bytes, and excludes C0/C1 control characters. The functional default helper returns the output-kind label; no private Document/project title or filename is inherited. Title text is otherwise preserved. Requested expiry must be a canonical ISO timestamp in the future, no more than seven days from preparation, and no later than actual retained-content expiry. An invalid expiry is refused instead of being silently changed.

The candidate digest covers the complete canonical private review envelope and public payload. Explicit read-share approval has the separate purpose `selected-output-read-v1`, that exact candidate digest and literal `allowPublicRead: true`. This parser verifies data binding only. It does not authenticate a caller-supplied candidate, establish current custody, prove publishing rights or authorize a write.

The closed recipient DTO parser captures plain data descriptors, validates its finite shape and returns a deeply frozen copy. It uses a local placeholder identity only to reuse native structural validation; the placeholder is never a real source lookup, request identity or returned field. Getters, custom prototypes, unknown fields and unsupported shapes are refused. Narrative bodies and Slides display strings remain literal output data. No HTML/Markdown interpretation, linkification, media dependencies or resource fetching is introduced.

Field projection is not semantic redaction. Authored output text, public citation labels, slide theme and footer may themselves contain sensitive words. The creator must review the exact candidate before eventual publication. A safe share title alone does not establish that every output string is safe to publish.

## Remaining disabled lifecycle work

Coordinate a narrow native text custody proof extraction with the owner of `worker/retained-story-api.ts`. Reuse current canonical subject, platform/pilot/consent checks, bounded events, personal custody, actual retained bytes and final exact source witness. Do not duplicate a weaker reader or manufacture owner headers from a public token.

Then add detached prepare/commit/read/revoke functions and a candidate-only schema, qualified in synthetic SQLite. Source and current publishing authority must join the same conditional issuance transaction and be checked again with the exact token row before every public response. A successful owner DTO read alone is not a publication witness. No production initializer, route or visible sharing action should be added in that increment.

Keep the public read token separate from issuer, generation and claim powers. Reuse the established random-token/hash-only-storage, expiration and revocation rules in a distinct selected-output scope. Do not widen the existing whole-Document scope. Cap share lifetime at source retention; no retained-data copy may bypass source removal, redaction or expiry.

The initial lifecycle is personal, current canonical-principal custody only. Project/shared governance, sponsor preview policy, guests and claim flows fail closed unless their actual applicable authority is supported. Never infer public release approval from export/download acknowledgment or ordinary generation consent. A later edit must make the pinned current-revision share unavailable, rather than silently expose the new revision. Historical snapshot sharing requires separate qualification.

## Media and activation still open

The five media modes need their own exact output/revision identity, retained-byte proof, public field allowlist and necessary-dependency/metadata inspection. In particular, owner Storyboard/Video/Audio DTOs contain private production fields, and existing GLB preview qualification allows inert metadata such as `extras`; none is a public-release clearance. Do not sweep in sibling outputs, uploaded references, input audio, alternative meshes, archives, private scene compositions or saved-view receipts merely because they share a Document.

Public route/schema activation, the explicit review/publish/revoke user flow, actual public-share acceptance, all five media modes and any physical-device acceptance remain unfinished. No real share, new audience permission, source transfer, provider cost or financial hold was created by this increment.

## Verification boundary

Synthetic `tests/selected-output-share.test.mjs` covers all three positive projections, exact identity/digest binding, explicit approval shape, title/expiry/body bounds, getter/prototype/unknown-field refusal, private-field exclusion, input-mutation isolation, literal text and the five media refusals. These tests qualify the pure data contract. They do not qualify current publication authority, token issuance, public reads, revocation, expiry races, production integration or a rendered user interface.
