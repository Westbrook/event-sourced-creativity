# Document-derived artifacts

The application can project one durable creative document into six presentation forms without changing the document itself:

- still image (the existing draft, full, and prompt-fan paths)
- short story
- film or television scene
- informative presentation slides
- storyboard / previz frames
- video

The document event stream remains the source of truth. Each renderer receives the same active blocks, relationships, targets, constraints, and reference decisions used by image generation. A completed result is an attached artifact, not a replacement document and not another block.

## Product contract

`forma-document-artifacts` is available from every document view and from document items on a project Canvas. “Create…” opens one normalized format picker. Audience and tone are optional. Slides and storyboards expose bounded item counts. Storyboard and video require an explicit paid-work acknowledgement before a job can be queued.

Every result is visible from every view of the source document. Text and scene plans have a focused reader. Presentation plans have both a visual deck and a textual equivalent: the provider returns a shared 16:9 theme, accessible color tokens, layout names, concise copy, speaker notes, and semantic visual primitives such as metrics, bars, timelines, diagrams, and color fields. A reusable Lit component renders that data with HTML and CSS in document galleries, focused viewers, and Canvas cards. Slides are not flattened into pixel images, so they remain responsive, selectable, accessible, and inexpensive to revise; complete presentations can also be downloaded as PDF. Storyboards retain each completed frame and use the same local, no-provider focal-point analysis as other cover-cropped images. Videos use native playback and private media delivery. Retained text plans can be exported as Markdown; media can be downloaded directly.

The Canvas uses a two-step workflow: a document is first created from selected context without provider cost, then the user explicitly chooses an image or document-artifact renderer.

## Durable event and job model

The render lifecycle uses:

- `DocumentRenderRequested`
- `DocumentRenderCompleted`
- `DocumentRenderFailed`
- `DocumentArtifactViewed`
- `DocumentArtifactExported`
- `GenerationUsageRecorded`

Jobs use `render_document`. They are idempotent by document revision, artifact kind, options, and request key. Planning output, completed storyboard frames, budget reservation, and video-provider job IDs are checkpointed in the server job. Refreshing or closing the page does not cancel work. A retry resumes safe checkpoints instead of paying for completed frames again. Stop requests release unspent reservation unless the job has entered its final commit.

## Provider adapters

Structured text and visual-slide plans use the configured OpenAI Responses model. The strict slide schema requires presentation tokens and per-slide visual data, while the retained Markdown stays suitable for copying and export. Older textual slide artifacts receive a deterministic visual fallback at render time. Storyboards pass each planned shot through the existing low-quality image adapter and private-media store. Video uses the configured provider adapter and stores the finished MP4 privately before emitting completion.

Current environment settings:

```dotenv
FAL_VIDEO_MODEL=bytedance/seedance-2.0/reference-to-video
FAL_REFERENCE_VIDEO_MODEL=bytedance/seedance-2.0/reference-to-video
FORMA_VIDEO_PROVIDER=fal
FAL_KEY=
```

Video rendering defaults to Fal's queued `bytedance/seedance-2.0/reference-to-video` endpoint for prompt-only and pixel-backed work. The adopted adapter accepts up to nine ordered JPEG, PNG, or WebP references of up to 30 MB each, uses `@ImageN` prompt bindings, and supports every whole-second duration from 4 through 15 seconds, 480p or 720p resolution, and 16:9 landscape or 9:16 portrait output. Video is **silent by default** (`generate_audio=false`): dramatic energy is communicated visually rather than by inventing an unrequested soundtrack. A creator may explicitly opt in to original, non-musical environmental ambience for one render; generated audio still carries residual downstream copyright-review risk, and songs, musical scores, recognizable melodies, imitated voices, and dialogue are rejected before paid work. Each new render dialog resets to silent.

The application exposes the complete 4–15-second duration range in both orientations and defaults document renders to 720p. Its actual paid adoption control qualified a four-second, 480p, **silent** render; it did not qualify arbitrary 15-second or audio-enabled output. Paid confirmation displays the configured adopted model's published estimate without treating it as a final billing receipt. It checkpoints the Fal request ID, immutable provider inputs, audio policy, ordered reference bindings, and exact adaptation receipt; polls provider status with logs; resumes the same request after a page refresh without staging local references again; saves returned media privately; and attempts provider cancellation when the durable job is stopped. Terminal provider safety rejections cannot be recovered as though they were temporary network failures. The credential remains server-side in `FAL_KEY`; it is never sent to the browser.

The adopted adapter records the current provider rate by resolution, its `positive-only` reference prompt profile, the adapter contract and prompt-compiler versions, exact ordered reference hashes, reference modes, pixel transport, audio policy, shot timing, compilation budget, and production continuity in every retained receipt. A provider-independent mandatory-first compiler is also reused by the Ideogram image adapter: locked authorial requirements, actual `affirm`/`forbid` standing preferences, exact structured palette values, and target-isolated Combined Context members survive before optional detail is compacted. Video operates against a 10,000-character prompt target and validates the provider's 20,000-character hard limit, selected reference authority, and complete request contract before a paid request is submitted.

## Operational and replay coverage

Operations analytics reports document artifacts separately from still-image generations: completion and failure counts, format mix, review and export actions, median and p90 render time, and provider cost receipts.

Replay contract v22 rehearses all five additional formats, structured visual slide receipts, review, export, paid confirmation, Canvas-originated rendering, durable job vocabulary, complete storyboard receipts, Fal video-provider receipts, and a retained failure. Coverage now fails if a slide deck lacks a complete theme or CSS-renderable visual data for every slide. The deterministic laboratory does not invoke providers. Actual-data mocks continue to require explicit user approval for provider-backed images; paid video fixtures must be separately costed and approved before they can call Fal.
