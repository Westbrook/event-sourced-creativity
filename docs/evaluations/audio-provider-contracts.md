# Audio input contracts — verified 2026-08-26

The latest investigated narration failed inside Forma, after planning but before
Fal submission: its final two-speaker script was 5,134 characters, but the Gemini
adapter had inherited a 5,000-character music limit. The speech planner budgeted
neither the actual spoken script nor Gemini's separate voice-direction field.

`src/model/audio-provider-contracts.ts` now defines the **Forma-supported subset**
of each endpoint's fields. It is shared by all serializers and by preparation.
Fields not implemented by Forma are rejected, even if the provider offers them.
Adding a field requires reviewing its authorization, pricing, validation, and
output handling, not merely adding its name to a request.

## Exact endpoints and transmitted values

| Endpoint / primary source | Provider limits relevant to Forma | Forma's submitted values and policy |
| --- | --- | --- |
| [Lyria 3 Pro](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Flyria3%2Fpro) | `prompt`: 1–5,000 characters; optional `image_url`. No duration or output-format input. Deprecated `negative_prompt` is explicitly unsupported. | Prompt plus at most one approved image; never a negative prompt, duration, or waveform. |
| [Stable Audio 3 Medium](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fstable-audio-3%2Fmedium%2Ftext-to-audio) | `duration`: finite number 1–380, default 30; `output_format`: `mp3`, `wav`, `flac`, `ogg`, `opus`, `m4a`, `aac`; `enable_safety_checker`: boolean. No published prompt or negative-prompt character maximum. | Prompt budget 5,000 is **Forma policy**. Preserve valid fractional durations; explicit `mp3`, safety checking `true`; instrumental preference adds the fixed negative prompt `singing, vocals, spoken dialogue`. |
| [Sonilo text music](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=sonilo%2Fv1.1%2Ftext-to-music) | `duration`: integer 1–600, default 90; `num_samples`: integer 1–3; no prompt character maximum or format input. Output AAC/M4A. | Prompt budget 5,000 is Forma policy. Exactly one sample, matching the quote and single-result handling. |
| [Sonilo text sound effects](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=sonilo%2Fv1.1%2Ftext-to-sound-effects) | `duration`: integer 1–180, default 8; `audio_format`: `wav`, `mp3`, `aac`, `flac`, default `aac`; no prompt character maximum. | Prompt budget 5,000 is Forma policy; explicit `mp3`. |
| [Gemini 3.1 Flash TTS](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fgemini-3.1-flash-tts) | `prompt`: 1–50,000 characters; `style_instructions`: at most 4,000; `output_format`: `wav`, `mp3`, `ogg_opus`; 30 enumerated voice presets; speaker aliases match `^\w+$` and prompt prefixes. | Explicit `mp3`; one `Kore` voice, or two speakers using `Charon` and `Kore` with normalized `Speaker1`/`Speaker2` aliases. Script and nonspoken style are separately retained and validated together. See the token policy below. |
| [Seed Audio 1.0](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance%2Fseed-audio-1.0) | `prompt`: at most 2,048 characters; `output_format`: `wav`, `mp3`, `pcm`, `ogg_opus`. No duration or speaker-count parameter. | Explicit `mp3`; no voice cloning, audio URLs, or images are silently enabled. Four described speakers is a Forma planning policy, not an enforced provider parameter. |
| [Sonilo video music](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=sonilo%2Fv1.1%2Fvideo-to-music) | Required public HTTP(S) `video_url`; optional prompt; `duration`: number 1–600; `num_samples`: integer 1–3. Requested duration cannot exceed the remaining video. | One approved complete MP4, one sample, at most 180 seconds / 25 MiB under Forma's reference policy. Send the actual fractional clip duration unchanged; round only billing. No implicit cropping or offset. |
| [Sonilo video sound effects](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=sonilo%2Fv1.1%2Fvideo-to-video-sound-effects) | Required `video_url`, optional prompt, `audio_format`: `wav`, `mp3`, `aac`, `flac`; **no duration input**. | Complete approved MP4, explicit `mp3`. No duration, offset, or segment parameters. |

Provider character lengths are checked as Unicode code points. Context compaction
uses a conservative UTF-16 character budget; it may retain less supplementary
Unicode text, but cannot exceed the provider character limit. Narration is never
compacted or silently truncated.

