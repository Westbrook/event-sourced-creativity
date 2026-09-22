# Still output configuration baseline

Implementation, September 22, 2026. User subsequently authorized committing to main and publishing; the Progress Report retains the release receipt.

Choose output now has two steps: existing ranked type choices, then configuration for the selected type. Selecting a type, including through Other outputs or the command palette, never submits generation. The second step has a separate Generate action and Back to types; settings survive back/reselection within the same workflow and source revision. Closing or changing scope clears drafts. Pending requests remain locked to their original format and reconciliation behavior.

The configuration uses Still's En Reve controls and a responsive two-column layout, based on Forma's `.artifact-options`:

- Production mode for non-3D outputs; audience and tone for document artifacts.
- Slides: count, presentation style and source fidelity.
- Storyboard: manual frame count.
- Video: duration, orientation and original ambient audio.
- Audio: original/timed music, effects, narration/dialogue or produced scene; destination, duration, voices and instrumental preference as applicable.
- Scene: visual or audio.
- 3D: prompt, file format, detail, material and mesh quality; estimated cost reflects settings.
- Image: production mode; framing and direction retain the document context.

This is a baseline, not full Forma parity. Soundtrack selection, synchronized video-to-audio transfers, image reference pickers and advanced 3D controls remain outside this first pass. Existing server-side cost, source, permission and safety checks still apply. Settings changes clear the scene estimate and request acknowledgements. Separate Generate again recovery actions keep their established behavior.

Validation: focused workflow, payload, recovery, onboarding, route and client tests pass; all eight types checked at 1000px and 390px, including back/reselection, edited payloads, invalid counts and explicit submission with mocked requests. TypeScript and production build pass. Changed modules pass lint; the four existing empty catch findings in `app.ts` reproduce on unchanged HEAD. No paid providers were called.

Files: `src/still/app.ts`, `client.ts`, `generation-options.ts`, `generation-settings.ts`, `decisions.ts`, `onboarding.ts`, `style.css`. Tests: `tests/still-direct-create.test.mjs`, `tests/still-generation-options.test.mjs`, `tests/still-generation-toolbar.test.mjs`, `tests/browser/still-output-configuration.test.mjs`.
