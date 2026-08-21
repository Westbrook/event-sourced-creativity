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
- Paid adoption control resolution: 480p
- Application durations: 4, 8, and 10 seconds
- Provider transport: byte-verified Fal asset reuse when possible; otherwise short-lived Fal storage upload
- Durable evidence: submitted prompt, adapter version, provider request and queue URLs, ordered reference hashes, transport, pixel-submission status, stages, latency, and estimated cost

The same endpoint is the default for prompt-only video. Omitting `image_urls` preserves the prompt-only path; adding approved pixel references activates the reference-to-video path.

## Adoption evidence

The paid control used one authorized generated PNG containing an adult editorial subject, a four-second 480p render, one pixel reference, a pseudonymous `end_user_id`, and the positive-only prompt profile. Fal accepted the input, completed the queue, returned a valid MP4, and the application retained the full prepared request and result receipt. Measured provider latency was about 156 seconds and the recorded estimate was $0.53802.

The earlier Seedance 2.5 control reached late partner validation without producing a usable video. Its failure remains retained evidence; it was not deleted or relabeled as a successful run.

## Safety and operational boundaries

Adoption does not bypass provider policy. The adapter avoids speculative identity-policy language but never suppresses Fal safety receipts. Generated storyboard provenance is stated only when supported by source metadata; ordinary uploaded references are described only as authorized project references. References still require rights evidence, and the UI blocks more than nine pixel-backed images before a paid request can be submitted.

Existing queued jobs always resume with their retained provider model and request URL. Changing the default never resubmits or migrates an already-paid job.
