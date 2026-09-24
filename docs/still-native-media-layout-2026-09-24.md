# Native media and aligned page headings

The result image frame previously combined a 950px width cap with a 60dvh/720px
height cap. The page itself also stopped at 950px. Video stopped at 65dvh, and slide
images at 60dvh. These rules preserved aspect ratio but wasted available pixels.

The revised default prioritizes original dimensions, bounded only by the available
width. Large results scroll vertically; small originals are never enlarged. Images
use decoded dimensions when metadata is absent or stale. Known pending images
reserve their final dimensions; unknown pending images keep a provisional ratio.
Videos and slide/storyboard images also lose their arbitrary height caps. 3D has
no native pixel size, so its viewer uses the available width and viewport-relative
height, without the old 700px ceiling.

Phones and tablets through 1023px get full-bleed delivered media, including in
landscape. Text retains its gutter. The Developer panel remains outside the media
surface. Results-grid thumbnails and contextual reference images keep their
existing discovery/reading layouts; opening a result gives the full-size view.

Image dimensions move below the image. No extra info dialog is needed for this
single metadata value. The Image label remains in a shorter shared heading.
Document, ideas, results, document lists, writing, image, video, audio, 3D and slide
headings share their left edge and top rhythm. Titles use 32–48px type; the masthead
is 80px high on desktop and 64px on phones. Writing retains its narrower prose
measure, and forms retain their narrower control column.

## Validation

The synthetic browser fixture calls the actual page/artifact renderers without
provider requests. At 1712×895 (the supplied screenshot's equivalent CSS viewport),
the 1536×1024 image is 1536px wide and starts at y=196.8, versus the earlier frame's
approximately 805.5px width and y=300.5. At 390px and 320px the media has no gutter.
The whole image is available by scrolling; native size and fitting the entire
image above the fold cannot both be guaranteed for large or portrait originals.

Checks cover landscape, portrait, square and small images; missing/stale metadata;
source reuse; pending-to-loaded geometry; nine related page headings; Developer
panel layouts; and horizontal overflow across desktop, tablet, phone and short
landscape viewports. Existing natural-media tests check real decoded video ratios
and native width, and the sticky-dock suite checks final-content clearance.

Preview: `node tests/helpers/still-media-layout-server.mjs`, then open
<http://127.0.0.1:4196/tests/fixtures/still-media-layout.html?progress-report>.
This is a synthetic test view, excluded from the production application.
