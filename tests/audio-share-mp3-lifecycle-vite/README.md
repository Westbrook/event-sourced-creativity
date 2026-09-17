# Synthetic native MP3 sharing qualification

This entry is test-only. `/__synthetic__/prepare`, `/__synthetic__/commit` and
`/__synthetic__/prepared/:candidateId` invoke the genuine dormant lifecycle
implementations. Other requests use the production selected-share dispatcher,
including its closed creation boundary. No production route or capability is
replaced, and this entry must never be published as the application.

The caller supplies one canonical synthetic SQLite snapshot and the checked-in
`tests/fixtures/audio-share-mp3/stereo-20.mp3` donor. The helper seeds one actual
local D1 database and one actual local R2 bucket. Its Worker has no provider
credentials, application asset binding or outbound network access. The source
MP3 SHA-256 is `3cfa31bd59c5f8eb92b525b5f718d6e379824f8407b45ed5e793afe2fcf6ab8d`;
the expected public PCM16 WAV SHA-256 is
`eae13159a5b9273dee41f064db6cd44bb6e93ecf8138ebf424fbca2deb08b1a7`.

`tests/selected-output-share-stable-mp3-workerd.test.mjs` builds this entry with
Vite/Cloudflare, verifies the unchanged static Worker WASM and its absence from
the inert client, then exercises the complete synthetic lifecycle. The harness
compares exact canonical schema/data and retained object bytes/metadata/version
before and after the flow. The sharing table is audited by the acceptance test.
Final-state equality alone does not establish absence of transient writes or
count native media reads.

Workerd removes the declared `Content-Length` from the bounded streaming file
response. The real transport test accepts an absent or exact header and always
verifies the complete 3,528,044-byte WAV and its fixed digest; it rejects partial
range semantics. Supplementary Node tests assert the exact declared header.

Supplementary Node tests run unchanged production code using the exact pinned
WASM module and a guarded canonical SQLite fixture. They observe actual SQL,
restrict runtime writes to the dedicated sharing table, inject late mutations,
and compile every emitted statement under all four D1 limits. Tests that shorten
a 30-second timer to 20 milliseconds establish timer wiring and cancellation;
they do not claim a physical 30-second latency measurement.

Set `FORMA_MP3_LIFECYCLE_EVIDENCE_DIR` to a **nonexistent absolute directory with
an existing parent** to retain build artifacts and source pins. Qualification
inside that directory reports the build only; runtime acceptance is recorded
separately by the test result. The helper refuses to merge into an old directory.
Neither test path establishes a live provider journey, publication, invoice,
physical-device accessibility or production activation.
