import { ref } from "lit/directives/ref.js";
import { retainedImageSourceMessage } from "../experiences/retained-image-source-message.ts";
import { createVideoOutputContract, type VideoOutputContract } from "../model/output-video-contract.ts";
import { readVideoReferencePlan } from "../experiences/video-reference-plan.ts";
import { captureExperienceVideoTarget, verifyExperienceVideoRead } from "../experiences/video-native-result.ts";
import type { mountNativeRetainedVideo, NativeVideoPresentation } from "./native-retained-video.ts";
import { captureExperienceModel3dTarget, experienceModel3dContract, verifyExperienceModel3dRead } from "../experiences/model3d-native-result.ts";
import { model3dTermIsInterfaceCopy } from "../experiences/model3d-native-copy.ts";
import type { Model3dOutputContract } from "../model/output-model3d-contract.ts";
import { model3dMiniAppCostApprovalMatches } from "../model/model3d-mini-app-consent.ts";
import type { ExperienceModel3dCostApproval } from "../experiences/output-binding-contract.ts";
import type { renderNativeRetainedModel3d } from "./native-retained-model3d.ts";
import { captureExperienceAudioTarget } from "../experiences/audio-target.ts";
import { verifyExperienceAudioInput } from "../experiences/audio-native-result.ts";
import { createAudioOutputContract, type AudioOutputSource } from "../model/output-audio-contract.ts";
import { audioMiniAppCostApprovalMatches } from "../model/audio-mini-app-consent.ts";
import type { renderNativeRetainedAudio, NativeRetainedAudio } from "./native-retained-audio.ts";
import { keyed } from "lit/directives/keyed.js";
import { captureOutputNavigationFocus } from "./output-navigation-focus.ts";
import { digest } from "../experiences/compiler.ts";
import { captureExperienceSceneTarget } from "../experiences/scene-target.ts";
import { createSceneOutputContract, type SceneOutputSource } from "../model/output-scene-contract.ts";
import { sceneMiniAppCostApprovalMatches, type SceneMiniAppCostApproval } from "../model/scene-mini-app-consent.ts";
import { readExperienceNativeScene } from "../experiences/scene-native-result.ts";
import { captureExperienceStoryboardTarget, verifyExperienceStoryboardRead } from "../experiences/storyboard-native-result.ts";
import type { StoryboardOutputSource } from "../model/output-storyboard-contract.ts";
import type { renderNativeRetainedStoryboard } from "./native-retained-storyboard.ts";
import type { renderNativeRetainedScene, NativeRetainedSceneLabels } from "./native-retained-scene.ts";
import type { RetainedStoryDto } from "../model/retained-short-story.ts";
import type { renderNativeRetainedStory } from "./native-retained-story.ts";
import { isExperienceStoryTarget, verifyExperienceStoryRead } from "../experiences/story-result.ts";
import "./forma-retained-short-story.css";
import { html, nothing, type PropertyValues } from "lit";
import { FormaElement } from "./forma-element";
import { navigateInApp, type CommandDeparture } from "./command-departure";
import { OutputDirectActivationLatch, outputPaidDecisionKey, type OutputPaidDecision } from "./output-direct-activation";
import { artifactFocusRoute, libraryFocusRoute } from "../model/routes";
import type { FormaStore } from "../state/store";
import type { NativeRetainedOutputDto } from "../model/native-retained-output.ts";
import type { renderNativeRetainedSlides } from "./native-retained-slides.ts";
import { registeredExperience, type ExperiencePlan } from "../experiences/intake.ts";
import { ExperienceIntakeRuntime } from "../experiences/intake-runtime.ts";
import { parseExperienceHostRoute, withExperienceReportFlag, type ExperienceHostSelection } from "../experiences/host-route.ts";
import { ExperienceHostOperation } from "../experiences/host-operation.ts";
import type { ExperienceForegroundOperation } from "../experiences/output-transport-lifetime.ts";
import { ExperienceHostSourceLifetime } from "../experiences/host-source-lifetime.ts";
import { experienceImageFormat } from "../experiences/image-ratio.ts";
import { bindingJson, experienceResultGrantCurrent, ExperienceOutputBindingClient, type ExperienceBindingAction } from "../experiences/output-binding-client.ts";
import type { ExperienceAudioCostApproval, ExperienceNativeState } from "../experiences/output-binding-contract.ts";
import { outputTerms, outputTermsNotice, type OutputTerms, type OutputTermsRow, type OutputTermsNotice } from "../experiences/output-terms.ts";
import { outputAvailabilityMessage, outputSourceCapacityMessage } from "../experiences/output-availability-message.ts";
import { FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES } from "./design-system/locales/output-delivery-runtime-messages.ts";
import { captureExperienceNativeResult, type ExperienceResultCandidate } from "../experiences/native-result-association.ts";
import "../experiences/host.css";

type Binding = {
  selection: ExperienceHostSelection; plan: ExperiencePlan; store: FormaStore; route: string; ownerId: string;
  source: ReturnType<FormaStore["captureSourceOwnership"]>; authorization: ReturnType<FormaStore["captureAuthorizationScope"]>;
  revision: string; client: ExperienceOutputBindingClient;
  sceneSource: SceneOutputSource | null; sceneContractDigest: string | null;
  storyboardSource: StoryboardOutputSource | null;
  audioSource: AudioOutputSource | null;
  videoContract: VideoOutputContract | null;
  model3dContract: Model3dOutputContract | null;
};
type Video = Extract<NativeRetainedOutputDto, { output: "video" }>;
type Model3d = Extract<NativeRetainedOutputDto, { output: "model3d" }>;
type Audio = Extract<NativeRetainedOutputDto, { output: "audio" }>;
type Slides = Extract<NativeRetainedOutputDto, { output: "slides" }>;
type Storyboard = Extract<NativeRetainedOutputDto, { output: "storyboard" }>;
type Image = NonNullable<Awaited<ReturnType<FormaStore["loadGeneratedImageEdit"]>>>;
type Scene = NonNullable<Awaited<ReturnType<typeof readExperienceNativeScene>>>;
type Result = { lease: object; candidate: ExperienceResultCandidate; current(): boolean } & ({ output: "model3d"; model3d: Model3d; render: typeof renderNativeRetainedModel3d } | { output: "video"; video: Video; mount: typeof mountNativeRetainedVideo } | { output: "audio"; audio: Audio; render: typeof renderNativeRetainedAudio } | { output: "storyboard"; storyboard: Storyboard; render: typeof renderNativeRetainedStoryboard } | { output: "image"; image: Image } | { output: "slides"; slides: Slides; render: typeof renderNativeRetainedSlides } | { output: "short_story"; story: RetainedStoryDto; render: typeof renderNativeRetainedStory } | { output: "scene"; scene: Scene; measurement: unknown; render: typeof renderNativeRetainedScene });

/** Same-Document native admission view. All original command/grant identities are
 * retained by the server; mounting and recovery read them without admitting work. */
