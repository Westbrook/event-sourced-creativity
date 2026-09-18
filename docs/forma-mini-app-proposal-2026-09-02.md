# Forma mini-app proposal

Product and technical proposal · September 2, 2026

**Implementation status · September 5, 2026:** The [unified runtime plan](/Users/westbrook/Documents/repos/codex/docs/forma-experience-runtime-proposal-2026-09-02.md) is being implemented. The full eight-output system is not complete or deployed; see the [current progress checkpoint](/Users/westbrook/.codex/visualizations/2026/09/02/01a06268-c0b2-7c43-b315-32320ab45634/mini-app-progress.json) for per-output source, local, browser and public-path readiness. The original wireframes remain fictional samples that simulate generation, verification and handoff; they do not establish live authentication or provider qualification.

**Implementation prerequisite:** **Add 3D model contexts**. This mini-app program follows that task. Its source/schema integration prerequisite was subsequently recorded as cleared in the unified runtime plan. That does not establish live 3D generation, mobile/GPU qualification or a completed mini-app journey. Integration and deployment remain owner-controlled.

**Scope:** Eight planned experiences, including **3D model** (`model3d`). At the initial September 2 audit, `main` contained seven output kinds and the eighth was on `codex/3d-model-contexts` at `f2025c6`; that is a historical baseline, not the current integration status. Do not equate an output type or a passing fixture with qualified public mini-app support.

**Mobile and touch:** Each app has a medium-specific mobile contract below. The shared mobile requirements and real-device release gates apply to every delivery phase; narrow-screen screenshots alone do not establish touch readiness.

**Architecture revision:** Use [one configurable experience runtime](/Users/westbrook/Documents/repos/codex/docs/forma-experience-runtime-proposal-2026-09-02.md), with eight initial definitions composed from a qualified Forma interaction catalog. That revision supersedes the separate-screen implementation strategy here. The output experiences, mobile/touch requirements, functional copy, security, and 3D prerequisite below remain acceptance criteria.

## Recommendation

Deliver eight small creative instruments as configurations of one runtime. Each lets a person make a few consequential decisions that belong to its medium, produces one complete deliverable, and opens that same work in Forma when the person wants to develop it further.

The recognizable Forma quality should be **direction that survives the result**. A subject remains separate from its surroundings; a character's want remains separate from another character's knowledge; a claim remains connected to its evidence. The user encounters these as ordinary creative decisions, never as a block schema or a prompt-writing exercise.

Treat the mini-apps as alternate entrances to Forma, not separate products with their own content databases, accounts, or inference services. Share the runtime, qualified interaction catalog, document integration, generation admission, and handoff. Each input experience and result presentation can differ through its definition and registered medium-specific variants.

### Proposed first-release scope

| App / output | One bounded result | Distinctive interaction |
| --- | --- | --- |
| **Image** | One composed editorial still | Place a subject; choose its light and visual boundary |
| **Short story** | One 600–800-word fictional story | Connect desire, obstacle, and a consequential choice |
| **Scene** | One short two-character script in one location | Set opposing wants and decide who knows the secret |
| **Slides** | One five-slide argument | Arrange evidence beneath a claim and an audience decision |
| **Storyboard** | One four-frame visual sequence | Place a reveal in an ordered strip of shots |
| **Video** | One four-second, silent, 480p shot from a still | Separate the focal anchor, camera direction, and moving element |
| **Audio** | One approximately 20-second instrumental cue | Shape an emotional contour and choose a restrained sound palette |
| **3D model** | One static, viewable GLB object | Set relative proportions and surface intent around a spatial preview |

Output ceilings are proposed product choices, not provider promises. Validate each recipe against its selected model before publishing the scope. In particular, reference fidelity, camera movement, musical timing, storyboard continuity, and 3D shape/material fidelity are creative instructions—not deterministic controls.

### Microcopy policy

Use functional labels, direct actions, numeric limits, and literal statuses throughout. No slogans, rhetorical questions, conversational instructions, encouragement, attitude, or editorial prose. Use the output type as the app name. The composition and interactions provide the character.

| Purpose | Approved copy examples |
| --- | --- |
| App names | Image · Short story · Scene · Slides · Storyboard · Video · Audio · 3D model |
| Inputs | Subject · Placement · Goal · Secret · Knowledge · Evidence · Reveal frame · Moment · Object · Proportions · Surface |
| Actions | Create image · Create scene · Create 3D model · Download · Play · Resume · Edit in Forma |
| Scope | 1 image · 5 slides · 4 frames · 4 s · Silent · 480p · 1 model · GLB |
| Admission | Confirm generation · Sponsored · No charge · Email verification required |
| Status | Preparing · Generating · Saving · Complete · Request under review |
| Failure | Source required · Limit reached · Generation unavailable · Session expired |
| Continuity | Creative choices · Same document · Output + creative choices |
| Preferences | Saved preferences: On · Save preferences |
| Consent / retention | Provider transfer required · Source rights confirmed · Guest retention: 7 days |

Necessary consent and privacy disclosures remain available in concise, factual language. Do not omit material information merely to shorten a label. Creative inputs and the generated work are content, not microcopy; a short story still contains prose. Explanations in this proposal are not proposed interface text.

## Experience rules

1. **The first screen is the activity.** A numeric output scope, a useful example, and the first decision. No dashboard, workspace chooser, empty chat, or project-naming requirement.
2. **Several decisions, one result.** Most experiences require three or four short actions. Optional detail stays optional. Named text fields support the interaction; they are not a subdivided mega-prompt.
3. **Input demonstrations are local and truthful.** Silhouettes, framing guides, evidence order, shot strips, and contours respond immediately without model calls. Label motion demonstrations as direction previews, not generated-video previews.
4. **Before creation, revise freely.** Users can revisit any decision without paying or losing their work. Show the final output scope and any verification requirement before the commitment click.
5. **After creation, the output becomes the interface.** Remove the setup controls. Keep reading, playback, slide navigation, zoom, and a restrained action area. Those are viewing controls, not editing tools.
6. **Deliver the complete promised result.** Do not blur it, truncate the real deliverable, or demand signup merely to reveal work already generated. Prototype excerpts are explicitly illustrative; production results must be complete.
7. **Always show “Edit in Forma.”** Open the same Document with its result and original decisions intact. No reconstruction, import wizard, project dashboard detour, or new blank document.
8. **Set honest upgrade expectations.** Forma lets the person revise direction, work with context, and develop further outputs. Do not imply it is a pixel editor, video NLE, audio workstation, stems mixer, CAD system, or mesh sculptor.
9. **No regeneration carousel.** New creative attempts and deeper changes belong in Forma. Recovering a failed job is different from purchasing a new creative attempt.

## 1. Image

**Visible scope:** “1 image”

### Interface and flow

1. **Subject / Reference.** Name a subject or provide one owned reference image. An example subject makes the empty state usable. If an image is supplied, explain whether its pixels will be sent to the generation provider and confirm rights.
2. **Placement.** A large composition stage offers left, center, or right placement and generous negative space. Clicking a region and selecting a labeled position do the same thing; dragging is optional.
3. **Setting / Lighting.** Supply a short setting and choose one lighting treatment from three visual swatches. Optional fields identify a required detail and an exclusion.
4. **Create image.** Show the fixed image scope and sponsorship/verification state, then admit one render.

The stage updates only a schematic composition before creation. It should never fabricate a succession of “live” model previews.

### Result

A large, uncropped image sits in a quiet matte. The title and two actions occupy a small footer: **Download image** and **Edit in Forma**. Zoom is a viewer affordance; masks, local retouching, alternate candidates, and post-generation sliders do not appear.

### Mobile and touch

