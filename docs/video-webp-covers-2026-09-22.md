# Saved WebP video covers

Implemented locally for Forma and Still. Production publication was not requested.

## Behavior

- Live video completion starts asynchronous cover maintenance in an open browser. Still's full video view also starts it; older videos backfill as preview cards approach the viewport.
- Missing covers are captured from the actual retained MP4 at 10% of its duration, capped at one second. Capture preserves aspect ratio, never upscales, and limits the longest edge to 960 pixels.
- Canvas encodes WebP at quality 0.82. Both client and server validate a still WebP container and bounded dimensions/size. PNG fallback is rejected. Maximum cover size is 1 MB; capture accepts MP4s up to 64 MB.
- One serialized capture queue and in-flight deduplication avoid decoding a video separately for simultaneous Forma/Still cards. Transient failures retry up to three times. Cover failure does not change the generation's successful status or purchase another generation.
- Preview components render images or a play-icon placeholder. Saved-cover page loads request no video bytes. Opening the video still uses the existing player.
- Projects, document/library/delivery cards, canvas previews, Still Results, and existing document-share summaries use the shared cover component.

## Storage and authorization

Covers are separate R2 objects at `<original-key>.cover-<source-sha256>.webp`. Metadata records the original key/hash, owner, artifact, dimensions, cover hash, and `browser-frame-v1` capture method. The association is derived from the source URL rather than changing the artifact's canonical generation receipt or creative event history.

`GET /api/media/<encoded-source-key>?video-cover=webp` returns the current cover only after the original video's authorization and existence checks. On a missing cover, response headers identify the current source hash and whether the caller may create a cover. Authors can POST a bounded WebP to the same URL with that hash. Conditional writes retain the first cover when tabs race. Replacement videos select different covers, and source changes during upload reject the write.

Shared-project viewers cannot write covers. Revoked project access blocks reads. Existing document-share media routes can serve an already-saved cover after their normal token, scope, source-rights and current-video checks; anonymous viewers cannot create one. Raw cover object URLs are denied so they cannot bypass source checks. Organization erasure deletes every cover revision alongside its source; source deletion also immediately makes any remaining cover unreadable.

## Runtime limitation

The current Cloudflare Worker/R2 deployment has no configured server video decoder. Extraction therefore requires an open browser once; the WebP is subsequently stored and served by the server. This is not an unattended server extraction job or a bulk production backfill. Browsers without WebP encoding, unsupported codecs, or sources above the capture limit retain a placeholder. No media-processing service, provider generation, paid call, or production deployment was introduced.

The server validates framing, custody and authorization; it does not independently decode the image or prove the pixels were extracted from the source. Covers are display derivatives, not authoritative generation or review evidence.

## Verification

- Real MP4 in Chromium: two preview surfaces share one extraction/upload; retained output decodes as WebP; reload uses images only.
- Browser tests cover transient upload retry, unsupported WebP encoding, and existing landscape/portrait/square media geometry.
- Model/storage tests cover invalid/truncated/animated/oversized input, source revisions, duplicate writes, source disappearance and cover deletion.
- Routed Worker tests cover private ownership, direct-object denial, cross-origin writes, shared-project viewer restrictions, revocation, and document-share cover access/revocation.
- Existing Still result and retention checks, TypeScript, changed-file lint, localization audit and production build are included in the final check record.

Review screenshot: `/private/tmp/forma-webp-video-covers.png`.
