# Seedance 2.0 reference adapter adoption

Status: adopted as the default Fal video adapter on 2026-08-21.

## Contract

- Adapter: `fal-seedance-reference@2.0.0`
- Model: `bytedance/seedance-2.0/reference-to-video`
- Prompt profile: `positive-only`
- Reference syntax: `@Image1` through `@Image9`
- Reference limit: nine images, 30 MB per image
- Application resolutions: 480p and 720p
- Default document-render resolution: 720p
- Default audio policy: `generate_audio=false`; video is silent unless the creator explicitly selects original environmental ambience
- Optional audio policy: newly generated, non-musical, non-melodic environmental effects only; generated audio remains subject to downstream copyright and safety review
- Prompt compiler: `video-production-director@1.0.0`, with a 10,000-character operating target and a 20,000-character provider hard limit
- Paid adoption control resolution: 480p
- Paid adoption control audio: `generate_audio=false`
- Application durations: every whole second from 4 through 15 seconds
- Provider transport: byte-verified Fal asset reuse when possible; otherwise short-lived Fal storage upload
- Durable evidence: submitted prompt, versioned adaptation sections, original/effective audio policy, ordered shot timing, scoped reference bindings, provider request and queue URLs, ordered reference hashes, transport, pixel-submission status, stages, latency, and estimated cost

The same endpoint is the default for prompt-only video. Omitting `image_urls` preserves the prompt-only path; adding approved pixel references activates the reference-to-video path.

## Adoption evidence

The paid control used one authorized generated PNG containing an adult editorial subject, a four-second 480p render, one pixel reference, a pseudonymous `end_user_id`, the positive-only prompt profile, and **`generate_audio=false`**. Fal accepted the input, completed the queue, returned a valid silent MP4, and the application retained the full prepared request and result receipt. Measured provider latency was about 156 seconds and the recorded estimate was $0.53802. This qualification does not assert that 15-second renders or audio-enabled renders have been independently qualified.

The earlier Seedance 2.5 control reached late partner validation without producing a usable video. Its failure remains retained evidence; it was not deleted or relabeled as a successful run.

## Safety and operational boundaries

Adoption does not bypass provider policy. Default production requests are picture-only: dramatic rhythm is expressed through performance, camera movement, editing cadence, weather, physical action, and changing light. Original ambient audio requires an explicit per-render opt-in and cannot request a song, orchestral score, recognizable melody, spoken voice, imitation, or recording. Even allowed environmental audio can be rejected during late provider output review. Existing copyrighted-audio partner rejections are terminal provider decisions, not recoverable queue outages; creators must change the request instead of resubmitting the same failed provider job.

The shared mandatory-first adapter compiler preserves locked requirements, affirmed and forbidden standing preferences, isolated Combined Context groups, every ordered storyboard beat, planner continuity notes, and the exact selected `@ImageN` reference modes before spending remaining budget on optional visual direction. Description-only storyboard frames remain authorial context without uploading their pixels. Invalid dimensions, duration, audio policy, pixel authority, reference provenance, MIME types, sizes, and ordering fail locally before paid planning or provider submission.

The adapter avoids speculative identity-policy language but never suppresses Fal safety receipts. Generated storyboard provenance is stated only when supported by source metadata; a character's age is stated only when authored rather than invented. Ordinary uploaded references are described only as authorized project references. References still require rights evidence, and the UI blocks more than nine pixel-backed images before a paid request can be submitted. Reference uploads are bounded to three concurrent transfers while durable progress updates remain serialized.

Existing queued jobs always resume with their immutable provider model, prompt, audio setting, duration, resolution, reference receipts, and request URL, even if the original local reference asset later disappears. Ambiguous paid Fal submission failures are never automatically posted twice. Failed planner usage is settled once by planner response ID, while possible provider charges remain explicitly unconfirmed until billing evidence exists. Changing the default never resubmits or migrates an already-paid job.