- Put the full-width composition stage above visible **Left / Center / Right** controls. Stage tapping is optional; neither dragging nor precision positioning is required. Lighting swatches include labels and full touch targets.
- Preserve the source aspect ratio and source-relative placement through rotation and resizing. A vertical page-scroll gesture crossing the preview must not move the subject.
- Fit the entire completed image first. An **Open image** inspection surface provides **Zoom in / Zoom out / Fit / Close**; pinch is optional. Closing restores the result's scroll position. No crop handles or post-generation composition controls.

**Forma continuation:** Refine the direction or develop related images using the retained subject, setting, and constraints.

**Behind the interface:** `subject`, `reference`, `environment`, `composition`, `lighting`, `exclusion`, and `format` decisions. The source's reference role and consent remain explicit. A lighting choice must not silently alter the subject constraint.

**Release boundary:** One server-sized image. Do not offer a second visual reference in the first release unless testing shows its value outweighs another upload and rights decision. Forma's existing reference-role distinctions provide a natural later extension.

## 2. Short story

**Visible scope:** “1 story · 600–800 words”

### Interface and flow

1. **Character / Goal.** A short character field and a concrete desire establish the left side of a three-part story structure.
2. **Obstacle.** The middle panel introduces an obstacle. Its position visually connects the character to the decision rather than resembling another settings field.
3. **Decision / Ending.** Supply the consequential choice, select the ending's feeling, and optionally name one required detail.
4. **Create story.** Produce one complete, approximately 600–800-word fictional story.

Changing the ending choice changes the labeled story structure immediately; it does not spend tokens on candidate endings. A single warm example can populate all fields, while every decision remains independently editable before creation.

### Result

A calm, readable page: title, generous margins, good line length, and complete prose. Avoid a fake book interface with expensive page-turn animation. A subtle reading-progress indicator is enough. No generated cover is necessary; it would introduce a second deliverable and an extra model call.

### Mobile and touch

- Stack **Character / Goal → Obstacle → Decision** vertically. Keep compact summaries of earlier choices available while editing later fields; do not compress a horizontal causal diagram to fit a phone.
- Use ordinary labeled text fields and tap choices. Do not require horizontal swipes between steps or open the keyboard automatically on arrival.
- Read the complete result in one vertically scrolling page with user-scalable text. No nested page scroller or swipe pagination. Preserve reading position when opening actions and returning; tablets use a bounded-width reading column, not stretched lines.

**Forma continuation:** Extend the story while retaining the characters, causal structure, and required details.

**Behind the interface:** `subject`, `direction`, ordered `message`/`action` decisions, `emotion`, and any protected detail. Authored facts and deliberate fiction remain distinguishable.

**Release boundary:** One story, one main turn, no branching tree, paragraph rewrites, continuation generator, or compulsory genre questionnaire. Validate length and basic completeness; do not promise literary quality from a structural check alone.

## 3. Scene

**Visible scope:** “1 scene · 2 characters · 1 location”

### Interface and flow

1. **Characters / Goals.** Each has a name and a concrete want. The composition of the screen communicates opposition.
2. **Secret / Knowledge.** Supply one short fact neither person is saying aloud, then assign its knowledge marker to A, B, or both. A labeled radio group is equivalent to moving the marker. The system must not invent the central secret.
3. **Location / Tension.** Choose one location and restrained or explosive tension. The competing goals and shared secret supply the dramatic pressure without another required input.
4. **Create scene.** Return a short script, roughly one or two pages, with action and dialogue.

The meaningful operation is changing who knows what. That should visibly update the relational sketch, not merely change a hidden sentence in a generic prompt.

### Result

A screenplay reading surface with clear character cues and dialogue hierarchy. The output is a **script**, not a performance or an audio file. Reading and downloading remain available; character expansion, rewrites, and additional scenes move to Forma.

### Mobile and touch

- Stack the two character cards on phones. Repeat both names and goal summaries beside **Secret / Knowledge** so the relationship remains visible without scrolling back to identify each participant.
- Use explicit knowledge choices with character names and **Both**; retain A/B identifiers when names collide. No left/right-only semantics, color-only ownership, or draggable knowledge token. On wider tablets the cards can face each other without changing these controls.
- Reflow the script's action and dialogue into the available width while preserving character cues. Do not scale down a fixed screenplay page; support text selection, large text, and normal vertical scrolling.

**Forma continuation:** Connect the scene to additional characters, references, and surrounding narrative.

**Behind the interface:** Two `subject` contexts, participant-specific `direction`/`action` decisions, a `message` with subtext, `environment`, and `emotion`. Knowledge must remain scoped to the intended character.

**Release boundary:** Two characters and one location. Launch with a screen-scene recipe. The existing audio-scene variant can later use the same mechanism with sound cues instead of camera direction; do not add a playback feature to this script app.

## 4. Slides

**Visible scope:** “5 slides”

### Interface and flow

1. **Claim / Audience / Requested action.** One sentence says what the presentation argues. The requested action establishes the audience decision; a short audience choice changes emphasis, not facts.
2. **Evidence / Source.** Three evidence entries each contain a short excerpt and its source label. V1 accepts bounded pasted material; arbitrary web retrieval and long-document ingestion are separate scope.
3. **Order.** Move evidence beneath the claim. Native move-up/down buttons accompany optional drag ordering. A fixed five-slide outline updates as evidence is prioritized.
4. **Create slides.** The fixed sequence is: claim, three ordered evidence points, requested action.

If a claim cannot be grounded in the supplied material, ask for a source, remove the claim, or label it as a proposal. Do not invent statistics to make the deck look complete.

### Result

The deck occupies the main stage. Five unobtrusive thumbnails and keyboard navigation support viewing. Source references remain available through disclosure. Export uses the existing authorized PDF/PPTX paths after adapting them to the mini-app principal and review policy; do not bypass their gate by calling a client converter directly.

### Mobile and touch

- Stack evidence entries vertically with **Move up / Move down** controls. A move retains focus on that entry and announces its new position. No long-press requirement; scrolling or selecting evidence text must not reorder it.
- Show one completed slide with **Previous / Next**, a numbered selector, and **Slide 2 of 5**-style position status. Swipe navigation is optional and never replaces these controls or intercepts system back gestures.
- Preserve the actual slide aspect ratio. Provide read-only **Slide text** and **Sources** for portrait-phone reading, plus optional expanded viewing. This is another view of the same slide, not a mobile re-layout of the exported deck. Wider tablets may show thumbnails beside the stage when all targets remain usable.

**Forma continuation:** Expand or revise the argument with project context while retaining evidence provenance.

**Behind the interface:** `direction`, `audience`, `message`, source `reference` blocks, evidence ordering, and `format`. Preserve exact numbers, source identity, and the claim-to-evidence relationship.

**Release boundary:** Five slides, one visual treatment, one argument, no template marketplace, chart builder, layout editor, or automatically generated decorative images. Readability and factual fidelity outrank filling a slide count with unsupported content.

## 5. Storyboard

**Visible scope:** “4 frames”

### Interface and flow

1. **Subject / Setting.** Name the shared character or object and the setting. An optional authorized reference anchors the entire sequence.
2. **Event / Reveal.** For example: “A courier opens a package” and “Inside is the key she lost years ago.” A preset four-shot rhythm supplies the strip; users do not have to write four actions and direct four cameras.
3. **Reveal frame.** Select the frame in which the audience discovers that fact. The schematic strip updates its setup/reveal/reaction roles locally. The marker is the explicit ordering authority; there is no separately authored action sequence to contradict it.
4. **Create storyboard.** Plan and render four connected frames as one storyboard artifact.

Use the existing continuity-aware storyboard workflow rather than four unrelated calls. Preserve each frame's shot intent and its relationship to shared references.

### Result

A four-panel contact sheet fills the page. Selecting a panel enlarges it, with a way back to the complete sequence. The four panels remain one deliverable, not a gallery of competing candidates.

