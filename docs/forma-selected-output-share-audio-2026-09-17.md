# Selected Audio bytes: initial PCM WAV qualification

The new `selected-output-share-audio.ts` helper qualifies a conservative PCM WAV subset against an exact expected SHA-256, byte length and MIME. It is dormant pure code; no reader, route, schema, selected-share authority or UI calls it. Initial source is published canonical 384 (`6b533ee6130bb73dc691a5162b12828676fa4d8f`). Existing native private readers remain unchanged.

## Supported bytes

Only a RIFF/WAVE file containing exactly one `fmt ` chunk followed by exactly one `data` chunk qualifies. PCM format 1 supports the native inspector's 8/16/24/32-bit samples, 1–8 channels, 8,000–384,000 Hz sample clocks, consistent byte rate/block alignment, nonempty whole frames, and at most 24,000,000 bytes. The format body is exactly 16 bytes or 18 bytes with an explicitly zero extension length. Odd data padding must be zero. The existing `inspectOutputAsset` performs the actual native format/clock/duration/digest checks. Native original WAV fixtures and an actual `trimPcmWav` current edit are covered using synthetic non-silent PCM; no paid output was replayed.

All other chunks refuse, including LIST/INFO, BEXT, iXML, ID3, unknown chunks, comments, cues, sample labels and padding chunks. IEEE float, compressed/extensible WAV, RF64/RIFX, other audio families, extra chunks and arbitrary trailers do not qualify. This is a supported subset, not an assertion that every refused format or chunk is unsafe. Nothing is stripped, re-encoded, normalized or regenerated.

The input must be an ordinary nonshared `Uint8Array`. Intrinsic accessors capture its selected region before any await without using custom iterators or shadowed getters. Subclasses, proxies, detached/shared buffers, oversized inputs and open-ended/accessor expected facts refuse. The successful immutable result has an internal WeakMap-owned byte copy; forged/serialized facts cannot retrieve bytes, and each authorized local copy is independent.

## MP3 remains an implementation gap

MP3 is explicitly unqualified in this policy, including structurally valid metadata-free-looking native fixtures. Rejecting ID3/APE tags and checking frame boundaries is insufficient. Independent review produced three MPEG-1 Layer III frames with no reservoir or private header/side-info bits: 256 bits of the first granule's declared `part2_3_length` contain `PRIVATE_PROJECT_TITLE=PAYROLL_DEMO`, but zero-bit Huffman tables allow a decoder to ignore those bits. Both this file and its zeroed variant decoded with installed FFmpeg to the same 13,824 zero PCM bytes. The actual proposed allocation-only helper accepted the marker; that uncommitted implementation was removed before approval. A deterministic regression retains the exact marker fixture hash `482e1e384181e45fb26acca8063ecd8463012a7a3df80271b2f44926dd4ed581` and proves current refusal. The historical red and decoding evidence are preserved in the independent review packet.

This is not a defect in the existing private MP3 inspector, which promises frame/clock validation, not publication privacy. MP3 sharing needs a rigorous bounded entropy-consumption qualification or a separately reviewed decoding/normalization approach. No decoder/transcoder dependency was added, and no user decision has explicitly deferred this remaining coverage.

## Boundaries and remaining integration

Qualification proves a closed container layout and ownership of those exact bytes, not ownership of the recording, current Document/revision custody, ordinary personal publishing permission, consent, rights or recipient access. Expected facts must come from a separate current native custody proof. A future caller must separately bind the approved selection, current source, finite lifetime, watermark/attribution requirements, token and scoped recipient asset handle, including a final recheck before serving bytes. None of those authority or lifecycle paths is implemented by this helper.

PCM sample data remains unchanged, including any embedded watermark or deliberate audible content. The helper does not listen, identify speech, assess silence/loudness/quality, validate watermark presence, detect inaudible/covert data in samples, or make a semantic privacy judgment. Container qualification does not authorize sharing `inputRef`, lyrics, the full retained DTO, source references or companion files.

## Focused validation

The supplier tests cover native synthetic original/current PCM bytes, all supported bit depths and channel examples, exact facts, byte ownership across asynchronous mutation, subarrays and opaque result forgery, closed expected fields, metadata/unknown chunks accepted by the private inspector but refused for sharing, nonzero pad bytes, malformed format/data/framing, unsupported formats and the independently discovered MP3 payload regression. Independent adversarial review and its source hashes are recorded with the sealed release evidence. No provider, real private audio, financial action, share token, live audience change or generation journey was used.
