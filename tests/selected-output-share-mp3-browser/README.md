# Synthetic MP3 publisher browser checks

This static Vite fixture runs the actual publisher component, publisher client,
prepared-file reader and media leaf. Its local in-memory transport advertises
synthetic availability; the application gate remains closed. No Worker,
database, provider, real share, retained source MP3 or browser decoder runs.
The browser checks do not prove server custody, provider accounting or physical
device accessibility. Reuse the accepted server/decoder evidence for those
separate claims.

`stereo-20-prepared.wav` is the one expressly authorized local test preparation
of the existing committed `tests/fixtures/audio-share-mp3/stereo-20.mp3`, using
the existing pinned static-WASM projector. Its provenance is recorded beside
the file. The WAV is 3,528,044 bytes with SHA-256
`eae13159a5b9273dee41f064db6cd44bb6e93ecf8138ebf424fbca2deb08b1a7`.
The Vite-only virtual module embeds this saved test data. Neither a decoder
nor an MP3 is sent to the browser. Do not regenerate it for routine runs.

After source review/authorization, run from the repository root:

```sh
FORMA_MP3_PUBLISHER_BROWSER_APPROVED=1 node tests/selected-output-share-mp3-browser/run.mjs /absolute/fresh/evidence-directory
```

An optional list of exact case names after the evidence directory runs only
those cases. Every run requires a fresh directory, records source hashes
before and after, retains failures and screenshots, and verifies the source
did not change. The server listens only on `127.0.0.1:5197`; the fixture reuses
the reviewed static Vite tooling boundary without Cloudflare/Sites plugins.

Eight cases cover complete-hash readiness and explicit publication, absent
transport length, wrong bytes, and late source/candidate/expiry/close/disconnect
cleanup. Application fetch has no network fallback. The runner blocks network
API, MP3, WASM and external requests; receipts independently count forbidden
application fetches, preview URLs, cancellations and native play events. Only
the exact prepared-candidate path may provide preview bytes in this synthetic
transport; server authorization is covered by the existing adapter evidence.
Held response and held tail are distinct: a held response may already own a
complete synthetic stream, while a held tail delivers only 32,768 bytes until
explicit release. Neither can make the publisher ready prematurely.

Source and browser evidence are kept separately from the project report. The
parent coordinator owns report updates, release review and publication.