### Mobile and touch

- Use a numbered 2×2 schematic overview on phones with an explicit **Reveal frame: 1 / 2 / 3 / 4** selector. Selecting a frame is a tap, not a marker drag. Numbers and labels communicate order independently of position or color.
- On tablets, use four columns only if captions and touch targets fit; otherwise keep two columns. Preserve source image proportions and reveal identity when the device rotates.
- A result panel opens with its complete caption and **Previous / Next / Close** controls. Closing returns to the selected overview panel and prior scroll position. Keep all four frames accessible without swipe-only navigation; no completed-frame rearrangement.

**Forma continuation:** Extend the sequence while retaining its subject, reveal order, and reference bindings.

**Behind the interface:** Shared `subject`/`environment` contexts, the authored `action`, reveal `message` and ordering constraint, plus recipe-default `camera` decisions and reference bindings. Preserve authorship: user choices are authored; the preset is a default; generated shot details belong to the retained plan rather than being relabeled as user input. Use existing ordered-context semantics where they fit; validate any new recipe metadata with the server.

**Release boundary:** Four frames, no drawing tools, panel regeneration, animatic timeline, or completed-frame rearrangement. A downloadable single contact-sheet image is a proposed small export adapter; do not claim an existing native storyboard-PDF exporter. If one frame fails, retain successful frames and resume the same job rather than purchasing them again.

## 6. Video

**Visible scope:** “1 clip · 4 s · Silent · 480p”

### Interface and flow

1. **Reference.** Use an owned upload or a clearly labeled example. Confirm rights and provider transfer before generation.
2. **Focal anchor.** Select the part of the scene that should hold attention using broad regions; fine pixel precision is not required.
3. **Camera / Motion.** Pick locked camera, slow push, or lateral drift; name one moving element, such as steam, water, or light. A local arrow overlay explains the direction.
4. **Create video.** The first release fixes the output at four seconds, silent, and 480p. Require lightweight verification before the sponsored render.

“Camera direction preview” must remain visibly distinct from an actual generated-video preview. The current adapter supports this duration/resolution combination, but the recipe still needs end-to-end qualification with the intended reference mix.

### Result

An output-first poster and native, user-initiated playback. No autoplay with sound, ornamental video behind the controls, trimming, soundtrack selection, or multi-shot timeline. Allow downloading the actual completed clip.

### Mobile and touch

- Stack the uncropped source, broad focal choices, **Camera**, and **Motion**. Named regions provide the same control as stage tapping. Presets wrap; masks, drawn paths, and precision gestures are not required.
- Preserve the focal anchor in source coordinates through orientation changes. Vertical scrolling across the still cannot move it or change the selected motion.
- Use native inline playback with user-initiated play and optional fullscreen; retain the actual aspect ratio. Keep **Download video** and **Edit in Forma** outside the player so custom actions do not cover native controls. Rotation, fullscreen exit, or backgrounding must not create another job or restart playback without a user action.

**Forma continuation:** Revise the shot's direction or create related shots from the retained reference and motion intent.

**Behind the interface:** An exact `reference`, a focal `composition` decision, `camera`, element-specific `motion`, and `format`/silence constraints. Camera motion and subject motion must not be conflated.

**Release boundary:** One shot. No promise of precise camera mechanics, perfect subject preservation, or a seamless loop. If generation takes longer than the session, provide resumable status and an optional requested ready notification—not unsolicited marketing email.

## 7. Audio

**Visible scope:** “1 track · ~20 s · Instrumental”

### Interface and flow

1. **Moment.** A short use case such as an arrival, reveal, or ending supplies the purpose.
2. **Opening / Peak / Ending.** These controls draw one simple emotional contour. Native ranges provide the same control as moving points.
3. **Instruments / Exclusions.** Offer three restrained instrumental families, not a catalog of models or a mixer. Optional exclusions stay small.
4. **Create audio.** Generate approximately 20 seconds of instrumental audio using a qualified duration-capable adapter. Show lightweight verification before spending.

The contour is a creative request. It must not imply sample-accurate automation or promise a musical peak at an exact timestamp.

### Result

A listening surface with a title, actual duration, a waveform derived from the returned media, a brief accessible description, and an obvious play control. No simulated waveform should be presented as measured audio in production. The proposal wireframe is explicitly schematic and contains no recording.

### Mobile and touch

- Stack **Opening / Peak / Ending** as three full-width labeled controls with visible values. Support tap-to-position and **Increase / Decrease** actions as alternatives to dragging. Each control changes energy, not precise timeline automation.
- Keep normal vertical scrolling across the contour; curve-point dragging is optional. Changing a value updates the local diagram only, with no sound preview or generation call. Tablets may place the controls side by side when labels and targets fit.
- Native playback remains usable independently of the waveform. Play, pause, and seeking inspect the existing file. Support system audio interruption without purchasing or automatically replaying audio; remove all energy and instrument creation controls after generation.

**Forma continuation:** Develop the audio with the rest of the creative project while retaining its purpose and emotional contour.

**Behind the interface:** `direction`, temporal `emotion`, `audio` palette, exclusions, and `format`. The result and its musical direction remain part of the same Document.

**Release boundary:** One mixed instrumental file. No lyrics, voice imitation, stems, mixing, mastering, or claimed seamless looping. Forma's other audio goals are not part of this mini-app's initial promise.

## 8. 3D model

**Visible scope:** “1 model · GLB”

**Dependency:** Uses the model asset, viewer, saved-view provenance, export, and Rodin adapter work from **Add 3D model contexts**. No parallel 3D asset system or second provider adapter.

### Interface and flow

1. **Object / Reference.** Name one isolated object, such as a desk lamp. A single owned image may supply visual guidance; keep multi-view reconstruction and existing-mesh management in full Forma for the first release. Confirm rights and provider transfer for any supplied image. The prototype uses schematic content, not a live upload or model.
2. **Proportions.** Choose Compact, Tall, or Wide. A local bounding cage and silhouette update immediately. These are relative proportions, not centimetres, engineering dimensions, or promised exact geometry.
3. **Surface.** Choose a small set of surface intentions, such as Matte, Metal, or Ceramic. These choices become authored material context, not a material editor. If an image is supplied, disclose its material-reference role alongside the requested surface; do not imply either instruction guarantees exact reconstruction.
4. **Create 3D model.** Review the object, proportions, surface, source, and fixed GLB scope; verify identity before the sponsored request. A read-only generation-details disclosure can expose the exact compiled provider text without adding a prompt editor. Produce one static model through the existing validated job path.

The input stage is a spatial decision surface: native view buttons can show the schematic from several sides while proportions and surface intent change. It makes no inference calls. The live generated mesh appears only after the admitted job completes.

### Result

One object occupies a neutral inspection stage. Front, Side, Back, and Top presets, orbit, and zoom are viewing controls; they do not modify geometry, persist new creative direction, or initiate another generation. The main actions are **Download model** and **Edit in Forma**. No automatic rotation, mesh editing, remeshing, rigging, texture painting, background scene construction, or format marketplace.

The public scope requires a self-contained, preview-safe primary GLB with its required materials and textures. Rodin can return additional meshes and texture files, so one request does not guarantee one output file. Retain the complete authorized provider manifest and auxiliary assets on the same Document; expose one primary model in the mini-app. Do not mark the promised experience complete merely because the general adapter finished with a downloadable but unviewable file. Missing dependencies, invalid geometry, unsupported viewer features, and transfer limits need truthful recovery of the existing job, never an automatic replacement purchase.

### Mobile and touch