export class FormaExperienceHost extends FormaElement {
  #epoch = 0;
  #navigationEpoch = 0;
  #commandFocusReveal: (() => Promise<void>) | null = null;
  #retired = false;
  #loading = true;
  #busy = false;
  #refreshing = false;
  #runtime?: ExperienceIntakeRuntime;
  #binding?: Binding;
  #confirmed = false;
  #approval = false;
  #sceneApproval = false;
  #audioApproval = false;
  #model3dApproval = false;
  #latch = new OutputDirectActivationLatch();
  #sourceLifetime = new ExperienceHostSourceLifetime();
  #operation?: ExperienceHostOperation;
  #status = "Checking Document";
  #result?: Result;
  #videoPresentation?: NativeVideoPresentation;
  #videoResult?: Result;
  #videoNode?: HTMLElement;
  #mountVideo = (node?: Element) => {
    const next = node instanceof HTMLElement ? node : undefined;
    if (next !== this.#videoNode) {
      this.#videoPresentation?.dispose(); this.#videoPresentation = undefined; this.#videoResult = undefined;
    }
    this.#videoNode = next;
  };
  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    // Lit ref runs before its new fragment is connected. The leaf deliberately
    // refuses detached roots, so mount only after the host's DOM commit.
    const node = this.#videoNode, result = this.#result;
    if (node?.isConnected && this.contains(node) && result?.output === "video" && this.#visible() && result.current()) {
      if (this.#videoResult === result && this.#videoPresentation) { this.#videoPresentation.refresh(); return; }
      this.#videoPresentation?.dispose(); this.#videoResult = result;
      this.#videoPresentation = result.mount(node, result.video, {
        locale: this.i18n, isCurrent: () => this.#videoNode === node && this.#result === result && this.#visible() && result.current(),
      });
    } else {
      this.#videoPresentation?.dispose(); this.#videoPresentation = undefined; this.#videoResult = undefined;
    }
  }
  #imageLoaded = false;
  #imageNode?: HTMLImageElement;
  #deadline?: ReturnType<typeof setTimeout>;
  #resultRead?: ReturnType<typeof setTimeout>;
  #reader?: AbortController;
  #storyUnsubscribe?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener("focusout", this.#focusOut);
    this.ownerDocument.addEventListener("visibilitychange", this.#visibility);
    this.ownerDocument.defaultView?.addEventListener("pagehide", this.#pagehide);
    this.#storyUnsubscribe = this.store.subscribe(this.#storySync);
    this.ownerDocument.defaultView?.addEventListener("forma-authorization-changed", this.#storyWithdraw);
    this.ownerDocument.defaultView?.addEventListener("forma-event-source-retired", this.#storyWithdraw);
    void this.#load();
  }
  override disconnectedCallback() {
    this.#retire();
    this.removeEventListener("focusout", this.#focusOut);
    this.#storyUnsubscribe?.(); this.#storyUnsubscribe = undefined;
    this.ownerDocument.defaultView?.removeEventListener("forma-authorization-changed", this.#storyWithdraw);
    this.ownerDocument.defaultView?.removeEventListener("forma-event-source-retired", this.#storyWithdraw);
    this.ownerDocument.removeEventListener("visibilitychange", this.#visibility);
    this.ownerDocument.defaultView?.removeEventListener("pagehide", this.#pagehide);
    super.disconnectedCallback();
  }
  #beginOperation(foreground?: ExperienceForegroundOperation) {
    this.#stopResultRead();
    this.#navigationEpoch++;
    this.#operation?.cancel();
    const operation = new ExperienceHostOperation(() => {
      if (this.#operation !== operation) return;
      this.#operation = undefined; this.#binding?.client.dispose(); this.#clearResult(); this.#resetDecision();
      this.#busy = false; this.#loading = false; this.#refreshing = false; this.#status = "Operation unconfirmed"; this.requestUpdate();
    }, undefined, foreground);
    this.#operation = operation; return operation;
  }
  #operationCurrent(operation: ExperienceHostOperation) { return this.#operation === operation && operation.current(); }
  #finishOperation(operation: ExperienceHostOperation) {
    if (this.#operation !== operation) return false;
    operation.finish(); this.#operation = undefined; return true;
  }
  #resetDecision() { this.#confirmed = false; this.#approval = false; this.#sceneApproval = false; this.#audioApproval = false; this.#model3dApproval = false; this.#latch.clear(); }
  #clearResult() {
    this.#videoNode = undefined;
    this.#videoPresentation?.dispose();this.#videoPresentation=undefined;this.#videoResult=undefined;
    this.#reader?.abort(); this.#reader = undefined; this.#result = undefined; this.#imageLoaded = false;
    this.#imageNode?.removeAttribute("src"); this.#imageNode = undefined;
    for (const node of this.querySelectorAll<HTMLImageElement>("img[data-experience-image], img.native-retained-storyboard-image")) node.removeAttribute("src");
    for (const node of this.querySelectorAll<NativeRetainedAudio>("forma-native-retained-audio")) { node.result = null; node.remove(); }
    for (const node of this.querySelectorAll("forma-model3d-viewer")) node.remove();
    // Remove private prose now, not on a later Lit render. A fresh result lease
    // keys the next subtree so a cleared template instance cannot be reused.
    for (const node of this.querySelectorAll(".retained-story-reader, .native-retained-scene-reader, .native-retained-storyboard-reader, .native-retained-model3d-reader")) { node.replaceChildren(); node.remove(); }
  }
  #storySync = () => {
    if (["short_story", "scene", "storyboard", "audio", "video", "model3d"].includes(this.#binding?.selection.output ?? "") && this.#binding && (!this.#current(this.#binding) || this.#result && !this.#result.current())) this.#clearResult();
  };
  #storyWithdraw = () => {
    // These events precede session/source publication; do not wait for Lit.
    if (["short_story", "scene", "storyboard", "audio", "video", "model3d"].includes(this.#binding?.selection.output ?? "")) { this.#status = "Document unavailable"; this.#retire(); this.requestUpdate(); }
  };
  #visibility = () => { if (this.ownerDocument.visibilityState === "hidden") {
    this.#stopResultRead();
    this.#navigationEpoch++;
    this.#resetDecision(); this.#clearResult(); this.#binding?.client.dispose(); this.#operation?.cancel(); this.#operation = undefined;
    this.#busy = false; this.#loading = false; this.#refreshing = false; this.requestUpdate();
  } };
  #pagehide = () => { this.#status = "Closed"; this.#retire(); this.requestUpdate(); };
  #retire() {
    this.#stopResultRead();
    this.#navigationEpoch++;
    if (this.#retired) return;
    this.#retired = true; this.#sourceLifetime.retire(); this.#epoch++; this.#resetDecision(); this.#clearResult(); this.#runtime?.dispose(); this.#binding?.client.dispose(); this.#operation?.cancel(); this.#operation = undefined;
    if (this.#deadline) clearTimeout(this.#deadline); this.#deadline = undefined;
  }
  #baseCurrent(binding: Binding) {
    const store = this.store, session = store.session.get(), projection = store.projection.get();
    return !this.#retired && this.isConnected && store === binding.store && store.route.get() === binding.route
      && Boolean(session && !session.impersonation && !session.projectContext && session.user.userId === binding.ownerId
        && session.policy.accepted && ["creator", "admin"].includes(session.user.role))
      && store.authorizationScopeActive(binding.authorization) && store.sourceOwnershipActive(binding.source)
      && store.documentRouteState(binding.route) === "ready" && store.routeDataReady(binding.route)
      && store.asOf.get() === Number.POSITIVE_INFINITY && projection.documentId === binding.plan.documentId && projection.projectId === binding.plan.projectId
      && projection.documents.filter(document => document.id === binding.plan.documentId && document.projectId === binding.plan.projectId && !document.removed).length === 1;
  }
  #current(binding = this.#binding): binding is Binding {
    return Boolean(binding && this.#baseCurrent(binding) && this.store.projection.get().documents.find(document => document.id === binding.plan.documentId)?.title === binding.plan.title
      && this.store.experienceDocumentSourceCurrent(binding.plan.documentId, binding.revision));
  }
  #readable(binding = this.#binding): binding is Binding { return Boolean(binding && this.#baseCurrent(binding) && this.ownerDocument.visibilityState !== "hidden" && !this.closest("[hidden],[inert]")); }
  #visible(binding = this.#binding): binding is Binding { return this.#current(binding) && this.ownerDocument.visibilityState !== "hidden" && !this.closest("[hidden],[inert]"); }
  #state(): ExperienceNativeState | null {
    const state = this.#binding?.client.state;
    return state && "draftId" in state && this.#current() ? state : null;
  }
  #imageFormat() { return experienceImageFormat(this.#binding?.plan.request.values.ratio?.value); }
  #terms(state = this.#state()) {
    if (!state?.preflight || !state.plan) return null;
    const format = state.output === "image" ? this.#imageFormat() : null;
    if (state.output === "image" && !format) return null;
    return outputTerms(state.preflight, { now: Date.now(), output: state.output, targetId: state.plan.targetId, grant: state.grant, allowRecordedResume: state.permitted.resumeRun === true,
      ...(format ? { expectedImageSize: `${format.dimensions.width}x${format.dimensions.height}` } : {}),
      ...(state.output === "video" && this.#binding?.videoContract ? { expectedVideo: { contract:this.#binding.videoContract,
        actorUserId:this.#binding.ownerId,projectId:this.#binding.plan.projectId,documentId:this.#binding.plan.documentId } } : {}),
      ...(state.output === "storyboard" && this.#binding?.storyboardSource ? { expectedStoryboard: { source:this.#binding.storyboardSource,
        actorUserId:this.#binding.ownerId,projectId:this.#binding.plan.projectId,documentId:this.#binding.plan.documentId } } : {}),
      ...(state.output === "scene" ? { expectedSceneContract: createSceneOutputContract(this.#binding?.sceneSource) ?? undefined,
        expectedSceneContractDigest: this.#binding?.sceneContractDigest ?? undefined, sceneCostPreview: state.sceneCostPreview } : {}),
      ...(state.output === "model3d" ? { expectedModel3dContract: this.#binding?.model3dContract ?? undefined, model3dCostPreview: state.model3dCostPreview } : {}),
      ...(state.output === "audio" ? { expectedAudioContract: createAudioOutputContract(this.#binding?.audioSource) ?? undefined, audioCostPreview: state.audioCostPreview } : {}) });
  }
  #paidDecision(action: "authorize" | "run" | "resumeRun"): OutputPaidDecision | null {
    const state = this.#state(), binding = this.#binding, terms = this.#terms(state);
    if (!binding || !state?.plan || state.current.source !== "verified" || !this.#visible(binding) || this.#busy || !state.permitted[action]
      || !binding.authorization || action === "authorize" && (!this.#approval || !terms?.available || !state.preflight)
      || action !== "authorize" && (!terms?.grantAvailable || !state.original || !state.grant
        || !Number.isFinite(Date.parse(state.original.expiresAt)) || !Number.isFinite(Date.parse(state.original.jobExpiresAt))
        || Date.parse(state.original.expiresAt) <= Date.now() || Date.parse(state.original.jobExpiresAt) <= Date.now()
        || action === "run" && state.original.run !== null || action === "resumeRun" && state.original.run === null)) return null;
    if (state.output === "scene" && action === "authorize" && !this.#sceneConsent(state)) return null;
    if (state.output === "audio" && action === "authorize" && !this.#audioConsent(state)) return null;
    if (state.output === "model3d" && action === "authorize" && !this.#model3dConsent(state)) return null;
    const scope = { authorizationScopeKey: binding.authorization.key, documentId: state.documentId, viewEpoch: this.#epoch,
      planRevisionId: state.plan.revisionId, executionScopeKey: bindingJson({ identity: binding.client.identity, localRevision: binding.revision,
        current: state.current, plan: state.plan, preflight: state.preflight, original: state.original, grant: state.grant, permitted: state.permitted,
        ...(state.output === "scene" ? {sceneCostPreview: state.sceneCostPreview} : {}),
        ...(state.output === "model3d" ? {model3dCostPreview: state.model3dCostPreview} : {}),
        ...(state.output === "audio" ? {audioCostPreview: state.audioCostPreview} : {}) }) };
    return action === "authorize" ? { ...scope, action, preflightId: state.preflight!.id, termsDigest: state.preflight!.termsDigest }
      : { ...scope, action: "run", grantId: state.original!.grantId };
  }
  #arm(event: MouseEvent, action: "authorize" | "run" | "resumeRun") {
    const button = event.currentTarget, decision = this.#paidDecision(action);
    if (!(button instanceof HTMLButtonElement) || !decision) { this.#latch.clear(); return; }
    const token = this.#latch.arm(event, button, decision, this.ownerDocument.defaultView?.navigator.userActivation?.isActive === true);
    if (token !== null) setTimeout(() => this.#latch.expire(token), 0);
  }
  #paidSubmit(event: SubmitEvent, action: "authorize" | "run" | "resumeRun", shownKey: string | null) {
    event.preventDefault();
    const decision = this.#paidDecision(action), state = this.#state();
    if (!decision || !state || shownKey !== outputPaidDecisionKey(decision)
      || !this.#latch.consume(event, decision, this.ownerDocument.defaultView?.navigator.userActivation?.isActive === true)) { this.#latch.clear(); return; }
    const sceneConsent = state.output === "scene" && action === "authorize" ? this.#sceneConsent(state) : undefined;
    if (sceneConsent === null) return;
    const audioConsent = state.output === "audio" && action === "authorize" ? this.#audioConsent(state) : undefined;
    if (audioConsent === null) return;
    const model3dConsent = state.output === "model3d" && action === "authorize" ? this.#model3dConsent(state) : undefined;
    if (model3dConsent === null) return;
    void this.#command(action, state, sceneConsent, audioConsent, model3dConsent);
  }
  #sceneConsent(state: ExperienceNativeState): SceneMiniAppCostApproval | null {
    const preview = state.sceneCostPreview, binding = this.#binding;
    if (!this.#sceneApproval || !preview || !binding || state.output !== "scene"
      || preview.sceneContractDigest !== binding.sceneContractDigest || preview.actorUserId !== binding.ownerId
      || preview.documentId !== binding.plan.documentId || preview.projectId !== binding.plan.projectId) return null;
    const approval = Object.freeze({ ...preview, confirmed: true as const });
    return sceneMiniAppCostApprovalMatches(approval, preview) ? approval : null;
  }
  #audioConsent(state: ExperienceNativeState): ExperienceAudioCostApproval | null {
    const preview = state.audioCostPreview, binding = this.#binding;
    if (!this.#audioApproval || !this.#approval || !preview || !binding || state.output !== "audio"
      || preview.draftId !== binding.plan.draftId || preview.actorUserId !== binding.ownerId
      || preview.documentId !== binding.plan.documentId || preview.projectId !== binding.plan.projectId
      || preview.sourceDigest !== state.current.sourceDigest || preview.requirementsDigest !== state.current.requirementsDigest) return null;
    const approval = Object.freeze({ ...preview, confirmed: true as const, providerTransferConfirmed: true as const });
    return audioMiniAppCostApprovalMatches(approval, preview) ? approval : null;
  }
  #model3dConsent(state: ExperienceNativeState): ExperienceModel3dCostApproval | null {
    const preview = state.model3dCostPreview, binding = this.#binding;
    if (!this.#model3dApproval || !this.#approval || !preview || !binding || state.output !== "model3d"
      || preview.draftId !== binding.plan.draftId || preview.actorUserId !== binding.ownerId
      || preview.documentId !== binding.plan.documentId || preview.projectId !== binding.plan.projectId
      || preview.sourceDigest !== state.current.sourceDigest || preview.requirementsDigest !== state.current.requirementsDigest) return null;
    const approval = Object.freeze({ ...preview, confirmed: true as const, providerTransferConfirmed: true as const });
    return model3dMiniAppCostApprovalMatches(approval, preview) ? approval : null;
  }
  #prepare(event: SubmitEvent) {
    event.preventDefault(); const state = this.#state();
    if (!event.isTrusted || !this.#confirmed || !state?.permitted.prepare || !this.#visible() || this.#busy) return;
    void this.#command("prepare", state);
  }
  #renewPreparation(event: SubmitEvent) {
    event.preventDefault(); const state = this.#state();
    if (!event.isTrusted || !state?.permitted.renewPreparation || !(state.sceneRenewal || state.videoRenewal || state.model3dRenewal) || !this.#visible() || this.#busy) return;
    void this.#command("renewPreparation", state);
  }
  #prepareReplacement(event: SubmitEvent) {
    event.preventDefault(); const state = this.#state();
    if (!event.isTrusted || !state?.permitted.prepareReplacement || !state.model3dReplacement || !this.#visible() || this.#busy) return;
    void this.#command("prepareReplacement", state);
  }
  async #load() {
    const operation = this.#beginOperation();
    let loadedBinding: Binding | undefined;
    const epoch = ++this.#epoch, store = this.store, route = store.route.get(), selection = parseExperienceHostRoute(route), session = store.session.get();
    const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
    const active = () => this.#operationCurrent(operation) && !this.#retired && this.isConnected && epoch === this.#epoch && this.store === store && store.route.get() === route
      && store.authorizationScopeActive(authorization) && store.sourceOwnershipActive(source);
    try {
      if (!selection || !session || !active()) throw new Error("unavailable");
      const release = await operation.wait(registeredExperience(selection.output === "short_story" ? "short-story" : selection.output)); if (!release || !active()) throw new Error("unavailable");
      const runtime = new ExperienceIntakeRuntime(release); this.#runtime = runtime; await operation.wait(runtime.resume(selection.draftId));
      const plan = runtime.committedPlan;
      if (!active() || runtime.state.phase !== "complete" || !runtime.receipt || !plan || plan.documentId !== selection.documentId
        || plan.draftId !== selection.draftId || plan.release.output.output !== selection.output || plan.streamId !== `creative:${session.user.userId}`) throw new Error("unavailable");
      const sceneSource = selection.output === "scene" ? Object.freeze({ draftId: plan.draftId, draftHash: plan.draftHash,
        releaseHash: plan.release.releaseHash, requestHash: await operation.wait(digest(plan.request)),
        sourceBindingHash: await operation.wait(digest({ projectId: plan.projectId, documentId: plan.documentId, events: plan.events })) }) : null;
      const audioSource = selection.output === "audio" ? Object.freeze({ draftId: plan.draftId, draftHash: plan.draftHash,
        releaseHash: plan.release.releaseHash, requestHash: await operation.wait(digest(plan.request)),
        sourceBindingHash: await operation.wait(digest({ projectId: plan.projectId, documentId: plan.documentId, events: plan.events })) }) : null;
      if (audioSource && !createAudioOutputContract(audioSource) || !active()) throw new Error("unavailable");
      const sceneContract = sceneSource ? createSceneOutputContract(sceneSource) : null;
      if (sceneSource && !sceneContract || !active()) throw new Error("unavailable");
      const sceneContractDigest = sceneContract ? await operation.wait(digest(sceneContract)) : null;
      const storyboardSource = selection.output === "storyboard" ? Object.freeze({ draftId: plan.draftId, draftHash: plan.draftHash,
        releaseHash: plan.release.releaseHash, requestHash: await operation.wait(digest(plan.request)),
        sourceBindingHash: await operation.wait(digest({ projectId: plan.projectId, documentId: plan.documentId, events: plan.events })) }) : null;
      if (!active()) throw new Error("unavailable");
      const model3dContract = selection.output === "model3d" ? await operation.wait(experienceModel3dContract(plan)) : null;
      if (selection.output === "model3d" && !model3dContract || !active()) throw new Error("unavailable");
      const videoReference=selection.output==="video"?readVideoReferencePlan(plan.reference,plan.request.reference):null;
      const videoContract=selection.output==="video"?createVideoOutputContract({source:{draftId:plan.draftId,draftHash:plan.draftHash,releaseHash:plan.release.releaseHash,
        requestHash:await operation.wait(digest(plan.request)),sourceBindingHash:await operation.wait(digest({projectId:plan.projectId,documentId:plan.documentId,events:plan.events}))},
        reference:videoReference?.selection,frameSize:plan.request.values.frame?.value==="landscape"?"1280x720":plan.request.values.frame?.value==="portrait"?"720x1280":null}):null;
      if(selection.output==="video"&&!videoContract||!active())throw new Error("unavailable");
      const binding = { selection, plan, store, route, source, authorization, ownerId: session.user.userId, revision: store.documentGenerationRevision(), sceneSource, sceneContractDigest, storyboardSource, audioSource, videoContract, model3dContract } as Binding;
      binding.client = new ExperienceOutputBindingClient({ draftId: plan.draftId, draftHash: plan.draftHash, releaseHash: plan.release.releaseHash,
        documentId: plan.documentId, projectId: plan.projectId, output: selection.output, actorUserId: session.user.userId },
        { origin: this.ownerDocument.location.origin, current: () => this.#binding === binding && this.#readable(binding) && this.store.experienceDocumentSourceCurrent(binding.plan.documentId, binding.revision) });
      this.#binding = binding;
      if (!this.#current(binding)) throw new Error("unavailable");
      await this.#refreshAndRead(binding, operation);
      loadedBinding = binding;
    } catch { if (this.#operationCurrent(operation) && epoch === this.#epoch) this.#status = "Document unavailable"; }
    finally {
      if (this.#finishOperation(operation) && epoch === this.#epoch) {
        this.#loading = false; this.requestUpdate();
        // Read a completed original through the existing guarded result path.
        // No command, recovery, admission or generation is retried on mounting.
        const state = loadedBinding && this.#binding === loadedBinding && this.#visible(loadedBinding) ? this.#state() : null;
        if (!this.#busy && state?.status === "succeeded" && state.original?.jobStatus === "completed") void this.#check();
        else if (loadedBinding) this.#scheduleResultRead();
      }
    }
  }
  /** Expected canonical Output-block hydration may change the local revision.
   * Paid controls stay closed until a new passive server read validates that exact source. */
  async #refreshAndRead(binding: Binding, operation: ExperienceHostOperation) {
    this.#resetDecision(); this.#refreshing = true;
    try {
      await operation.wait(this.store.refreshEvents({ readOnly: true, current: () => this.#operationCurrent(operation) && this.#binding === binding && this.#baseCurrent(binding) }));
      if (!this.#operationCurrent(operation) || this.#binding !== binding || !this.#baseCurrent(binding)) throw new Error("withdrawn");
      const revision = this.store.documentGenerationRevision();
      if (!this.store.experienceDocumentSourceCurrent(binding.plan.documentId, revision)) throw new Error("source_changed");
      binding.revision = revision;
      await operation.wait(binding.client.read());
      if (!this.#current(binding)) throw new Error("withdrawn");
      const state = this.#state(); this.#status = state ? this.#statusLabel(state) : "Original unavailable";
      this.#scheduleDeadline();
    } finally { if (this.#operation === operation) this.#refreshing = false; }
  }
  #statusLabel(state: ExperienceNativeState) {
    if (state.current.source === "changed") return retainedImageSourceMessage(this.i18n.locale);
    if (state.recovery === "pending") return this.i18n.system("Result pending");
    if (state.permitted.recoverResult) return this.i18n.system("Recovery available");
    if (state.status === "unavailable" && state.disposition === "prepared") return this.i18n.system("Generation unavailable");
    return ({ absent: "Confirm output", preparing: "Preparation recorded", review: "Cost and transfer", authorized: "Authorized", queued: "Queued", running: "Creating",
      succeeded: "Completed operation", failed: "Failed", cancelled: "Cancelled", partial: "Partial", uncertain: "Unconfirmed", unavailable: "Original unavailable" } as const)[state.status];
  }
  async #stopVideo(event:MouseEvent) {
    const binding=this.#binding,state=this.#state();
    if(!event.isTrusted||!binding||!this.#visible(binding)||this.#busy||this.#loading||state?.output!=="video"||!state.original||!["queued","running"].includes(state.original.jobStatus))return;
    const jobId=state.original.jobId,operation=this.#beginOperation(),revealFocus=this.#captureCommandFocusVisibility(binding);this.#commandFocusReveal=revealFocus;this.#busy=true;this.#resetDecision();this.requestUpdate();
    try{
      const stopped=await operation.wait(this.store.stopDocumentJob(jobId));
      if(!this.#operationCurrent(operation)||this.#binding!==binding||!this.#baseCurrent(binding))return;
      await this.#refreshAndRead(binding,operation);
      if(this.#operationCurrent(operation))this.#status=stopped?"Stopped · Charges retained":"Stop unconfirmed";
    }catch{if(this.#operationCurrent(operation))this.#status="Stop unconfirmed";}
    finally{if(this.#commandFocusReveal===revealFocus)this.#commandFocusReveal=null;
      if(this.#finishOperation(operation)){this.#busy=false;this.requestUpdate();}
      await revealFocus?.().catch(()=>{ /* The original command owns any status reveal. */ });
    }
  }
  async #command(action: ExperienceBindingAction, shown: ExperienceNativeState, sceneConsent?: SceneMiniAppCostApproval, audioConsent?: ExperienceAudioCostApproval, model3dConsent?: ExperienceModel3dCostApproval) {
    const binding = this.#binding; if (!binding || !this.#visible(binding) || this.#busy || shown !== this.#state()) return;
    const operation = this.#beginOperation({ action, output: binding.client.identity.output }), revealFocus = this.#captureCommandFocusVisibility(binding);
    this.#commandFocusReveal = revealFocus;
    this.#busy = true; this.#resetDecision(); this.#clearResult(); this.#status = action === "recoverResult" ? this.i18n.system("Recovering") : "Recording"; this.requestUpdate();
    let followResult = false;
    try {
      const response = await operation.wait(binding.client.command(action, shown, sceneConsent, audioConsent, model3dConsent));
      // Unknown admission remains unknown. Only explicit Check status recovers it.
      if (!("draftId" in response)) this.#status = outputSourceCapacityMessage(response) ? this.i18n.system("Original unavailable")
        : action === "recoverResult" ? this.i18n.system("Recovery unconfirmed") : "Submission unconfirmed";
      else if (this.#visible(binding)) {
        await this.#refreshAndRead(binding, operation);
        if (action === "recoverResult" && response.recovery === "pending" && this.#state()?.permitted.recoverResult) this.#status = this.i18n.system("Result pending");
        followResult = action === "run" || action === "resumeRun" || action === "recoverResult" && response.recovery === "completed";
        const current = this.#state();
        if ((action === "run" || action === "resumeRun") && this.#operationCurrent(operation) && this.#visible(binding)
          && current?.original && response.original && shown.original && current.disposition === "original_run_recorded"
          && response.disposition === "original_run_recorded" && current.original.run && response.original.run
          && ["queued", "running"].includes(current.status) && ["queued", "running"].includes(response.status)
          && ["queued", "running"].includes(current.original.jobStatus)
          && ["jobId", "slotId", "grantId"].every(key => {
            const field = key as "jobId" | "slotId" | "grantId";
            return current.original![field] === response.original![field] && current.original![field] === shown.original![field];
          }) && bindingJson(current.original.run) === bindingJson(response.original.run)
          && Date.parse(current.original.jobExpiresAt) > Date.now() && Date.parse(current.original.expiresAt) > Date.now()) {
          // Wake the existing scoped read/driver after this verified explicit
          // run, not a new admission, direct job dispatch or passive retry.
          await operation.wait(binding.store.syncDocumentJobs({ freshAfterActive: true }));
        }
      }
    } catch { if (this.#operationCurrent(operation) && this.#baseCurrent(binding)) this.#status = "Original unavailable"; }
    finally { if (this.#commandFocusReveal === revealFocus) this.#commandFocusReveal = null;
      if (this.#finishOperation(operation)) {
      this.#busy = false; this.requestUpdate();
      const continuationEpoch = this.#navigationEpoch;
      await revealFocus?.().catch(() => { /* A withdrawn focus destination cannot prevent the retained read. */ });
      if (followResult && continuationEpoch === this.#navigationEpoch && this.#binding === binding && this.#visible(binding)) {
        const state = this.#state();
        if (state?.status === "succeeded" && state.original?.jobStatus === "completed") void this.#check();
        else this.#scheduleResultRead();
      }
    } else void revealFocus?.().catch(() => { /* The original focus lease still disposes. */ }); }
  }
  #captureCommandFocusVisibility(binding: Binding) {
    const owner = this.ownerDocument, active = owner.activeElement;
    if (!active || !(active instanceof HTMLElement) || !active.isConnected || active.closest("forma-experience-host") !== this) return null;
    const status = this.querySelector<HTMLElement>("[data-experience-status]"), epoch = this.#navigationEpoch;
    if (!status) return null;
    const focus = captureOutputNavigationFocus(owner, { ownedRouteFocus: element => element === status });
    return async () => {
      try {
        await this.updateComplete;
        if (epoch !== this.#navigationEpoch || this.#binding !== binding || !this.#visible(binding)
          || owner.activeElement !== status || !status.isConnected) return;
        focus.run(status, () => {
          const view = owner.defaultView; if (!view || owner.activeElement !== status) return false;
          const box = status.getBoundingClientRect(), style = view.getComputedStyle(status);
          const ring = Math.max(0, parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0) + 2;
          const inViewport = box.width > 0 && box.height > 0 && box.left >= ring && box.top >= ring
            && box.right <= view.innerWidth - ring && box.bottom <= view.innerHeight - ring;
          const hit = inViewport ? owner.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
          if (!inViewport || !hit || !status.contains(hit)) status.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
          return owner.activeElement === status;
        });
      } finally { focus.dispose(); }
    };
  }
  #snapshotMatches(state: ExperienceNativeState) {
    const resource = this.store.outputRequirements.resource(state.documentId), snapshot = resource.snapshot, plan = snapshot?.confirmedPlan;
    const retainedImage = state.output === "image" && state.current?.source === "changed";
    if (!state.original || !state.plan || !snapshot || !plan || resource.state !== "ready" || resource.accessLost || resource.privateUnavailable
      || snapshot.documentId !== state.documentId || snapshot.projectId !== state.projectId || snapshot.scope.kind !== "personal"
      || snapshot.scope.actorUserId !== this.#binding?.ownerId || snapshot.sourceVerification.status !== "verified"
      || !snapshot.permissions.canRequest
      || snapshot.sourceRevision !== (retainedImage ? state.current.sourceDigest : state.plan.sourceDigest)
      || snapshot.requirementRevision !== (retainedImage ? state.current.requirementsDigest : state.plan.requirementsDigest)
      || plan.revisionId !== state.plan.revisionId || plan.sourceDigest !== state.plan.sourceDigest || plan.requirementsDigest !== state.plan.requirementsDigest
      || plan.targetContractDigests[state.plan.targetId] !== state.plan.targetContractDigest || plan.plan.targets.length !== 1
      || plan.plan.targets[0]?.id !== state.plan.targetId || (state.output === "scene" ? !captureExperienceSceneTarget(plan.plan.targets[0], this.#binding?.sceneSource)
        : state.output === "video" ? !captureExperienceVideoTarget(plan.plan.targets[0], this.#binding?.videoContract??null)
        : state.output === "storyboard" ? !captureExperienceStoryboardTarget(plan.plan.targets[0], this.#binding?.storyboardSource)
        : state.output === "model3d" ? !captureExperienceModel3dTarget(plan.plan.targets[0], this.#binding?.model3dContract)
        : state.output === "audio" ? !captureExperienceAudioTarget(plan.plan.targets[0], this.#binding?.audioSource)
        : state.output === "short_story" ? !isExperienceStoryTarget(plan.plan.targets[0]) : plan.plan.targets[0]?.media_kind !== state.output)) return false;
    const grants = snapshot.grants.filter(grant => grant.id === state.original!.grantId);
    return grants.length === 1 && bindingJson(grants[0]) === bindingJson(state.grant);
  }
  #candidate(state: ExperienceNativeState, job: unknown) {
    const original = state.original, p = this.store.projection.get();
    if (!original || !this.#binding) return null;
    return captureExperienceNativeResult({ output: state.output, documentId: state.documentId, projectId: state.projectId, ownerUserId: this.#binding.ownerId,
      jobId: original.jobId, correlationId: original.correlationId, expiresAt: original.jobExpiresAt }, job,
      { documentId: p.documentId, projectId: p.projectId, documents: p.documents, events: this.store.events.get(), outputs: p.libraryOutputs, artifacts: p.artifacts });
  }
  async #check(prepareImage=false) {
    const binding = this.#binding; if (!binding || !this.#readable(binding) || this.#busy) return;
    const operation = this.#beginOperation({action:'inspectResult',output:binding.client.identity.output});
    this.#busy = true; this.#clearResult(); this.#resetDecision(); this.#status = "Checking status"; this.requestUpdate();
    let pending = false;
    try {
      await this.#refreshAndRead(binding, operation);
      const state = this.#state(); if (!state?.original || !this.#visible(binding)) return;
      if (["queued", "running"].includes(state.status) && ["queued", "running"].includes(state.original.jobStatus)) {
        pending = true; return;
      }
      await operation.wait(this.store.outputRequirements.ensure(state.documentId, { force: true }));
      const lease = Object.freeze({});
      const current = () => (this.#operationCurrent(operation) || this.#result?.lease === lease)
        && this.#binding === binding && this.#visible(binding) && this.#state() === state && this.#snapshotMatches(state);
      if (!current()) throw new Error("unavailable");
      const inspected = await operation.wait(this.store.inspectOutputNativeJob(state.documentId, state.original.jobId, current));
      if (inspected.status !== "found" || !current() || !inspected.current()) throw new Error("unavailable");
      if (inspected.job.status !== "completed") {
        this.#status = this.#statusLabel(state); pending = ["queued", "running"].includes(inspected.job.status); return;
      }
      const candidate = this.#candidate(state, inspected.job);
      if (!candidate) throw new Error("unavailable");
      const selected = () => current() && inspected.current() && bindingJson(this.#candidate(state, inspected.job)) === bindingJson(candidate)
        && Date.parse(candidate.expiresAt) > Date.now() && experienceResultGrantCurrent(state, Date.now());
      if (candidate.output === "image") {
        const image = await operation.wait(this.store.loadGeneratedImageEdit(candidate.outputId, { current: selected,prepareSource:prepareImage })),  format = this.#imageFormat();
        if (!image || !selected() || !format || image.status !== "current" || image.revision !== 0 || image.editEventId !== null
          || image.ownerId !== binding.ownerId || image.projectId !== state.projectId || image.documentId !== state.documentId || image.outputId !== candidate.outputId
          || image.generationId !== candidate.generationId || image.sourceEventId !== candidate.eventId || image.contentRef !== candidate.contentRef
          || image.media.url !== candidate.mediaUrl || image.media.mediaType !== "image/png" || image.media.width !== format.dimensions.width || image.media.height !== format.dimensions.height) throw new Error("unavailable");
        this.#result = { lease, output: "image", candidate, image, current: selected }; this.#status = "1 image";
      } else {
        const raw = await operation.wait(this.store.ensurePrivateContent(candidate.contentRef, { force: true }));
        if (typeof raw !== "string" || !selected() || new TextEncoder().encode(raw).length > 1048576) throw new Error("unavailable");
        const hash = Array.from(new Uint8Array(await operation.wait(crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))), byte => byte.toString(16).padStart(2, "0")).join("");
        if (!selected()) throw new Error("unavailable");
        if (candidate.output === "model3d") {
          if (!binding.model3dContract || !state.model3dCostPreview || !state.plan || !state.original || !state.grant) throw new Error("unavailable");
          const input = await operation.wait(this.store.ensurePrivateContent(candidate.inputRef, { force: true }));
          if (!selected()) throw new Error("unavailable");
          const [client, renderer] = await operation.wait(Promise.all([import("../model/retained-short-story-client.ts"), import("./native-retained-model3d.ts")]));
          if (!selected()) throw new Error("unavailable");
          const abort = new AbortController(); this.#reader = abort;
          const visible = () => this.#reader === abort && !abort.signal.aborted && selected();
          const model3d = await operation.wait(client.readNativeRetainedOutput({ output: "model3d",
            selection: { documentId: state.documentId, artifactId: candidate.artifactId, revision: 0, contentSha256: hash } },
            { origin: this.ownerDocument.location.origin, signal: abort.signal, current: visible, request: (path, init) => fetch(path, init) }));
          if (!visible() || model3d.output !== "model3d" || Date.parse(model3d.expiresAt) <= Date.now()
            || !await operation.wait(verifyExperienceModel3dRead(input, candidate.model3d, model3d, {
              contract: binding.model3dContract, costPreview: state.model3dCostPreview, jobId: state.original.jobId, actorUserId: binding.ownerId,
              documentId: state.documentId, projectId: state.projectId, artifactId: candidate.artifactId,
              grantId: state.original.grantId, slotId: state.original.slotId, targetId: state.plan.targetId, planRevisionId: state.plan.revisionId,
              sourceDigest: state.plan.sourceDigest, targetContractDigest: state.plan.targetContractDigest,
              usedMicrousd: state.grant.usedMicrousd, usedCalls: state.grant.usedCalls,
            })) || !visible()) throw new Error("unavailable");
          this.#result = { lease, output: "model3d", candidate, model3d, render: renderer.renderNativeRetainedModel3d,
            current: () => visible() && Date.parse(model3d.expiresAt) > Date.now() };
          this.#status = "1 static GLB · Structure checked; visual review required";
        } else if (candidate.output === "audio") {
          if (!binding.audioSource || !state.audioCostPreview || !state.plan || !state.original || !state.grant) throw new Error("unavailable");
          const input = await operation.wait(this.store.ensurePrivateContent(candidate.inputRef, { force: true }));
          if (!selected()) throw new Error("unavailable");
          if (!await operation.wait(verifyExperienceAudioInput(input, candidate.audio, {
            documentId: state.documentId, projectId: state.projectId, artifactId: candidate.artifactId, jobId: candidate.jobId, plannerResponseId: candidate.plannerResponseId,
            usedMicrousd: state.grant.usedMicrousd, usedCalls: state.grant.usedCalls, source: binding.audioSource, costPreview: state.audioCostPreview, grantId: state.original.grantId, slotId: state.original.slotId,
            planRevisionId: state.plan.revisionId, targetId: state.plan.targetId, targetContractDigest: state.plan.targetContractDigest,
            sourceDigest: state.plan.sourceDigest,
          })) || !selected()) throw new Error("unavailable");
          const [client, renderer] = await operation.wait(Promise.all([import("../model/retained-short-story-client.ts"), import("./native-retained-audio.ts")]));
          if (!selected()) throw new Error("unavailable");
          const abort = new AbortController(); this.#reader = abort;
          const visible = () => this.#reader === abort && !abort.signal.aborted && selected();
          const audio = await operation.wait(client.readNativeRetainedOutput({ output: "audio",
            selection: { documentId: state.documentId, artifactId: candidate.artifactId, revision: 0, contentSha256: hash } },
            { origin: this.ownerDocument.location.origin, signal: abort.signal, current: visible, request: (path, init) => fetch(path, init) }));
          if (!visible() || audio.output !== "audio" || audio.content.inputRef !== candidate.inputRef
            || audio.content.media?.url !== candidate.mediaUrl || audio.content.media.mediaType !== "audio/mpeg"
            || audio.content.media.sha256 !== candidate.audio.mediaSha256 || audio.content.role !== "score" || audio.content.lyrics !== ""
            || Date.parse(audio.expiresAt) <= Date.now()) throw new Error("unavailable");
          this.#result = { lease, output: "audio", candidate, audio, render: renderer.renderNativeRetainedAudio,
            current: () => visible() && Date.parse(audio.expiresAt) > Date.now() };
          this.#status = this.i18n.system("Audio");
        } else if (candidate.output === "scene") {
          if (!binding.sceneSource || !state.sceneCostPreview || state.sceneCostPreview.requestId !== candidate.jobId) throw new Error("unavailable");
          const values = binding.plan.request.values;
          if ([values.characterA?.value, values.characterB?.value, values.location?.value].some(value => typeof value !== "string")) throw new Error("unavailable");
          const displaySource = { characters: [{ id: "A" as const, name: values.characterA.value as string }, { id: "B" as const, name: values.characterB.value as string }] as const,
            location: values.location.value as string };
          const input = await operation.wait(this.store.ensurePrivateContent(candidate.inputRef, { force: true }));
          if (!selected()) throw new Error("unavailable");
          const scene = await operation.wait(readExperienceNativeScene(raw, input, candidate.scene, {
            documentId: candidate.documentId, projectId: candidate.projectId, artifactId: candidate.artifactId, providerResponseId: candidate.providerResponseId,
            source: binding.sceneSource, costPreview: state.sceneCostPreview, displaySource, expiresAt: candidate.expiresAt,
          }));
          if (!scene || !selected()) throw new Error("unavailable");
          const [font, measure, renderer] = await operation.wait(Promise.all([
            import("../experiences/scene-font-client.ts"), import("./scene-text-measurement.ts"), import("./native-retained-scene.ts"),
          ]));
          if (!selected()) throw new Error("unavailable");
          const abort = new AbortController(); this.#reader = abort;
          const visible = () => this.#reader === abort && !abort.signal.aborted && selected();
          let measurement: unknown = null;
          if (scene.layout.status === "qualified") {
            const bytes = await operation.wait(font.readExperienceSceneFont({ origin: this.ownerDocument.location.origin, signal: abort.signal,
              current: visible, timeoutMs: 5000 }));
            if (!visible()) throw new Error("unavailable");
            if (bytes) {
              const measured = await operation.wait(measure.measureSceneScreenplay(scene.content.screenplay, scene.content.selection.displaySource, bytes, this.ownerDocument));
              if (!visible()) throw new Error("unavailable");
              const presentation = renderer.sceneReaderPresentation(scene.content.body, measured);
              if (presentation.kind === "pages" && presentation.packed.pageCount === scene.layout.pageCount
                && (await operation.wait(digest(presentation.packed.pages))).slice(7) === scene.layout.pagesSha256) measurement = measured;
            }
          }
          if (!visible()) throw new Error("unavailable");
          this.#result = { lease, output: "scene", candidate, scene, measurement, render: renderer.renderNativeRetainedScene, current: visible };
          this.#status = this.i18n.system("Scene");
        } else if(candidate.output==="video"){
          if(!binding.videoContract||!state.plan||!state.original||hash!==candidate.video.contentSha256)throw new Error("unavailable");
          const input=await operation.wait(this.store.ensurePrivateContent(candidate.inputRef,{force:true}));
          if(!selected())throw new Error("unavailable");
          const [client,renderer]=await operation.wait(Promise.all([import("../model/retained-short-story-client.ts"),import("./native-retained-video.ts")]));
          if(!selected())throw new Error("unavailable");
          const abort=new AbortController();this.#reader=abort;
          const visible=()=>this.#reader===abort&&!abort.signal.aborted&&selected();
          const video=await operation.wait(client.readNativeRetainedOutput({output:"video",selection:{documentId:state.documentId,artifactId:candidate.artifactId,revision:0,contentSha256:hash}},
            {origin:this.ownerDocument.location.origin,signal:abort.signal,current:visible,request:(path,init)=>fetch(path,init)}));
          if(!visible()||video.output!=="video"||!await operation.wait(verifyExperienceVideoRead(candidate.video,raw,input,video,{
            contract:binding.videoContract,documentId:state.documentId,projectId:state.projectId,artifactId:candidate.artifactId,ownerId:binding.ownerId,
            jobId:state.original.jobId,slotId:state.original.slotId,grantId:state.original.grantId,targetId:state.plan.targetId,
            planRevisionId:state.plan.revisionId,targetContractDigest:state.plan.targetContractDigest,sourceDigest:state.plan.sourceDigest,correlationId:state.original.correlationId,
          }))||!visible()||Date.parse(video.expiresAt)<=Date.now())throw new Error("unavailable");
          this.#result={lease,output:"video",candidate,video,mount:renderer.mountNativeRetainedVideo,current:()=>visible()&&Date.parse(video.expiresAt)>Date.now()};
          this.#status="1 video · 4 s · 480p · Silent";
        } else if(candidate.output==="storyboard"){
          if(!binding.storyboardSource||!state.plan||!state.original||hash!==candidate.storyboard.contentSha256)throw new Error("unavailable");
          const input=await operation.wait(this.store.ensurePrivateContent(candidate.inputRef,{force:true}));
          if(!selected())throw new Error("unavailable");
          const [client,renderer]=await operation.wait(Promise.all([import("../model/retained-short-story-client.ts"),import("./native-retained-storyboard.ts")]));
          if(!selected())throw new Error("unavailable");
          const abort=new AbortController();this.#reader=abort;
          const visible=()=>this.#reader===abort&&!abort.signal.aborted&&selected();
          const storyboard=await operation.wait(client.readNativeRetainedOutput({output:"storyboard",selection:{documentId:state.documentId,artifactId:candidate.artifactId,revision:0,contentSha256:hash}},
            {origin:this.ownerDocument.location.origin,signal:abort.signal,current:visible,request:(path,init)=>fetch(path,init)}));
          if(!visible()||storyboard.output!=="storyboard"||!await operation.wait(verifyExperienceStoryboardRead(candidate.storyboard,raw,input,storyboard,{
            source:binding.storyboardSource,documentId:state.documentId,projectId:state.projectId,artifactId:candidate.artifactId,ownerId:binding.ownerId,
            jobId:state.original.jobId,slotId:state.original.slotId,grantId:state.original.grantId,targetId:state.plan.targetId,
            planRevisionId:state.plan.revisionId,targetContractDigest:state.plan.targetContractDigest,sourceDigest:state.plan.sourceDigest,correlationId:state.original.correlationId,
          }))||!visible()||Date.parse(storyboard.expiresAt)<=Date.now())throw new Error("unavailable");
          this.#result={lease,output:"storyboard",candidate,storyboard,render:renderer.renderNativeRetainedStoryboard,current:()=>visible()&&Date.parse(storyboard.expiresAt)>Date.now()};
          this.#status="4 frames";

        } else if (candidate.output === "short_story") {
          const [client, renderer] = await operation.wait(Promise.all([import("../model/retained-short-story-client.ts"), import("./native-retained-story.ts")]));
          if (!selected()) throw new Error("unavailable");
          const abort = new AbortController(); this.#reader = abort;
          const story = await operation.wait(client.readRetainedShortStory({ documentId: state.documentId, artifactId: candidate.artifactId, revision: 0, contentSha256: hash },
            { origin: this.ownerDocument.location.origin, signal: abort.signal, current: () => this.#reader === abort && selected(), request: (path, init) => fetch(path, init) }));
          if (!selected() || !await operation.wait(verifyExperienceStoryRead(candidate.narrative, raw, story)) || !selected() || Date.parse(story.expiresAt) <= Date.now()) throw new Error("unavailable");
          this.#result = { lease, output: "short_story", candidate, story, render: renderer.renderNativeRetainedStory, current: () => selected() && Date.parse(story.expiresAt) > Date.now() };
          this.#status = `1 story · ${candidate.narrative.wordCount} words`;
        } else {
        const [client, renderer] = await operation.wait(Promise.all([import("../model/retained-short-story-client.ts"), import("./native-retained-slides.ts")]));
        if (!selected()) throw new Error("unavailable");
        const abort = new AbortController(); this.#reader = abort;
        const slides = await operation.wait(client.readNativeRetainedOutput({ output: "slides", selection: { documentId: state.documentId, artifactId: candidate.artifactId, revision: 0, contentSha256: hash } },
          { origin: this.ownerDocument.location.origin, signal: abort.signal, current: () => this.#reader === abort && selected(), request: (path, init) => fetch(path, init) }));
        if (slides.output !== "slides" || !selected() || slides.content.items.length !== 5 || Date.parse(slides.expiresAt) <= Date.now()) throw new Error("unavailable");
        this.#result = { lease, output: "slides", candidate, slides, render: renderer.renderNativeRetainedSlides, current: () => selected() && Date.parse(slides.expiresAt) > Date.now() };
        this.#status = "5 slides";
        }
      }
      this.#scheduleDeadline();
    } catch { if (this.#operationCurrent(operation)) { if (this.#baseCurrent(binding)) this.#status = "Result unavailable"; this.#clearResult(); } }
    finally { if (this.#finishOperation(operation)) {
      this.#busy = false; this.requestUpdate(); if (pending) this.#scheduleResultRead();
    } }
  }
  #stopResultRead() {
    if (this.#resultRead !== undefined) clearTimeout(this.#resultRead);
    this.#resultRead = undefined;
  }
  #scheduleResultRead() {
    this.#stopResultRead();
    const binding = this.#binding, state = this.#state();
    if (!binding || !this.#visible(binding) || this.#busy || this.#loading || this.#result || !state?.original
      || state.disposition !== "original_run_recorded" || !state.original.run
      || !["queued", "running"].includes(state.status) || !["queued", "running"].includes(state.original.jobStatus)
      || !Number.isFinite(Date.parse(state.original.jobExpiresAt)) || Date.parse(state.original.jobExpiresAt) <= Date.now()) return;
    // Only read the recorded original. Unknown submissions, recovery and paid
    // commands remain explicit; each read keeps the existing operation guards.
    const timer = setTimeout(() => {
      if (this.#resultRead !== timer) return;
      this.#resultRead = undefined;
      if (this.#binding === binding && this.#state() === state && this.#visible(binding)
        && !this.#busy && !this.#loading && Date.parse(state.original!.jobExpiresAt) > Date.now()) void this.#check();
    }, Math.min(2000, Date.parse(state.original.jobExpiresAt) - Date.now()));
    this.#resultRead = timer;
  }
  #scheduleDeadline() {
    if (this.#deadline) clearTimeout(this.#deadline);
    const state = this.#state(), result = this.#result;
    const dates = [state?.grant?.expiresAt ?? state?.preflight?.expiresAt, state?.sceneCostPreview?.expiresAt, state?.audioCostPreview?.expiresAt, state?.model3dCostPreview?.expiresAt, result?.candidate.expiresAt, result?.output === "video" ? result.video.expiresAt : result?.output === "model3d" ? result.model3d.expiresAt : result?.output === "storyboard" ? result.storyboard.expiresAt : result?.output === "audio" ? result.audio.expiresAt : result?.output === "slides" ? result.slides.expiresAt : result?.output === "short_story" ? result.story.expiresAt : undefined]
      .flatMap(value => value && Number.isFinite(Date.parse(value)) ? [Date.parse(value)] : []).filter(value => value > Date.now());
    if (!dates.length) return;
    this.#deadline = setTimeout(() => {
      this.#resetDecision(); if (this.#result && !this.#result.current()) this.#clearResult();
      this.requestUpdate(); this.#scheduleDeadline();
    }, Math.min(2147483647, Math.max(0, Math.min(...dates) - Date.now())));
  }
  #imageReady(result: Extract<Result, { output: "image" }>) {
    const image = this.#imageNode;
    return this.#result === result && this.#visible() && result.current() && this.#imageLoaded && Boolean(image?.isConnected && image.complete
      && image.naturalWidth === result.image.media.width && image.naturalHeight === result.image.media.height
      && image.currentSrc === new URL(result.image.media.url, this.ownerDocument.location.origin).href);
  }
  #imageLoad(event: Event, result: Extract<Result, { output: "image" }>) {
    const node = event.currentTarget;
    if (!event.isTrusted || !(node instanceof HTMLImageElement) || this.#result !== result || !result.current()) return;
    this.#imageNode = node; this.#imageLoaded = true;
    if (!this.#imageReady(result)) { this.#clearResult(); this.#status = "Result unavailable"; }
    this.requestUpdate();
  }
  async #navigate(action: () => Promise<void>) {
    const attempt = ++this.#navigationEpoch;
    let reportFailure = () => {};
    try {
      const store = this.store, binding = this.#binding, departure = this.captureCommandDeparture();
      const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
      reportFailure = () => {
        // Shell owns ordinary refusal. Only an uncaught setup/cleanup rejection
        // belongs here, and never after newer work or navigation takes ownership.
        if (attempt !== this.#navigationEpoch || this.store !== store || this.#binding !== binding || !departure.current()
          || !store.sourceOwnershipActive(source) || !store.authorizationScopeActive(authorization)
          || binding && !this.#readable(binding)) return;
        this.#status = this.i18n.system("Navigation unavailable"); this.requestUpdate();
      };
      await action();
    } catch {
      // Failed custody checks cannot authorize a fallback mutation either.
      try { reportFailure(); } catch { /* No verified current UI owner. */ }
    }
  }
  async #edit() {
    const result = this.#result, binding = this.#binding;
    if (!result || !binding || this.#busy || !this.#visible(binding) || !result.current() || result.output === "image" && !this.#imageReady(result)) return;
    const base = `/library?document=${encodeURIComponent(binding.plan.documentId)}`;
    const selection = result.output === "video" ? result.video.selection : result.output === "model3d" ? result.model3d.selection : result.output === "storyboard" ? result.storyboard.selection : result.output === "audio" ? result.audio.selection : result.output === "slides" ? result.slides.selection : result.output === "short_story" ? result.story.selection : result.output === "scene" ? result.scene.content.selection : null;
    const path = result.output === "image" ? libraryFocusRoute("output", result.image.outputId, "", base)
      : artifactFocusRoute(selection!.artifactId, "", { expectedRevision: 0, expectedContentSha256: selection!.contentSha256, intent: "inspect" }, base);
    await navigateInApp(this, navigation => this.#result === result && this.#visible(binding) && result.current() && navigation.current()
      && (result.output !== "image" || this.#imageReady(result)) ? navigation.route(withExperienceReportFlag(path, binding.route), { documentFocus: false }) : false);
  }
  captureCommandDeparture(): CommandDeparture {
    const epoch = this.#epoch, route = this.store.route.get(), store = this.store;
    return { element: this, current: () => this.isConnected && this.store === store && this.store.route.get() === route && this.#epoch === epoch,
      blocked: () => this.#loading || this.#busy, reason: () => "Operation pending" };
  }
  async #exit() {
    if (this.#loading || this.#busy) return;
    const binding = this.#binding, verified = Boolean(binding && this.#readable(binding)), departure = this.captureCommandDeparture(), source = this.store.route.get();
    await navigateInApp(this, navigation => departure.current() && !departure.blocked() && navigation.current() && (!verified || this.#readable(binding))
      ? navigation.route(withExperienceReportFlag(verified && binding ? binding.selection.documentRoute : "/experiences", source)) : false);
  }
  #focusOut = () => this.requestUpdate();
  #buttonDisabled(disabled: boolean, control: string) {
    const active = this.ownerDocument.activeElement;
    // Preserve an already focused busy button, with aria-disabled semantics.
    // Every action retains its original busy/direct-activation guard.
    return disabled && !(this.#busy && active instanceof HTMLButtonElement && active.isConnected
      && active.closest("forma-experience-host") === this && active.dataset.experienceControl === control);
  }
  #preserveFocus() {
    const binding = this.#binding, active = this.ownerDocument.activeElement;
    if (!binding || !this.#readable(binding) || !(active instanceof HTMLElement) || !active.isConnected
      || active.closest("forma-experience-host") !== this) return;
    const form = active.closest<HTMLElement>("form[data-experience-action]");
    const action = (form?.dataset.experienceAction ?? active.dataset.experienceAction) as ExperienceBindingAction | undefined;
    const control = active.dataset.experienceControl, state = this.#state();
    if (!action && !control) return;
    let withdrawn = Boolean(action && (!this.#visible(binding) || !state?.permitted[action]));
    if (this.#busy && active instanceof HTMLInputElement) withdrawn = true;
    if (!this.#busy && active instanceof HTMLButtonElement) {
      if (action === "prepare" && !this.#confirmed) withdrawn = true;
      if ((action === "authorize" || action === "run" || action === "resumeRun") && !this.#paidDecision(action)) withdrawn = true;
    }
    if (control === "stop" && (!this.#visible(binding) || state?.output !== "video" || !state.original || !["queued", "running"].includes(state.original.jobStatus))) withdrawn = true;
    if (control === "edit" && (!this.#visible(binding) || !this.#result
      || this.#result.output === "image" && !this.#imageReady(this.#result))) withdrawn = true;
    if (!withdrawn) return;
    const status = this.querySelector<HTMLElement>("[data-experience-status]");
    if (!status || !status.isConnected) return;
    const focus = captureOutputNavigationFocus(this.ownerDocument);
    try {
      focus.run(status, () => {
        if (this.#binding !== binding || !this.#readable(binding) || this.ownerDocument.activeElement !== active) return false;
        status.focus();
        if (this.ownerDocument.activeElement === status) void this.#commandFocusReveal?.().catch(() => { /* Only this command's existing focus lease can reveal the committed transfer. */ });
        return this.ownerDocument.activeElement === status;
      });
    } finally { focus.dispose(); }
  }
  protected override willUpdate() {
    if (this.#binding) {
      const source = this.#sourceLifetime.observe(this.#baseCurrent(this.#binding), this.#current(this.#binding));
      if (source.retired) { this.#status = "Document unavailable"; this.#retire(); }
      else if (!source.paidSourceCurrent && !this.#refreshing) {
        this.#stopResultRead();
        this.#resetDecision(); this.#clearResult();
        if (this.#binding.client.pending) this.#binding.client.dispose();
        this.#status = "Source changed";
      }
    }
    if (this.#result && !this.#result.current()) this.#clearResult();
    this.#preserveFocus();
  }
  #model3dText(value: string) {
    const output = this.#binding?.selection.output ?? parseExperienceHostRoute(this.store.route.get())?.output;
    return output === "model3d" ? this.i18n.system(value) : value;
  }
  #rows(rows: readonly OutputTermsRow[]) {
    const model3d = this.#binding?.selection.output === "model3d";
    return html`<dl>${rows.map(row => html`<div><dt>${model3d ? this.i18n.system(row.label) : row.label}</dt><dd>${model3d && row.label === "After uncertain response" && row.value === "No automatic paid retry; a separately authorized replacement may be available"
      ? this.i18n.t("model3d.replacement.retry", "No automatic paid retry; a separately authorized replacement may be available")
      : model3d && model3dTermIsInterfaceCopy(row) ? this.i18n.system(row.value) : row.value}</dd></div>`)}</dl>`;
  }
  #sceneLabels(): NativeRetainedSceneLabels {
    return {
      fixed: this.i18n.system("Fixed-page preview · US Letter, DM Mono 12 pt. This is not print or PDF verification."),
      reflow: this.i18n.system("Reading view · text wraps here. Page divisions come from the measured layout, not this view or a verified print/PDF."),
      unqualified: this.i18n.system("Original text · fixed-font page layout is not verified."),
      tooLong: this.i18n.system("Original text · the measured layout exceeds two pages. No two-page or print/PDF verification is claimed."),
      page: (page, total) => this.i18n.system("Measured page {page} of {total}", { page: this.i18n.number(page), total: this.i18n.number(total) }),
      continuation: this.i18n.system("Pagination continuation, not authored text:"),
    };
  }
  #termsContent(terms: OutputTerms) {
    return html`${this.#rows(terms.rows)}${terms.targets.map(target => html`<section>${this.#rows(target.rows)}
      ${target.calls.map(call => html`<h3>${call.stage}</h3>${this.#rows(call.rows)}`)}<details><summary>${this.#model3dText("Settings")}</summary><pre>${target.settings}</pre></details></section>`)}
      ${terms.grantRows.length ? this.#rows(terms.grantRows) : nothing}`;
  }
  #termsSummary(terms: OutputTerms | null, state: ExperienceNativeState, binding: Binding) {
    const summary = terms?.summary;
    const availability = outputAvailabilityMessage(state);
    const notice = outputTermsNotice(terms, { status: state.status, originalRunRecorded: state.disposition === "original_run_recorded",
      authorize: state.permitted.authorize, run: state.permitted.run, resumeRun: state.permitted.resumeRun });
    const notices: Record<OutputTermsNotice, string> = {
      terms_unavailable: "Cost and transfer details are unavailable. No new spending approval is available.",
      terms_expired: "This cost check has expired. Check status before reviewing a fresh approval.",
      review: "Review these terms before approving. Approval alone does not start creation.",
      authorized: "Approved for this request. Create starts the authorized work.",
      grant_expired: "This authorization has expired. Create is unavailable; check the original request’s status.",
      grant_unavailable: "This authorization cannot start work. Check the original request’s status.",
      pending: "The original request is in progress. Status checks do not submit another request.",
      uncertain: "The original request is unconfirmed. Check its status; this is not permission to submit another request.",
      finished: "These are the original request’s terms, not a new authorization.",
    };
    const deadline = summary?.usage?.expiresAt ?? summary?.expiresAt;
    return html`<section class="experience-consent-summary" aria-label=${this.i18n.system("Cost and transfer")}>
      <h2>${this.i18n.system("Cost and transfer")}</h2>
      <p class="experience-consent-notice" data-experience-terms-notice=${notice} role="status" aria-live="polite" aria-atomic="true" dir="auto">${this.i18n.system(notices[notice])}</p>
      ${availability ? html`<p data-experience-availability-reason dir="auto">${this.i18n.t(availability.id, FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en[availability.id], availability.values)}</p>` : nothing}
      ${summary ? html`<dl class="experience-consent-facts">
        <div><dt>${this.i18n.system("Maximum cost")}</dt><dd><strong><bdi>${summary.maximumSpend}</bdi></strong></dd></div>
        <div><dt>${this.i18n.system("Output")}</dt><dd><strong dir="auto">${this.i18n.system(summary.output)}</strong>${summary.constraints.length ? html`<span class="experience-consent-constraints">${summary.constraints.map(item => html`<span dir="auto">${this.i18n.system(item.label)}: <bdi>${this.i18n.system(item.value)}</bdi></span>`)}</span>` : nothing}</dd></div>
      </dl>
      <p dir="auto"><strong>${this.i18n.system("Source")}: </strong><bdi dir="auto">${binding.plan.title}</bdi>. ${this.i18n.system(summary.source)}. ${this.i18n.system(summary.transfer)}</p>
      <p dir="auto"><strong>${this.i18n.system("Maximum generation calls")}: </strong>${this.i18n.number(summary.maximumGenerationCalls)} · ${this.i18n.system(summary.requests)}. <span>${this.i18n.system("Generation recipients")}: ${summary.recipients.map((recipient, index) => html`${index ? "; " : nothing}<bdi>${recipient.provider} · ${recipient.model}</bdi>`)}</span></p>
      ${summary.safety ? html`<p dir="auto"><strong>${this.i18n.system("Additional safety checks")}: </strong>${this.i18n.number(summary.safety.maximumChecks)} · <bdi>${summary.safety.provider} · ${summary.safety.model}</bdi> · ${this.i18n.system(summary.safety.input)}. ${this.i18n.system("Separate from generation calls; before image creation.")}</p>` : nothing}
      <p class="experience-consent-caveats" dir="auto">${summary.caveats.map((caveat, index) => html`${index ? " " : nothing}${state.output === "model3d" && caveat === "No automatic paid retry; a separately authorized replacement may be available"
        ? this.i18n.t("model3d.replacement.retry", "No automatic paid retry; a separately authorized replacement may be available") : this.i18n.system(caveat)}`)}</p>
      ${deadline ? html`<p dir="auto"><strong>${this.i18n.system(summary.usage ? "Authorization deadline" : "Approval deadline")}: </strong><time datetime=${deadline}>${this.i18n.date(new Date(deadline), { dateStyle: "medium", timeStyle: "long" })}</time></p>` : nothing}
      ${summary.usage ? html`<p dir="auto">${this.i18n.system("Used spend")}: <bdi>${summary.usage.usedSpend}</bdi> · ${this.i18n.system("Unresolved exposure")}: <bdi>${summary.usage.unresolvedExposure}</bdi> · ${this.i18n.system("Pending calls")}: ${this.i18n.number(summary.usage.pendingCalls)}${summary.usage.differentPayer ? html` · ${this.i18n.system("Payer")}: <bdi>${summary.usage.payer}</bdi>` : nothing}</p>` : nothing}` : nothing}
    </section>`;
  }
  override render() {
    const state = this.#state(), terms = this.#terms(state), binding = this.#binding, result = this.#result;
    const available = this.#visible(binding), format = this.#imageFormat(), authorize = this.#paidDecision("authorize"), run = this.#paidDecision("run"), resume = this.#paidDecision("resumeRun");
    const sourceCapacity = available && binding ? outputSourceCapacityMessage(binding.client.state) : null;
    const target = state?.preflight?.targets[0];
    const unavailableProviderPreparation = available && state?.status === "unavailable" && state.disposition === "prepared"
      && !state.original && !state.grant && !Object.values(state.permitted).some(Boolean)
      && state.preflight?.targets.length === 1 && state.preflight.maximumMicrousd === 0 && state.preflight.maximumCalls === 0
      && target?.available === false && (target.reasonCode === "output_native_planner_unconfigured" || state.output === "short_story" && target.reasonCode === "output_narrative_provider_unavailable")
      && target.transferCode === "output_transfer_none_owned_adoption" && target.provider === null && target.model === null && target.route === null
      && target.maximumMicrousd === 0 && target.maximumCalls === 0 && target.maximumTokens === 0;
    const duplicateReviewStatus = Boolean(available && state?.status === "review" && state.preflight && terms?.summary && terms.available
      && !result && !unavailableProviderPreparation && !this.#loading && !this.#busy && !this.#refreshing && this.#status === "Cost and transfer");
    return html`<section class="experience-host" aria-busy=${String(this.#loading || this.#busy)}>
      <header class="experience-heading"><h1>${binding?.selection.output === "video" ? "Video" : binding?.selection.output === "image" ? "Image" : binding?.selection.output === "slides" ? "Slides" : binding?.selection.output === "short_story" ? "Short story" : binding?.selection.output === "scene" ? "Scene" : binding?.selection.output === "model3d" ? this.i18n.system("3D model") : binding?.selection.output === "audio" ? this.i18n.system("Audio") : binding?.selection.output === "storyboard" ? "Storyboard" : "Output"}</h1></header>
      <p data-experience-status class=${duplicateReviewStatus ? "experience-status-duplicate" : nothing} tabindex="-1" role="status" aria-live="polite">${this.#model3dText(this.#status)}</p>
      ${available && state?.current.source === "changed" ? html`<p data-experience-retained-source dir="auto">${retainedImageSourceMessage(this.i18n.locale)}</p>` : nothing}
      ${sourceCapacity ? html`<p data-experience-source-capacity dir="auto">${this.i18n.t(sourceCapacity.id, FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en[sourceCapacity.id], sourceCapacity.values)}</p>` : nothing}
      ${available && result ? result.output === "image" ? html`<figure class="experience-native-image"><img data-experience-image src=${result.image.media.url} alt="Image" width=${result.image.media.width} height=${result.image.media.height}
        @load=${(event: Event) => this.#imageLoad(event, result)} @error=${() => { if (this.#result === result) { this.#clearResult(); this.#status = "Result unavailable"; this.requestUpdate(); } }}></figure>`
        : result.output === "model3d" ? keyed(result.lease, result.render(result.model3d, this.i18n))
        : result.output === "video" ? keyed(result.lease,html`<div class="experience-native-video" ${ref(this.#mountVideo)}></div>`)
        : result.output === "audio" ? keyed(result.lease, result.render(result.audio, this.i18n))
        : result.output === "scene" ? keyed(result.lease, result.render(result.scene.content, this.i18n.system("Scene"), result.measurement, this.#sceneLabels()))
        : result.output === "short_story" ? keyed(result.lease, result.render(result.story, "Short story")) : result.output === "storyboard" ? keyed(result.lease,result.render(result.storyboard,this.i18n)) : result.render(result.slides, this.i18n) : nothing}
      ${available && state?.permitted.prepare ? html`<form class="experience-admission" data-experience-action="prepare" @submit=${(event: SubmitEvent) => this.#prepare(event)}>
        <dl><div><dt>${this.#model3dText("Output")}</dt><dd>${state.output === "video" ? "1 video · 4 s · 480p · Silent" : state.output === "model3d" ? this.i18n.system("1 static GLB assembly · One requested object") : state.output === "audio" ? this.i18n.system("1 instrumental track · about 20 seconds") : state.output === "image" ? "1 image" : state.output === "short_story" ? "1 story · 600–800 words" : state.output === "scene" ? this.i18n.system("1 written scene · 2 characters · 1 location · 1–2 pages") : state.output === "storyboard" ? "4 frames" : "5 slides"}</dd></div>${format ? html`<div><dt>${this.i18n.system("Ratio")}</dt><dd>${format.aspect_ratio.width}:${format.aspect_ratio.height}</dd></div><div><dt>${this.i18n.system("Dimensions")}</dt><dd>${format.dimensions.width} × ${format.dimensions.height}</dd></div>` : nothing}</dl>
        <label><input type="checkbox" .checked=${this.#confirmed} ?disabled=${this.#busy} @change=${(event: Event) => { this.#confirmed = (event.currentTarget as HTMLInputElement).checked; this.#latch.clear(); this.requestUpdate(); }}>${this.i18n.system("Confirm output")}</label>
        <button type="submit" class="button primary" data-experience-control="prepare" aria-disabled=${String(this.#busy || !this.#confirmed)} ?disabled=${this.#buttonDisabled(this.#busy || !this.#confirmed, "prepare")}>${this.i18n.system("Check cost")}</button></form>` : nothing}
      ${unavailableProviderPreparation ? html`<section class="experience-terms" aria-label=${this.i18n.system("Cost and transfer")}>
        <dl><div><dt>${this.i18n.system("Provider")}</dt><dd>${this.i18n.system(target?.reasonCode === "output_narrative_provider_unavailable" ? "Unavailable" : "Not configured")}</dd></div><div><dt>${this.i18n.system("Source transfer")}</dt><dd>${this.i18n.system("None")}</dd></div><div><dt>${this.i18n.system("Maximum cost")}</dt><dd>$0</dd></div></dl></section>` : nothing}
      ${available && state?.preflight && binding && !result && !unavailableProviderPreparation ? this.#termsSummary(terms, state, binding) : nothing}
      ${available && (state?.model3dReplacement || state?.model3dCostPreview?.version === "model3d-mini-app-replacement-cost-v1") ? html`<aside class="experience-terms" data-model3d-replacement-exposure>
        <p>${state?.model3dCostPreview?.version === "model3d-mini-app-replacement-cost-v1"
          ? this.i18n.t("model3d.replacement.history", "This replacement was prepared with $0.40 unresolved on the original request and a separate $0.40 ceiling: $0.80 combined maximum. The replacement does not settle or refund the original charge.")
          : this.i18n.t("model3d.replacement.exposure", "The original $0.40 remains reserved and unresolved. One replacement may cost up to another $0.40: $0.80 maximum combined exposure. This does not release, refund or settle the original charge.")}</p></aside>` : nothing}
      ${available && state?.permitted.prepareReplacement && state.model3dReplacement ? html`<form class="experience-admission" data-experience-action="prepareReplacement" @submit=${(event: SubmitEvent) => this.#prepareReplacement(event)}>
        <p>${this.i18n.t("model3d.replacement.unpaid", "Reuse this document and its unchanged instructions. Preparation is free and makes no provider request. Review the new cost and transfer terms, then authorize and start separately. No automatic paid retry.")}</p>
        <button type="submit" class="button primary" data-experience-control="prepareReplacement" aria-disabled=${String(this.#busy)} ?disabled=${this.#buttonDisabled(this.#busy, "prepareReplacement")}>${this.i18n.t("model3d.replacement.prepare", "Prepare one replacement")}</button></form>` : nothing}
      ${available && state?.permitted.renewPreparation && (state.sceneRenewal || state.videoRenewal || state.model3dRenewal) ? html`<form class="experience-admission" data-experience-action="renewPreparation" @submit=${(event: SubmitEvent) => this.#renewPreparation(event)}>
        <dl><div><dt>${this.i18n.system("Document")}</dt><dd>${this.i18n.system("Retained")}</dd></div>
          <div><dt>${this.i18n.system("Generation calls")}</dt><dd>0</dd></div>
          <div><dt>${this.i18n.system("Maximum cost")}</dt><dd>$0</dd></div>
          <div><dt>${this.i18n.system("Next")}</dt><dd>${this.i18n.system("Cost and transfer")}</dd></div></dl>
        <button type="submit" class="button primary" data-experience-control="renewPreparation" aria-disabled=${String(this.#busy)} ?disabled=${this.#buttonDisabled(this.#busy, "renewPreparation")}>${this.i18n.system("Renew preparation")}</button></form>` : nothing}
      ${available && terms?.rows.length && !terms.summary && !result && !unavailableProviderPreparation ? html`<section class="experience-terms" aria-label=${this.i18n.system("Cost and transfer")}>${this.#termsContent(terms)}</section>` : nothing}
      ${available && state?.permitted.authorize ? html`<form class="experience-admission" data-experience-action="authorize" @submit=${(event: SubmitEvent) => this.#paidSubmit(event, "authorize", authorize ? outputPaidDecisionKey(authorize) : null)}>
        ${state.output === "scene" ? html`<p>${this.i18n.system("This creates a written Scene, not images, video or audio. One OpenAI request; no automatic repair. Charges may remain if validation fails.")}</p>
          <label><input type="checkbox" .checked=${this.#sceneApproval} ?disabled=${this.#busy || !terms?.available || !state.sceneCostPreview}
            @change=${(event: Event) => { this.#sceneApproval = event.isTrusted && (event.currentTarget as HTMLInputElement).checked; this.#latch.clear(); this.requestUpdate(); }}>${this.i18n.system("Approve this exact Scene request and its displayed maximum cost")}</label>` : nothing}
        ${state.output === "model3d" ? html`<p>${this.i18n.system("One Rodin request for a static GLB. Static assembly checks do not prove one semantic object or visual quality. Charges may remain if validation fails. Original mesh bytes are not transferred.")}</p>
          <label><input type="checkbox" .checked=${this.#model3dApproval} ?disabled=${this.#busy || !terms?.available || !state.model3dCostPreview}
            @change=${(event: Event) => { this.#model3dApproval = event.isTrusted && (event.currentTarget as HTMLInputElement).checked; this.#latch.clear(); this.requestUpdate(); }}>${this.i18n.system("Approve this exact 3D request and its displayed maximum cost")}</label>` : nothing}
        ${state.output === "audio" ? html`<p>${this.i18n.system("Create one instrumental track: one OpenAI planning call, at most one repair, then one fal.ai audio request. The 20-second target is not a measured result. Charges may remain if validation fails.")}</p>
          <label><input type="checkbox" .checked=${this.#audioApproval} ?disabled=${this.#busy || !terms?.available || !state.audioCostPreview}
            @change=${(event: Event) => { this.#audioApproval = event.isTrusted && (event.currentTarget as HTMLInputElement).checked; this.#latch.clear(); this.requestUpdate(); }}>${this.i18n.system("Approve this exact Audio request and its displayed maximum cost")}</label>` : nothing}
        <label><input type="checkbox" .checked=${this.#approval} ?disabled=${this.#busy || !terms?.available} @change=${(event: Event) => { this.#approval = (!["audio", "model3d", "video"].includes(state.output) || event.isTrusted) && (event.currentTarget as HTMLInputElement).checked; this.#latch.clear(); this.requestUpdate(); }}>${this.i18n.system("Approve source transfer and maximum spend")}</label>
        <button type="submit" class="button primary" data-experience-control="authorize" aria-disabled=${String(!authorize)} ?disabled=${this.#buttonDisabled(!authorize, "authorize")} @click=${(event: MouseEvent) => this.#arm(event, "authorize")}>${this.i18n.system("Authorize")}</button></form>` : nothing}
      ${available && state?.permitted.run ? html`<form class="experience-admission" data-experience-action="run" @submit=${(event: SubmitEvent) => this.#paidSubmit(event, "run", run ? outputPaidDecisionKey(run) : null)}>
        <button type="submit" class="button primary" data-experience-control="run" aria-disabled=${String(!run)} ?disabled=${this.#buttonDisabled(!run, "run")} @click=${(event: MouseEvent) => this.#arm(event, "run")}>${state.output === "video" ? "Create video" : state.output === "image" ? "Create image" : state.output === "short_story" ? "Create story" : state.output === "scene" ? this.i18n.system("Create scene") : state.output === "model3d" ? this.i18n.system("Create 3D model") : state.output === "audio" ? this.i18n.system("Create audio") : state.output === "storyboard" ? "Create storyboard" : "Create slides"}</button></form>` : nothing}
      ${available && state?.permitted.resumeRun ? html`<form class="experience-admission" data-experience-action="resumeRun" @submit=${(event: SubmitEvent) => this.#paidSubmit(event, "resumeRun", resume ? outputPaidDecisionKey(resume) : null)}>
        <button type="submit" class="button primary" data-experience-control="resumeRun" aria-disabled=${String(!resume)} ?disabled=${this.#buttonDisabled(!resume, "resumeRun")} @click=${(event: MouseEvent) => this.#arm(event, "resumeRun")}>${this.#model3dText("Resume")}</button></form>` : nothing}
      ${available&&state?.output==="video"&&state.original&&["queued","running"].includes(state.original.jobStatus)?html`<button type="button" class="button secondary" data-experience-control="stop" aria-disabled=${String(this.#busy||this.#loading)} ?disabled=${this.#buttonDisabled(this.#busy||this.#loading,"stop")} @click=${this.#stopVideo}>Stop</button>`:nothing}
      <div class="experience-result-actions">${available && state?.permitted.recoverResult ? html`<button type="button" class="button primary" data-experience-action="recoverResult" data-experience-control="recoverResult" aria-disabled=${String(this.#busy || this.#loading)} ?disabled=${this.#buttonDisabled(this.#busy || this.#loading, "recoverResult")}
        @click=${(event: MouseEvent) => { if (event.isTrusted) void this.#command("recoverResult", state); }}>${this.i18n.system("Recover result")}</button>` : nothing}${this.#readable(binding) ? html`<button type="button" class="button secondary" data-experience-control="check" aria-disabled=${String(this.#busy || this.#loading)} ?disabled=${this.#buttonDisabled(this.#busy || this.#loading, "check")} @click=${(event:MouseEvent) => {if(event.isTrusted)void this.#check(true);}}>${this.#model3dText("Check status")}</button>` : nothing}
        ${available && result ? html`<button type="button" class="button primary" data-experience-control="edit" aria-disabled=${String(this.#busy || result.output === "image" && !this.#imageReady(result))} ?disabled=${this.#buttonDisabled(this.#busy || result.output === "image" && !this.#imageReady(result), "edit")} @click=${() => { if (!this.#busy) void this.#navigate(() => this.#edit()); }}>${this.#model3dText("Edit in Forma")}</button>` : nothing}</div>
      ${available && terms?.rows.length && (terms.summary || result) && !unavailableProviderPreparation ? html`<details class="experience-terms experience-technical-terms"><summary>${this.i18n.system("Technical details")}</summary>${this.#termsContent(terms)}</details>` : nothing}
      <footer class="experience-host-exit"><button type="button" class="button secondary" data-experience-control="exit" aria-disabled=${String(this.#busy || this.#loading)} ?disabled=${this.#buttonDisabled(this.#busy || this.#loading, "exit")} @click=${() => { if (!this.#busy && !this.#loading) void this.#navigate(() => this.#exit()); }}>${this.#model3dText(this.#readable() ? "Open in Forma" : "Outputs")}</button></footer>
    </section>`;
  }
}
if (!customElements.get("forma-experience-host")) customElements.define("forma-experience-host", FormaExperienceHost);
