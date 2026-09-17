# Dormant native Audio publisher preview

This increment connects the already accepted Stable Audio MP3-to-WAV server adapter to the owner’s selected-output review. It does not enable share creation. The server’s creation gate remains false; browser fixtures explicitly supply a synthetic capability and never contact that server.

## Selection and private review

The Outputs host supplies a selection hint only for its already validated current original Audio result: revision zero, matching candidate input and media identity, `audio/mpeg`, score role and empty lyrics. The hint contains the fixed Stable Audio source and projection policies. The source MP3 URL and private input reference remain in the host’s private lifetime identity, outside the selected-share request. The host supplies no MP3 media reader. This hint grants no custody, recipe or publication authority; the existing server proves those independently.

The client validates the complete returned candidate, including distinct source and public hashes. Only the exact frozen preparation returned by that client can create its private prepared-file reader. The reader is bound to the active availability epoch, latest preparation, owner lease, candidate identity and original monotonic expiry. Refusing obsolete asynchronous work cannot retire a newer preparation. A commit attempt or revoke of that candidate retires its private preview permanently. Existing idempotent commit recovery retains the candidate digest; a Stable Audio retry is allowed only within that candidate’s original monotonic deadline.

The review component mounts the existing media leaf with this prepared reader. Opening, preparing and changing locale do not read a file. The existing explicit **Load file** control reads `/api/selected-output-shares/<candidateId>/file`; the candidate ID is an owner-authorized row selector, not a public capability. This path never substitutes the native MP3 reader or token reader. Verified file readiness is required before the separate publication action. This increment changes no product microcopy.

## Byte and lifetime boundaries

Prepared transport accepts only the fixed Stable Audio public WAV descriptor. The response must have the exact same-origin URL, status, MIME type, identity encoding and fixed WAV attachment filename. An absent Content-Length is allowed for this prepared route because the accepted Worker response can omit it; a present value must match exactly. The bounded full body must always match the declared size and SHA-256. Existing token reads still require Content-Length, and native-source transport rules are unchanged.

The prepared reader owns both the client lease and the rendered preview lease. Source changes, replacement, input changes, close, disconnect, expiry, commit and revoke prevent later access. Late responses are cancelled, digest capacity remains reserved until work settles, and disposal releases the retained Blob and listeners. The component retains its existing monotonic review timer; the client also enforces the original deadline across direct Stable Audio commit and retry calls.

## Focused evidence

- Host tests use the actual selected-share members with a synthetic post-native-read Audio result. They establish selection and lifetime behavior, not a new native custody proof. The pre-change positive failure is retained.
- Review tests use the actual component, client and byte reader with a finite media-leaf port; browser checks own actual media loading, gestures and readiness.
- Client and transport tests cover authentic preparation, distinct identities, stale epochs, replay and retirement, URL/header/body failures, clock rollback and resource cleanup. Independent probes preserve and repair the two stale-epoch failures.
- The browser fixture uses the accepted synthetic `tests/fixtures/audio-share-mp3/stereo-20.mp3`, SHA-256 `3cfa31bd59c5f8eb92b525b5f718d6e379824f8407b45ed5e793afe2fcf6ab8d`. One expressly authorized local deterministic decode produced the test-only WAV: 3,528,044 bytes, SHA-256 `eae13159a5b9273dee41f064db6cd44bb6e93ecf8138ebf424fbca2deb08b1a7`. Its provenance is recorded next to the fixture. The browser imports saved bytes, no codec, provider or native private media.

## Remaining dependencies

This is dormant publisher integration. It does not replace the separately held current-Document media eligibility, recipient media or automatic retention patches. The token reader’s strict Content-Length requirement remains a documented recipient-integration dependency for bounded Worker WAV delivery. Image entry/lifetime changes are excluded. No backend, model, runtime, schema, recipient, Document-artifacts or activation source is changed, and no real share or provider output is created. Local synthetic success does not establish publication or production enablement.