- Keep the inline stage scroll-safe, with view presets available by tap. **View model** explicitly opens an inspection surface; **Close** returns to the same result position. Do not start orbiting merely because a finger crosses the model while scrolling.
- Within active inspection, allow one-finger orbit and pinch-to-model-zoom as optional gestures. Also provide camera-step controls, angle presets, **Zoom in / Zoom out / Fit**. Limit gesture capture to that inspection canvas; preserve browser zoom and navigation outside it. Tablets and touch-plus-trackpad devices use the same contract.
- Inspection changes only the viewing camera. It neither edits geometry/materials nor saves a reference view. Proportion and surface creation controls remain absent from the result and expanded viewer.
- Use one active GLB viewer. Suspend drawing when hidden/offscreen and release unused GPU resources on exit; restore the same authorized model after context loss or interruption. Before attaching an asynchronous load or restoration, check the current account, Document, asset identity, and authorization; discard stale completions after navigation or identity changes. A poster, description, download, and **Edit in Forma** remain available when WebGL or device memory is insufficient, subject to the same access/export policy. This mobile interaction/lifecycle adaptation is additional work, not something established by the branch's desktop fixture.

**Forma continuation:** Open the same Document and retained model. In full Forma, the creator can manage a `model3d` context, save a specific image view, and reuse that view in image/video direction or the reference compositor. Casual orbiting in the mini-app must not silently select the next generation's reference view.

**Behind the interface:** `subject`, `scale`/validated relative-proportion metadata, `material`, optional `reference`, and `format` decisions. The resulting artifact kind is `model3d`. Keep user-authored intent, recipe defaults, provider settings, and returned geometry distinct. Saved image views additionally retain source model identity/hash, camera receipt, pixel hash, rights, and visual-use policy. Generation freezes the reviewed saved pixels; it must not capture whatever camera happens to be open later.

### Recipe and release boundary

- Reuse both Rodin v2.5 adapters: text mode without image references; image mode with the single allowed mini-app reference. Endpoint selection is server-owned. Never send a raw mesh to either endpoint or send image-only fields to the text route. Full Forma's larger reference allowance need not appear in the mini-app.
- Compile the short fields deterministically from authorized context. Validate the complete submitted text against the adapter's 1,024-Unicode-character limit, including recipe text. No silent truncation, unreviewed document-wide prompt expansion, or extra planning purchase.
- Surface choices such as Ceramic are creative intent. The provider's `material` enum instead controls material representation. A proposed qualification recipe is GLB, PBR, an explicit modest mesh choice (initial candidate: High tier with 20K Triangle), and HighPack off. These are server-owned defaults, not public controls. Do not inherit High + Auto blindly: the published Auto mapping selects substantially more geometry. Confirm quality, cost, and device performance before fixing the recipe. [Fal text schema](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/text-to-3d/api), [Fal image schema](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/api)
- Proportion presets may map to validated `bbox_condition` ratios after qualification. Do not expose physical units or turn the schematic into a dimensional-accuracy promise.
- Enforce a mini-app asset envelope for actual geometry, decoded texture size, transfer bytes, and viewer resource use. The branch's 64 MiB per-file transfer ceiling is an application safety limit, not a mobile-performance target or provider requirement. Validate the model before loading a lazy viewer; retain a poster and download/recovery path if WebGL is unavailable.
- No precision CAD, animated character, print-readiness, topology preservation, or exact material guarantee. An existing GLB can steer a new model only through deliberately saved images; it is not an editable mesh input to Rodin.

Implementation evidence remains on the prerequisite branch: [3D contexts and saved views](/private/tmp/forma-3d-model-contexts/docs/3d-contexts.md), [Rodin contract](/private/tmp/forma-3d-model-contexts/docs/adapters/fal-rodin-v2.5.md), and [validated model settings](/private/tmp/forma-3d-model-contexts/src/model/model3d.ts). Reconcile these references and contracts with the integrated baseline before mini-app implementation.

## The shared journey

```text
Arrive at one mini-app
  → make a few medium-specific decisions
  → inspect a no-cost schematic and the exact output promise
  → verify only as required by the sponsorship policy
  → explicitly start one bounded generation
  → inspect the complete result
  → download, explicitly share, or Edit in Forma
  → authenticate/claim if necessary
  → open the same Document at its existing result
```

Do not add a project picker to this journey. Create a small private project behind the scenes when persistence is needed. A signed-in person entering from an authorized Forma project can preserve that scope; an external campaign link must never silently join or charge an organization.

### Before, during, and after a failure

| State | User-facing behavior | Execution rule |
| --- | --- | --- |
| Invalid or conflicting inputs | Explain the exact decision that needs attention; keep all other input | No provider admission |
| Verification required | Brief inline check with reason and the promised free scope | No personal or organization charge |
| Sponsor capacity unavailable | Keep the draft and show when another attempt is possible, if known | No silent switch to paid billing or lower-quality output |
| Generating | Truthful phase: preparing, rendering, saving; show elapsed time | No fabricated percentage or speculative completion time |
| Slow provider | Preserve a resumable result/status location | Browser closure does not purchase a replacement job |
| Safety rejection | Explain the permitted revision; preserve lawful draft input | A rejected provider render is not treated as a transient timeout |
| Uncertain submission | Say the original request is being checked | Retain its reservation; reconcile before any new submission |
| Partial storyboard | Show the completed frames and remaining status | Resume uncompleted work; retain paid frame receipts |
| Completed result | Complete deliverable and Edit in Forma | Viewing controls do not initiate generation |
| Expired guest work | Explain the retention policy honestly | Do not claim a missing asset is recoverable |

## Shared mobile and touch contract

