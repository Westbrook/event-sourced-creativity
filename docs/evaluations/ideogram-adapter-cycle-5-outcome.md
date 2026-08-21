# Ideogram adapter campaign 5 outcome

Status: **passed**  
Winning adapter: `fal-ideogram-v4@v52`  
Prompt adapter: `ideogram-context-v6`  
Frozen corpus: `canvas-image-corpus-v6` (50 cases)  
Completed: 2026-08-21T01:13:38.318Z

## Outcome

Campaign 5 stopped on its second candidate because v52 passed the unchanged full-corpus qualification. No corpus item, rubric, evaluator, acceptance threshold, or baseline image was changed to produce the pass.

The winning production contract is:

- expanded plain provider input compiled by `ideogram-context-v6`;
- `production_director` caption hierarchy;
- `Large` expansion on the standard and image-to-image endpoints;
- `Medium` expansion on the fast draft endpoint;
- standard endpoint routing for semantically complex material studies;
- reference transformation strengths of `0.99` for inspiration, `0.88` for preserve-composition, `0.30` for preserve-subject, `0.72` for preserve-style, and `0.90` by default;
- exact prompt and reference moderation plus the provider safety checker;
- the normal production request seed remains variable. The deterministic v52 evaluation seed (`5445908`) is retained only to make qualification reproducible.

## Full qualification

| Gate | Fixed threshold | v52 result | Outcome |
| --- | ---: | ---: | --- |
| All cases complete | 50/50 | 50/50 | Pass |
| Evaluator coverage | 90% | 50/50 | Pass |
| Candidate usability | 80% | 43/50 (86%) | Pass |
| Reference usability | 70% | 10/10 (100%) | Pass |
| Instruction delta vs OpenAI | no worse than −0.75 | −0.30 | Pass |
| Composition usability | 70% | 8/10 | Pass |
| Typography usability | 70% | 8/10 | Pass |
| Spatial usability | 70% | 8/10 | Pass |
| Material usability | 70% | 9/10 | Pass |
| Reference capability usability | 70% | 10/10 | Pass |
| Prose usability | 70% | 11/13 | Pass |
| Bullets usability | 70% | 12/13 | Pass |
| JSON usability | 70% | 11/12 | Pass |
| XML usability | 70% | 9/12 | Pass |

All 50 Fal requests completed. There were no failed attempts, provider safety rejections, queue failures, or evaluator failures. Fal mean latency was 20.427 seconds versus 58.210 seconds for the retained OpenAI baseline. The v52 candidate images recorded $2.391310 in successful image-provider cost; the paired retained report records $6.239999 across both providers. Moderation and evaluator charges are not included in those image-provider figures.

## Why v51 did not pass

V51 was operationally clean and reached 42/50 usable images, but bullets reached 9/13 usable outputs (69.2%), one case below the unchanged 70% prompt-technique floor. It was correctly rejected. V52 retained the capability classification and endpoint fixes while replacing the shot-plan hierarchy with the production-director hierarchy; bullets rose to 12/13 without regressing another gate.

## Evidence

- Search: `outputs/image-adapter-cycles/search-2026-08-21T00-37-46-033Z.json`
- V51 full report: `outputs/image-adapter-cycles/v51/full/report.json`
- V52 preflight: `outputs/image-adapter-cycles/v52/full/preflight.json`
- V52 micro report: `outputs/image-adapter-cycles/v52/micro/report.json`
- V52 sentinel report: `outputs/image-adapter-cycles/v52/sentinel/report.json`
- V52 full report: `outputs/image-adapter-cycles/v52/full/report.json`

## Approval handoff

The application now registers `fal-ideogram-v4@v52` and retains this passing report server-side. The Operations governance UI may therefore accept the independent Fal entitlement or contract reference and record administrator approval. Passing an evaluation does not silently approve the provider contract; the durable administrator action remains separate.

Any future change to provider prompt compilation, reference strengths, endpoint routing, or safety behavior requires a new adapter version and qualification. V52 and all earlier attempts remain immutable evidence.
