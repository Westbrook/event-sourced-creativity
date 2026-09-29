# Consistent Still Results thumbnails

Results now reserve a 4:3 thumbnail for every output, including generated images,
saved video covers, text/other formats, and queued or failed generation placeholders.
The same ratio applies in the desktop grid, mobile rows, and Show all lists. At the
existing 1050px page width, 4:3 provides a useful vertical preview area for mixed
formats without making the three-column grid excessively tall.

Images use `object-fit: cover` and Forma's existing focal-point positioning. Saved
image focal points survive the Results projection; images without saved points and
asynchronously loaded video covers use the shared local, cached image analysis.
Unreadable pixels retain the centered fallback. Metadata updates on already loaded
images reapply positioning. Source media and full-size delivery views retain their
natural proportions.

Verification: 40 focused unit/browser checks passed, including real MP4-to-WebP
cover loading, cached cover reloads, saved focal-point updates, desktop/mobile/list
geometry, mixed placeholders, and natural geometry outside Results. TypeScript,
focused ESLint, production build, and whitespace checks passed. The release uses
the existing guarded migration packager and preserves the current site audience.