Apply these requirements to every mini-app and to its verification, result, download, and Forma handoff surfaces. Reuse [Forma's responsive and accessibility baseline](/Users/westbrook/Documents/repos/codex/DESIGN.md:538) and [native control/dialog guidance](/Users/westbrook/Documents/repos/codex/docs/components.md:374). Do not create a separate mobile content model or weaker authorization path.

### Layout, reach, and input

- **Phone layout:** support 320 CSS pixels without page-level horizontal overflow; review 360, 390, and 430px widths, portrait and landscape. Use the component's available width, not device-name detection. Tablets and split-screen windows may use two columns only while text, stages, and controls remain usable. Never require landscape or desktop mode to finish.
- **Touch targets:** at least 44×44 CSS pixels of non-overlapping actionable area for controls, including reorder arrows, disclosures, thumbnails, view presets, and close buttons. Prefer 48px for primary actions. Provide space between neighboring targets; expanding an invisible target over another control is not a solution. This follows Forma's stronger target-size baseline, not a claim that WCAG AA universally requires 44px. [W3C target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
- **Text and keyboards:** use at least 16px text in editable controls at default scale, retain visible labels, and allow browser zoom and larger text. Preserve caret, selection, composition/IME input, and earlier answers when a preview updates. Preserve multiline Enter and native Next/Done behavior. An explicit input-form submission opens preflight/review; generation requires its own deliberate confirmation, not a keyboard-dismiss action.
- **Reachable actions:** put creation actions after their relevant choices and result actions outside the media surface. For long results, a single compact docked action row is optional only with reserved content space and safe-area padding. Do not cover the output, stack sticky bars, or move an action beneath a finger. Return to inline actions when the keyboard or a short landscape viewport leaves insufficient room.
- **Keyboard visibility:** do not autofocus on arrival. Bound dialogs and menus to the live viewport and safe-area insets; avoid rigid full-screen heights. Focused fields, errors, and the next action remain visible when the keyboard opens. Use a full-page verification step if a sheet cannot meet this requirement. [W3C focus visibility guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)

### Gesture and navigation rules

- Every essential action works with taps and with keyboard/assistive input. No hover-only controls, mandatory long press, multi-touch gesture, or drag-only operation. A keyboard alternative alone is not enough for a touch user who cannot drag. [W3C dragging alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- Prefer native controls and release/click activation. Handle cancelled pointers without committing a reorder, changing a focal anchor, or submitting work. Rapid taps and duplicate form submissions must resolve to one admission and one job; a disabled button is feedback, not the server-side guarantee. [W3C pointer cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)
- Ordinary vertical scrolling and page pinch-zoom retain priority outside an explicitly opened inspection surface. Do not apply global `touch-action: none`, suppress browser back-edge gestures, or use a page-wide gesture listener. Scope pointer capture and gesture policy to the active control; handle `pointercancel` and release capture on exit. [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)
- **Back / Close** returns to the preceding step, selected slide/frame, or result without deleting the draft or replaying generation. Restore scroll and focus. Screen-reader order follows the visible order; selection is labeled rather than indicated only by color. Preserve native text selection and browser context menus.

### Phone files, connectivity, and handoff

- Use the native photo/file picker, with camera capture only after an explicit action. Cancellation or permission denial preserves all other choices. Validate actual file content and recipe limits before provider admission. Handle rotated phone photos, unsupported HEIC/HEIF, large images, and transparent sources explicitly; convert only through a supported, reviewed normalization path. Orientation correction, resizing, and metadata stripping produce a traceable derived asset and do not overwrite the original source silently. Exclude GPS/private photo metadata from provider-bound derivatives.
- **Upload baseline:** the reviewed main-branch image allowlist excludes HEIC/HEIF, and its non-audio upload ceiling is 12 MiB. Read the integrated per-kind policy after the 3D prerequisite lands; the GLB transfer ceiling is not a photo-upload allowance. Phone-photo normalization/transcoding and resumable upload support must be implemented and verified if offered, not assumed to exist. [Current upload policy](/Users/westbrook/Documents/repos/codex/worker/media-api.ts:150)
- Keep upload work inside the bounded intake allowance. Show progress only from known bytes/state, preserve stable draft/upload IDs, and keep the canonical reference incomplete until verified storage acknowledges it. Resume interrupted bytes only when the upload protocol supports it; otherwise retain the other choices and request file reselection. A matching filename is not proof of identical content. Offline input may remain a draft, but an unavailable local file is not an uploaded reference. Never queue a paid generation to run automatically when connectivity returns.
- Save authorized draft, intake, and admitted job identifiers before switching to email or authentication. Update checkpoints during the flow; do not depend on an unload handler. After refresh, network loss, backgrounding, or browser eviction, reauthorize and reconcile the same frozen job before any submission. If guest authority is gone, require legitimate recovery or show **Session expired**; possession of a Document ID or matching email is not recovery authority.
- Prefer same-tab email-code entry on phones: one field, paste enabled, appropriate autofill/input mode, and bounded resend attempts. Magic links must also be tested when opened in another tab, the system browser, or an embedded marketing browser. Never assume those contexts share cookies. Use verified continuation/session binding or return to code entry in the original browser. Email-link GET requests and link-prefetch scanners must not generate work, claim a Document, or consume an irreversible handoff.
- Pause client polling and unnecessary drawing when the page is hidden; the admitted server job continues independently. On return, fetch current authoritative status instead of extending stale timers or purchasing another attempt. Locking the phone, browser Back, or closing the page is not provider cancellation. An explicit cancellation request must reconcile provider work and sponsor cost before reporting its outcome. Pause media/visual activity according to the explicit playback policy, with no unsolicited restart. Browser background throttling makes client timers unsuitable as job authority. [MDN page visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- Keep **Download**, **Share file**, and **Publish link** distinct. Feature-detect native file sharing, validate the selected file type, and use explicit user activation. If asynchronous file preparation outlives that activation, require a fresh **Share file** tap. Fall back to an authorized download when sharing is unavailable or memory cost is excessive. Native sharing preserves the same authorization, review, and export policy as download; it is not a bypass. Dismissing the OS share sheet is not publishing consent; it must not create a public link or trigger another generation. Revoking a public link cannot retract an already downloaded or shared file. [MDN Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)

All mobile microcopy follows the existing functional-copy policy. Examples: **Photo / Files / Uploading / Saved / Offline / Code / Verify / Code expired / Resume / Previous / Next / View model / Close**. **Saved** requires an acknowledged persistence state; **Complete** requires the promised result, not merely a successful touch action.

## Implementation on Forma

### Existing foundations to reuse

Forma already has a form-to-project/document/block precedent in [project brief creation](/Users/westbrook/Documents/repos/codex/src/components/forma-projects.ts:28), a useful [block taxonomy and reference roles](/Users/westbrook/Documents/repos/codex/src/model/block-types.ts:1), and server-side [context authority](/Users/westbrook/Documents/repos/codex/worker/context-authority.ts:51).

The current `main` [job-request seam](/Users/westbrook/Documents/repos/codex/src/state/store.ts:777) supports image generation and the six document-artifact types. All seven belong to the same canonical resource model. Its [Output Requirements native execution route](/Users/westbrook/Documents/repos/codex/worker/output-document-execution.ts:58) supports images and slides. The prerequisite branch adds `model3d` artifacts and native model delivery; after integration, use that eighth kind through the shared resource model. Neither baseline supplies a ready-made eight-type sponsored public API.

### Proposed architecture

```text
Published experience definitions + qualified catalog
                    │
       Shared runtime + registered viewers
       (typed drafts and allowed intents)
                    │
        Versioned context binding compiler
                    │
     Canonical Project / Document / Context
     (authored decisions, relations, references)
                    │
   Narrow admission API + sponsor quota ledger
     (principal, frozen revision, bounded grant)
                    │
        Existing generation job machinery
       (image or document-artifact renderer,
          including integrated model3d)
                    │
    Private output + immutable input receipts
                    │
         Same-Document Forma handoff
```

A shared mini-app recipe describes the app ID/version, output kind, permitted field schema, deterministic mapping into context commands, output limits, source rules, and references to an approved job route, payer policy, and viewer contract. It cannot define or grant those authorities. The [runtime revision](/Users/westbrook/Documents/repos/codex/docs/forma-experience-runtime-proposal-2026-09-02.md) specifies the declarative definition, LLM proposal process, validation, versioning, and publication rules. It is not an arbitrary user-authored agent prompt.

The recipe should use existing typed contexts wherever possible. If the story knowledge graph or musical contour needs richer structured metadata, introduce a small versioned schema and compiler support explicitly. Do not invent unvalidated event or relation types in the browser.

### Data and API boundaries

- Keep incomplete input in a local typed context draft with stable IDs. On approved persistence, write canonical events; a separate mini-app content database is unnecessary. All edits update the corresponding context decision rather than rebuilding one giant prompt.
- Persist `source_surface`, recipe version, and generation lineage. Keep campaign attribution and marketing consent outside model-facing creative context.
- Persist the complete aggregate before generation. Existing `appendBatch` can report partially accepted events; either add a narrow atomic aggregate-create operation or verify every expected record/revision before issuing an execution grant.
- Browser requests select an authorized draft and allowed operation. The worker reconstructs source truth from authorized records. Never accept a client-computed “final prompt,” arbitrary event batch, model, provider URL, payer, or cost as authority.
- Freeze the Document revision and verified asset hashes at admission. A subsequent edit requires a new reviewed request; it cannot mutate an already-authorized provider call.
- Reuse durable job status, checkpoints, moderation, private media storage, cancellation semantics, and usage settlement. A tiny frontend does not justify a second generation backend.
- Use a narrow client library for these routes. Do not load the full Forma store and authenticated application just to reuse one method.

Suggested API responsibilities, not existing endpoint names: create/update a constrained draft; preflight its recipe; admit a sponsored attempt; read/cancel that exact job; read its private result; claim the exact Document; explicitly publish a selected output. Each operation gets its own authorization check.

### Memory and continuity

Memory should make the handoff useful without making the public experience invasive:

1. Guest decisions are document-local. Do not infer a durable identity or create an account-wide taste profile from an anonymous session.
2. Claiming a Document retains all authored decisions, reference provenance, and generation inputs. This alone delivers continuity.
3. Existing signed-in users may apply permitted saved preferences with a clear “Saved preferences: On” status and an off switch. Do not silently mix private account memory into a shared project.
4. “Save preferences” can later promote selected choices through Forma's explicit preference/reuse mechanisms. Marketing consent and persistent-memory consent are separate decisions.
5. The mini-apps should produce ordinary canonical events for future shared memory services, not eight independent memory systems. A saved 3D camera view is explicit asset provenance, not an inferred preference or account memory.

Current authored preferences and tentative taste are implemented in [taste.ts](/Users/westbrook/Documents/repos/codex/src/model/taste.ts:51). The [scope-aware memory plan](/Users/westbrook/Documents/repos/codex/docs/forma-scope-aware-memory-plan-2026-09-02.md:3) explicitly remains a proposal; unified semantic recall, consolidation, and nested scopes must not be presented as available launch features. Also resolve the structured-fact serialization defect in inferred taste before using that path to personalize a public funnel.

## Low authentication without an open spending endpoint

### Recommended target policy

| Moment | Requirement |
| --- | --- |
| Browse examples and compose | No account; no provider work |
| First eligible image, story, scene, or deck | Small sponsored guest allowance, server-validated anti-abuse checks, strict output ceiling |
| Storyboard, video, audio, or 3D model | Passwordless email verification before the sponsored job, unless a tightly limited experiment justifies anonymous spend |
| View/download completed work | Existing session authority; no surprise reveal gate |
| Edit in Forma | Existing authentication, or authenticate and securely claim the same Document |
| Further generation | Explicit normal Forma authorization and billing rules |

For a lower-risk first beta, verify identity before **all** paid generation and relax only the inexpensive recipes after the guest ownership and quota system passes adversarial tests. A passwordless public identity path is itself new integration work: current Forma authorization uses trusted identity, not a ready-made anonymous or email-OTP account system.

Do not ask for a payment card for a sponsored result. State the scope and payer factually: “1 clip · 4 s · Silent · Sponsored” and “No charge.” Existing paid-media confirmations cannot simply be set to true by the mini-app. Add an explicit, audited sponsor payer and consent path; preserve user, organization, and platform governance. A visitor is the creative actor, not the campaign's billing identity.

### The admission grant

Use two admission stages. First, issue a small, bounded **intake allowance** for draft storage, uploads, and any explicitly permitted parsing; these operations help produce the validated source graph. Then, before planner/render/repair calls, issue a short-lived server-stored **generation grant** binding:

- principal/guest session, app and recipe version;
- project, Document, exact source revision and asset digests;
- output kind, count, duration, resolution, and approved provider route;
- total planner/render/repair call ceilings, token ceiling, and cost reservation;
- sponsor campaign, expiry, and unique consumption identity.

Atomically consume the grant and reserve allowance with durable execution admission. The sponsor quota ledger tracks campaign entitlement; existing token/cost reservation and settlement remain the financial authority, not a second parallel billing ledger. Use an outbox or equivalent reconciliation if the queue is outside the database transaction. A signature alone does not make a capability one-use. Replaying an identical request returns the same job; the same key with changed inputs is a conflict.

Apply limits to **planning, parsing, uploads, email codes, status polling, downloads, and provider calls**, not just final generation. “One result” may require several paid calls. Reuse the design of Forma's existing [bounded execution controls](/Users/westbrook/Documents/repos/codex/worker/output-execution-control.ts:52) and [call-slot ledger](/Users/westbrook/Documents/repos/codex/worker/output-requirements-ledger.ts:187), while recognizing that generalizing them into eight-type sponsored admission is new work. For 3D, bind endpoint, exact compiled text, image order/digests, geometry/material/texture settings, add-ons, and the full asset-transfer envelope; a client cannot upgrade a sponsored model into a more expensive recipe.

### Layered controls

- Provider credentials remain server-side. Mini-apps cannot proxy arbitrary prompts, provider URLs, models, resolutions, or durations.
- Secure, HttpOnly, appropriately SameSite session cookies; explicit CSRF protection; strict allowed origins. CORS is not a consumption control.
- One active job per guest, short-window quotas, account/session limits, cautious network risk signals, a shared campaign budget across all eight apps, and an operational kill switch.
- Treat challenges as signals, not identities. If using Turnstile, validate on the server and check hostname/action. Cloudflare documents five-minute, single-use challenge tokens; the independent generation grant is still required. [Cloudflare server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- Enforce request sizes, output cardinality, execution time, and third-party spending ceilings. OWASP explicitly includes unrestricted third-party spend and OTP/email amplification within resource-consumption risks. [OWASP API4](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
- A failed or cancelled local request never automatically restores a spent provider-call allowance. Reconcile uncertain submissions and preserve already-completed checkpoints.
- No model work on page views, slider changes, sample selection, share visits, or polling. No background creative retry merely to improve an aesthetic score.

An anonymous public generator cannot reliably guarantee “one free result per human.” The engineering guarantee should be **bounded authorized spend, isolated private work, and a measured abuse budget**, not impossibility of abuse. Email verification reduces some abuse but does not eliminate farms or replay attempts.

## The same-Document handoff

“Edit in Forma” is a custody operation followed by navigation, not just a link to the home page.

Current creative streams, private content, and media namespaces are owner-scoped. For generated guest work, implement and test an explicit adoption/custody layer:

1. Authenticate the destination principal while preserving proof of the guest session.
2. Prove access to the exact guest Document. A public share URL is never claim authority.
3. Compare-and-swap the unclaimed record into a recoverable **claiming lease**, not final ownership. Preserve project, Document, block, relation, artifact, and lineage identities.
4. Prepare every private-content/media manifest, not merely a displayed owner field. If R2 objects must move, stage and verify copies first; R2 and D1 do not form one transaction. An interrupted lease resumes or expires without publishing partial custody.
5. Commit the authoritative ownership/manifests, completed claim, and guest-authority revocation together in the transactional authority, then rotate session credentials. Repeated claims by the same account are idempotent; competing claims fail.
6. Navigate to the existing [canonical Document route](/Users/westbrook/Documents/repos/codex/src/model/routes.ts:107), focused on the existing output. Add a narrow result-focus route/state if the chosen view does not already expose one.

For 3D adoption, include the model, embedded or auxiliary textures, manifest, preview/poster, and any authorized saved-view receipts. Preserve or deliberately rebind every dependent reference under the same custody operation. Transferring only the thumbnail is not a successful model handoff. Keep incidental mini-app viewing angles out of persistent saved-view authority.

For generation already authenticated as the **canonical Forma principal**, there is no guest asset claim: use the same principal and same Document directly. An email code alone does not establish that identity. Current Forma identity uses a trusted subject; a new passwordless entrance needs explicit, verified account linking. Never merge accounts just because their email strings match. The simpler canonical-principal path is a strong reason to authenticate earlier in the initial beta.

Resolve Creator eligibility and terms before advertising a guaranteed full-Forma handoff. Email verification must not bypass current workspace identity policy, pilot admission, or organization permissions; a public campaign needs an intentional admission path rather than sending successful users into an access-denied screen.

On arrival, show the work first and a small “Creative choices” area containing the decisions already made. The next action is refining or extending the Document—not entering a project name again. Existing-account users should never be forced to create a duplicate account.

## Privacy and public sharing

- Work is private until the creator explicitly shares it. Explain provider transfer plainly without exposing internal block terminology.
- Proposed guest retention: seven days, disclosed before generation, with deletion available. Confirm operational/legal retention policy before release; expired unclaimed data and derived indexes must actually be purged. Keep minimal required spend/audit receipts separately from erasable creative bodies.
- Add an **output-only** public projection. Existing document sharing can include context blocks; publishing that response unchanged would expose more than the mini-app promise implies. Require verified publishing authority for public links; downloading one's own completed work should not become a signup trap.
- A share contains only the deliberately selected output, safe title, allowed media, and restrained Forma attribution. Exclude uploaded source images, private evidence, prompts, memory, email, and claim tokens.
- A model share includes only the approved output asset and dependencies it needs to render. Inspect asset metadata and embedded resources; do not expose input reference images, private scene compositions, or saved-view source receipts merely because they belong to the same Document.
- Revocable read-share, generation, and claim credentials are distinct. Do not make an export acknowledgment imply public sharing or enterprise release approval.
- Preserve existing review/export rules where they apply. Personal sponsored previews need an explicit policy, not a bypass of shared-project review controls.
- Do not store creative input in marketing analytics or session replay. Operational provenance remains in Forma's governed data boundary.

## Performance and component strategy

Use same-origin entry routes such as `/make/image`, `/make/audio`, and `/make/model3d` as illustrative aliases into the shared runtime. Load only the selected definition and its registered component/viewer modules; do not download the other experiences or the authenticated workspace shell.

### Reuse

| Need | Starting point | Integration rule |
| --- | --- | --- |
| Theme, typography, spacing, icons | Forma design tokens and primitives | Use the existing warm-neutral, sans-serif language and preference-aware light/dark theme |
| Fields and explicit choices | Native form components and `forma-ui-choice-card` | Keep real labels, native submission, touch targets, and no chat composer |
| Dialogs and verification | Public-safe native-dialog foundation | Preserve focus restoration, Escape behavior, reduced motion, and language |
| Isolated presentation | `FormaPresentationalElement` | Data in, user intents out; do not import private store state |
| Slide rendering | Presentational slide renderer | Supply safe, validated content; load export conversion only on request |
| Audio/video | Existing playback primitives/native media | Authenticated media URLs; user-initiated playback; no decorative autoplay |
| 3D inspection | Prerequisite branch's model viewer and asset validators | Extract a public-safe viewing surface; omit saved-view authoring and context mutation; lazy-load the renderer only when needed |
| Distinctive interactions | Qualified spatial/relationship/sequence/profile variants | Register typed context bindings, local previews, and mobile/tap/keyboard contracts; no per-recipe scripting |

Sources: [component guidance](/Users/westbrook/Documents/repos/codex/docs/components.md:1), [presentational boundary](/Users/westbrook/Documents/repos/codex/src/components/presentational-element.ts:5), [public-share entry](/Users/westbrook/Documents/repos/codex/src/apps/public-share/entry.ts:7).

Do not mount `forma-document-artifacts` or other store-coupled workspace organisms wholesale on a public route. Extract/reuse their safe renderers and shared controls; public isolation and transfer size are part of the component contract.

### Proposed performance acceptance targets

- **At p75, mobile and desktop separately:** LCP ≤ 2.5 seconds, INP ≤ 200 ms, CLS ≤ 0.1. These are the published good Core Web Vitals thresholds, not measurements of these unbuilt apps. [Web Vitals](https://web.dev/articles/vitals)
- **Initial first-party JS target:** ≤ 90 KB compressed per mini-app route. Measure third-party verification and total transfer separately rather than hiding them outside the performance report. Revisit this budget against the actual shared bundles.
- Static/edge-rendered landing and examples; system or carefully subsetted existing fonts; fixed media dimensions to prevent layout shifts.
- No account bootstrap, private stream hydration, semantic retrieval, or giant localization catalog before it is needed. Load only the current language and current medium.
- Debounced local draft updates. Persist at meaningful checkpoints; do not append an immutable event for every pointer-move pixel.
- Lazy-load result viewers and PDF/PPTX conversion. Do not fetch full media or decode audio merely to show an input control.
- For 3D, initial composition uses a lightweight schematic, not the full GLB viewer. Load geometry once, bound pixel ratio and texture decode budgets, render on interaction rather than a perpetual animation loop, and dispose GPU resources when leaving the result. Keep an accessible description, poster, and download available without WebGL. Measure the lazy viewer separately from the initial-route JS budget.
- Resume durable jobs after refresh; use bounded backoff polling or an explicitly supported event channel. Slow provider work must not freeze the interface.
- Measure **time to meaningful first decision** separately from **time to complete generated result**. The former is a UI target; the latter depends on the chosen provider and queue. Publish measured per-recipe latency only after qualification.

Accessibility is not an advanced mode: every spatial operation needs a native selection/move alternative, every result needs a usable reading/listening equivalent, controls must fit at 320px and high zoom, and reduced-motion preferences must be respected. Carry Forma's existing language and direction support into the shared shell. The mobile/touch contract above is part of the component API and acceptance criteria, including hybrid-input tablets—not a final responsive-CSS pass.

## Marketing and lead generation

The free result should prove a specific Forma strength:

- Image: a reference, a composition, and a boundary can coexist.
- Short story and Scene: relationships and creative intent matter beyond a style preset.
- Slides: the output retains the argument's evidence.
- Storyboard and Video: continuity and direction remain attached to media.
- Audio: a musical intention belongs to a larger creative work.
- 3D model: one retained object can supply deliberate, traceable image views for later visual work without becoming an unrelated exported file.

Use one index page for discovery, with medium-specific campaign/search entrances landing directly in the relevant activity. The mini-app itself is the landing experience. No compulsory tour, account dashboard, or broad format picker is needed.

After the result, **Edit in Forma** should offer more creative scope, not rescue missing value. The continuity label is “Same document · Output + creative choices.” Keep sharing opt-in and do not place lead forms over the work. Marketing email is a separate, unselected opt-in; transactional code delivery is not newsletter permission.

### Funnel and measurement

```text
Relevant visit → meaningful input → admitted attempt → completed output
             → output inspected → Edit in Forma → same Document opened
             → meaningful edit/new authorized output → return use
```

Measure per mini-app and recipe version:

- completion rate from first meaningful decision;
- output usefulness feedback, collected without silently changing memory;
- verified same-Document handoff success;
- meaningful activation after handoff, rather than a button click alone;
- seven-day return use;
- sponsor cost per useful completed output and per activated creator;
- abandonment at verification, failure rate, provider latency, and prevented/observed abuse.

Set launch thresholds after a small real pilot rather than inventing conversion projections. As a decision rule, a mini-app earns wider distribution by producing useful work and activated Forma users within its acquisition-spend ceiling—not by collecting the most email addresses.

## Delivery sequence

The [runtime delivery sequence](/Users/westbrook/Documents/repos/codex/docs/forma-experience-runtime-proposal-2026-09-02.md) adds compiler/catalog qualification, release compatibility, and proposal-only LLM authoring to the shared foundation. The prerequisite and medium release order below remain in effect; phases deliver definitions and reusable extensions, not independent app implementations.

### Prerequisite. Complete Add 3D model contexts

The named upstream task is **Add 3D model contexts** (task ID `01a059a1-f735-7421-9876-6b87c7d301f3`). Its committed feature is on `codex/3d-model-contexts` at `f2025c6`; the feature branch is not an ancestor of `main` at this review.

The latest upstream merge-readiness review reports three remaining integration concerns: the local migration runner rejects the 3D migration, six Library/reuse tests need image-metadata expectation updates, and older uncommitted migration tooling on `main` needs reconciliation. These are reported upstream findings, not failures rerun in this planning task.

The dependency clears when the upstream work is integrated into the agreed shared release baseline, migration setup/upgrades succeed while preserving existing Output grants/assets, affected Library/reuse and 3D tests pass, and model creation/viewing/export/saved-view behavior is verified against that baseline. Rebase the mini-app work on that result. A feature commit, standalone fixture, or successful provider submission alone does not clear this gate. Do not merge branches, start paid generation, or launch mini-app implementation as part of this proposal update.

```text
Add 3D model contexts: integration + verification
  → shared mini-app admission and same-Document handoff
  → staged eight-output mini-app delivery
```

### 0. Prove the shared path

After the prerequisite clears, build one complete recipe with canonical context persistence, explicit sponsorship, durable generation, private result, and same-Document handoff. Start with verified users. Exercise guest custody separately before anonymous paid generation. Include `model3d` in the recipe/custody contracts from this point even if its public mini-app ships later. This is the principal architectural gate, not visual polish.

Prove this path on a real phone in both iOS Safari and Android Chrome before shipping the first mini-app. Each later delivery phase repeats the medium-specific touch and lifecycle checks; mobile work is not deferred until all eight desktop experiences exist.

### 1. Ship Image and Slides

They demonstrate different Forma strengths—visual direction and grounded argument—and reach distinct audiences. Existing image and slide generation/execution and viewers give them a favorable starting point. Qualify each recipe independently; the image/slides Output Requirements support is helpful but does not replace public admission work.

### 2. Add Short story and Scene

Reuse the canonical admission/handoff path while proving the two distinct narrative interactions. They do not depend on adding native story/scene support to the Output Requirements bridge: use the existing governed document-artifact job route.

### 3. Add 3D model and Storyboard

Use the integrated 3D foundation to qualify the one-object GLB recipe, mobile viewer, asset envelope, and complete model handoff. Qualify storyboard continuity and resumable frame rendering independently. Both use the shared sponsored admission path; neither needs to expose full Forma's advanced asset-management tools.

### 4. Add Audio and Video

Ship these recipes after provider continuation, duration constraints, privacy, and sponsored-spend limits are proven. Video goes last unless a funded campaign makes it strategically important enough to justify the additional qualification work.

Do not assume an eight-app simultaneous launch is necessary. Keep all eight designs coherent, then scale acquisition only after the handoff and cost model work in production. Calendar estimates follow completion of the 3D prerequisite and a short spike on identity, custody, and public-safe bundle extraction; those are larger uncertainties than implementing the input controls.

### Required release tests

1. Every user decision survives round-trip into the same canonical Document and can be understood in Forma; no flattening or silent authority changes.
2. No generated result exists without a complete, frozen authorized source graph.
3. Concurrent/replayed grants, changed input under the same key, expired grants, and forged payer/model/duration fields cannot multiply consumption.
4. Cross-guest reads, job enumeration, source-asset leakage, forged claim proof, competing claims, and partial asset-copy failures are denied/recovered safely.
5. Provider timeout, unknown submission, refresh, cancellation, duplicate callback, and partially completed storyboard do not accidentally repurchase work.
6. Sponsor exhaustion blocks new work without deleting existing results or charging the creator.
7. Public output shares contain neither private inputs nor claim powers; revocation and expiry work.
8. The eight specific output contracts hold: count, format, usable media, text completeness, source fidelity, and retained constraints. Subjective quality needs human review in addition to validators.
9. All key paths pass the mobile/touch matrix below, as well as keyboard, reduced-motion, supported-language, and bundle-isolation checks. Viewport-only screenshots do not satisfy this requirement.
10. Edit in Forma returns the exact Document and output after fresh login, existing-account login, repeated handoff, and an expired guest session where recovery is actually authorized.
11. The 3D recipe produces a self-contained, preview-safe GLB inside its actual geometry/texture/transfer budget. Invalid or viewer-unsafe assets, missing textures, external resource URIs, WebGL failure, and oversized provider files have truthful recovery without repurchasing the job.
12. Model adoption and later saved-view reuse preserve the full asset graph, source rights, model/camera/pixel hashes, and frozen reference order. Orbiting a mini-app result neither changes a saved view nor authorizes pixels for another generation.

### Mobile and touch release matrix

Record device, OS, browser version, input mode, viewport, network condition, and actual outcome. Use representative authorized fixtures for interaction tests; live provider quality/cost qualification is separate. Do not describe an emulated narrow desktop window as a real-device pass.

| Area | Required checks |
| --- | --- |
| Devices and layouts | Small iPhone/Safari and mid-range Android/Chrome; iPad/tablet touch; tablet split view and keyboard/trackpad switching; 320/360/390/430px layout checks; portrait, landscape, safe areas, and dynamic browser chrome. Pin supported OS/browser versions for each release. |
| Touch operation | Complete every app with taps only; measure both target dimensions and overlap; cancelled gestures, rapid double taps, duplicate keyboard submission, two-tab submission of the same intent, scroll across interactive previews, native back/edge gestures, and pointer handoff between touch and mouse. No unwanted creative change or second job. |
| Text and access | On-screen keyboard, paste, email-code autofill, IME composition, long names/evidence, 200% text size, 400% desktop zoom/reflow, Arabic RTL, VoiceOver, TalkBack, and reduced motion. Focus, errors, source disclosures, and primary actions remain reachable. |
| Files and delivery | Photo/file picker cancellation, camera permission denial, rotated/unsupported phone photos, interrupted upload, actual byte/texture limits, download handling, unsupported file sharing, asynchronous Share preparation, and share-sheet cancellation. Nothing becomes public implicitly. |
| Identity and recovery | App-switch to email, same-tab code, magic link in a different browser, embedded-browser exit, a different account already signed in, expired session/code, revoked access, link prefetch, refresh, offline transition, app termination, and lost submission response. Resume the same authorized Document/job or show an honest recovery boundary. |
| Media and 3D | Native inline/fullscreen playback, audio interruption, seeking, orientation changes, low-memory devices, unavailable/lost WebGL, hidden/offscreen rendering, one active viewer, repeated open/close, and identity/Document changes during an asset load. Reject stale loads; no auto-purchase, autoplay restart, or accidental saved camera view. |
| End-to-end activation | Complete generation using the test admission path, inspect the complete output, download or explicitly share, authenticate, and open the same Document in full Forma on each supported phone browser. Preserve the selected result and creative choices. |

## Key decision

**Complete Add 3D model contexts first.** Then the strongest initial mini-app experiment remains **Image + Slides as the first two definitions of one shared runtime and secure handoff path**, with 3D model included in the eight-output architecture and staged rollout. Treat the other six as distinctive experiences to qualify next, rather than eight obligatory simultaneous launch surfaces. Their job is to make Forma's structured creative direction tangible in a few consequential decisions—and leave the user with work worth continuing.

## Wireframe verification

The accompanying interactive wireframes were checked in the browser across all eight apps, three review states, two themes, and two widths (736px and 360px): 96 combinations, with no detected horizontal overflow and an **Edit in Forma** action on every result. Representative interaction checks covered composition choices, scene knowledge, evidence ordering and slide selection, storyboard reveal placement and enlargement, audio contour changes, video schematic playback, and retained choices in the simulated Document view. The added 3D flow was checked for object/proportion/surface/reference retention, viewing-only angle changes, verification preflight, and removal of creation controls after generation. Script syntax also passed; the wireframes make no network or provider calls.

These checks establish mockup behavior, not production readiness. Source uploads, generation, identity verification, billing, ownership adoption, real media playback, exports, and persistent memory require the implementation and release tests above. Text and media are illustrative; 3D visuals are schematics, not generated meshes. The text-only preview download is not a production export adapter.

**Mobile review boundary:** The 96 checks are viewport/layout checks, not evidence of real touch, phone keyboards, OS file sharing, mobile authentication, or device GPU behavior. The current wireframes provide stacked layouts and some coarse-pointer sizing, but further mockup work must show tap-based audio alternatives, scroll-safe expanded image/3D inspection, explicit slide navigation/read-only text, and full target sizing including disclosures and narrow icon buttons. The mobile/touch specifications and release matrix above are required delivery work, not newly verified implementation.