## Gemini's independent token constraint

Google's [specific Gemini 3.1 TTS model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview)
lists 8,192 input tokens and 16,384 output tokens. Fal prepends style instructions
to the spoken text. A 50,000-character schema allowance therefore does **not**
establish that a request fits the underlying model's input window.

Forma admits at most **7,168 UTF-8 bytes for the final normalized script plus
style and their separator**, leaving a 1,024-unit wrapper allowance against the
published input-token ceiling. This is a conservative application policy, **not
an exact Gemini token count or a guarantee about Fal's undocumented wrapper**.
There is no provider tokenizer/countTokens integration in this Fal path. Expand
this policy only after validating exact token accounting for this endpoint.

Newly written scripts target at most 6,000 UTF-8 bytes, reduced by the space needed
for required voice direction. Optional tone/destination directions are omitted
only when needed to protect the complete script and required instructions. The
planner receives the selected model, exact field restrictions, remaining script
budget, and canonical speaker aliases. Its structured output has a character
bound; actual UTF-8 and normalized-alias validation runs separately afterward.
Optional style never reduces the planner's capacity based on a placeholder
script. Approved scripts are inserted locally after metadata planning rather
than regenerated or copied twice by the planner. Newly generated speech receives
an output-token allowance sized for the admitted script budget.

Fal's schema offers up to ten speakers, but Google's
[speech-generation guide](https://ai.google.dev/gemini-api/docs/speech-generation)
documents two. Forma retains its two-speaker subset. The existing 300-second
speech ceiling is a Forma policy; Gemini accepts no exact-duration parameter.

The conservative speech reservation uses the application's admitted capacity,
not 50,000 characters. Settlement uses serialized script characters and the
existing published-rate estimate; it is not a provider-measured invoice. Fal's
public pricing does not clarify whether style characters are separately billed.

## Provider features deliberately not exposed

- Stable: inference steps (integer 1–100, default 8), guidance (0–25, default 1),
  integer seed, prompt expansion, synchronous inline output, and bitrate.
- Gemini: temperature (0–2), 87 enumerated **language labels** rather than arbitrary
  ISO codes, alternate formats/voices, and more than two speakers.
- Seed: reference voice/audio/image inputs, sample rate (`8000`, `16000`, `24000`,
  `32000`, `44100`, `48000`), speed/volume (0.5–2), pitch (integer −12–12), and
  multilingual mode. Its optional audio references allow up to three clips, each
  at most 30 seconds / 10 MB; supported image formats are JPEG/PNG/WebP up to
  10 MB, mutually exclusive with audio references.
- Sonilo video music: prompt influence (0–1), start offset (0–600), and additional
  samples. Offset plus duration must fit the source clip if these are introduced.
- Sonilo video sound effects: segment arrays, which require nonnegative times,
  first start at zero, contiguous boundaries without gaps/overlaps, and final
  end no later than the source clip.

Fal's [Seed FAQ](https://fal.ai/seed-audio-1.0) still publishes a two-minute maximum;
a previously advertised future extension is not assumed to have shipped. Its
[Sonilo sound-effects FAQ](https://fal.ai/sonilo-sound-effects-1.0) separately
publishes the three-minute video limit. Neither endpoint accepts a duration
parameter merely because its documentation discusses runtime.

## Verification and recovery

Raw profile aliases are validated before normalization, so invalid goals,
durations, speaker counts, preference types, and destinations cannot disappear
into defaults. Immutable scripts and required direction are checked before paid
planning. Generated drafts use the existing one-repair allowance; unresolved
audio limits are terminal preparation errors with truthful planning accounting.

All payloads are validated before reference uploads and queue submission. After
upload, only approved reference URLs are substituted into the already validated
payload; a final validation precedes the submission checkpoint. No second
serialization may alter speaker aliases or the cost basis.

Accepted requests retain their original prompt, parameter receipt, model, and
quote. Recovery bypasses new-input preparation and schema admission and does not
upload, replan, or buy another generation. Regression tests cover the original
5,000-plus-character narration shape, every model's prompt/parameter boundaries,
Unicode and style budgets, single bounded repair, raw admission, fractional
video timing, and recovery of historical input under newer policies.
