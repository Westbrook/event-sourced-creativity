# Dormant native Stable Audio MP3 sharing adapter

This adapter supports the current retained output of the exact
`forma.audio.instrumental-20@1` recipe using the original paid Stable Audio
invocation. It produces a deterministic, metadata-free PCM16 WAV for selected
output sharing. It does not activate creation, publish a share, read a historical
fallback, or authorize another provider call. The production creation gate and
the prepared-file route remain closed. The publisher and recipient interfaces
are outside this change.

## Two identities and two independent capabilities

The derivative selection has exactly nine fields: `output`, `documentId`,
`artifactId`, `revision`, `contentSha256`, `mediaSha256`, `policy`, `sourceProfile`,
and `projectionPolicy`. Its literals are:

- source profile: `forma.audio.instrumental-20.mp3@1`;
- public qualification policy: `selected-output-share-audio-v1`;
- projection policy: `selected-output-share-stable-mp3-pcm16-v1`.

The native selection's media hash identifies the retained MP3. The candidate's
public media hash identifies the derived WAV. They are separate fields and are
not substituted for one another. Existing exact-byte WAV, MP4 and GLB paths keep
their equality requirement and cannot attach an MP3 projection.

Native custody is created by the existing trusted custody factory, including the
current canonical Document selection and retained object. A second, independent
opaque capability proves the actual recipe, normal Outputs input grammar,
original paid invocation, selected completion and current terms. The existing
source-proof implementation is unchanged. Neither capability can be supplied as
JSON, and the recipe proof does not replace custody. The combined authority
keeps all four original authority proof leaves and all three recipe leaves in a
balanced final SQL statement.

Prepare, commit, private candidate preview and public reads requalify current
custody and provider authority. A changed input, job, paid call, source expiry,
job expiry, current terms or selected revision can therefore refuse the final
operation. A current authored WAV does not fall back to an earlier MP3.

## Trusted projection and bounded ownership

The existing pinned mpg123 static Worker WASM supplies the decoder. This change
does not alter its numerical policy, gapless rules, finite ABI bounds, source,
binary, licences or rebuild materials. There is no client PCM assertion,
dynamic-compile fallback or universal MP3 parser. Qualification requires exactly
20 seconds of samples, one or two channels, and a supported 32, 44.1 or 48 kHz
sample rate. The public WAV has a fixed 44-byte header and contains PCM audio;
ignored MP3 payload and metadata are not copied into it. This does not claim that
the decoder consumes every input byte, nor bit-identical PCM across unrelated
decoders.

A single per-isolate lease spans native retrieval, decoding, qualification,
final SQL, and complete response consumption. Admission is immediate, with no
waiting queue. The same 30-second wall-clock and monotonic deadline starts at
the lifecycle entry point, including command parsing and preselection database
lookups, and is inherited by the file body. The deadline does not preempt a
synchronous WASM instruction; finite ABI and chunk bounds are separate controls.

Tracked asynchronous work keeps the lease until it settles and its returned
resource is adopted or disposed. Aborting an outward operation does not reopen
the decoder while a digest, decoder yield or cleanup remains pending. Failed
cleanup quarantines admission. Source buffers are retired at their allocation
site. The final response copy is owned before the last SQL proof. After that
proof, the qualified projection is retired and the response emits independent
chunks of at most 65,536 bytes with a zero high-water mark. EOF, cancellation or
the inherited deadline retires the producer copy; delivered chunks are not
zeroed underneath the consumer.

For source cap S = 1,000,000 bytes, public cap W = 3,840,044 bytes and fixed
decoder memory M = 16,973,824 bytes, the bounded simultaneous owned media payload
plus WASM allocation is M + 2S + 2W = 26,653,912 bytes. After projection retirement,
the corresponding response bound is M + W + 65,536 = 20,879,404 bytes. These are
explicit owned-buffer accounting bounds, not process RSS or total runtime
memory. They exclude WebCrypto snapshots, runtime/R2 queues and backing buffers,
consumer-retained chunks, JavaScript/SQL state and garbage-collection delay.

## Prepared-file purpose boundary

The private prepared-file endpoint authenticates the current owner, selects
that owner's unissued, unrevoked candidate by its candidate ID, and recomputes
the exact derivative. Candidate IDs are selectors, not bearer credentials. Requests must
be GET and strict same-origin; an Origin header, when present, must match. The
last SQL proof includes the complete source/authority and unchanged candidate
row, plus unissued and current-expiry conditions. The handler returns only the
qualified WAV, with private/no-store and attachment headers. It does not return
the native MP3, accept a caller-selected asset URL, or expand the existing
current-source reader's purpose. Production dispatch refuses it while creation
is disabled.

## Verification and boundaries

Focused model, custody, authority, resource and lifecycle tests use synthetic
canonical data and the existing checked-in 20-second stereo MP3 fixture. The
source SHA-256 is
`3cfa31bd59c5f8eb92b525b5f718d6e379824f8407b45ed5e793afe2fcf6ab8d`;
the expected public WAV SHA-256 is
`eae13159a5b9273dee41f064db6cd44bb6e93ecf8138ebf424fbca2deb08b1a7`.
The test-only built Worker entry uses actual local D1 and R2, imports the genuine
dormant lifecycle, and keeps the production creation dispatcher closed. It must
not be deployed as the application. Its source and built artifacts are pinned
separately from the application build.

Timer-control tests deliberately shorten a 30-second timer; they verify wiring
and late-work refusal, not a physical 30-second latency measurement. SQL tests
compile the full emitted proof statements under the target D1 limits and use
the same single synthetic donor for ordinary/pilot and original/text-edit
variants. Preserved historical failures distinguish test-harness repairs from
product fixes. Detailed run counts, source/artifact hashes, independent reviews
and historical failures belong to the accompanying sealed evidence packet.

No real asset was read or changed for this adapter qualification. No provider
request, upload, financial action, wider sharing, live activation or publication
was performed. Accepted earlier decoder and live-provider evidence is reused
within its original limits.
