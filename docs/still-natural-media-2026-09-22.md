# Natural media proportions in Still

Delivered images and videos now size their element boxes to their intrinsic aspect
ratios. Images in result grids and Show all lists no longer use forced 4:3 or square
boxes. Reference images retain their natural ratio within responsive size limits.
Videos use automatic width and height with viewport limits, avoiding the former
full-width box combined with a capped height.

Slide and storyboard images appear as full, unfaded media in the content flow,
followed by their text, instead of cropped translucent backgrounds. Image-stage
frames retain their existing responsive reservations, and loaded pixels follow the
corrected frame ratio without a competing image height cap.

Decoded dimensions remain authoritative when metadata changes during a rerender.
Video intrinsic-size changes are also captured. Source changes still recreate the
media element so dimensions from an earlier source cannot leak into its replacement.

Validation:

- Chromium checked eight delivery surfaces across 17 combinations of viewport,
  source shape, and complete/missing/stale metadata: full images, previews, grid
  thumbnails, list thumbnails, context references, reference studies, slide images,
  and video. Each loaded element's box matched the decoded source ratio, without
  cropping or fitted bars; the image frame matched its image.
- Video tests encoded actual landscape, portrait, and square WebM media in the
  browser and used decoded `videoWidth`/`videoHeight`, not mocked dimensions.
- Existing pending/completed image geometry checks and four media unit tests pass.
- TypeScript, changed-file ESLint, whitespace checks, and production build pass.

Publication was subsequently requested with the tooltip and document-scrolling fixes.
No live provider generation was used for verification.
