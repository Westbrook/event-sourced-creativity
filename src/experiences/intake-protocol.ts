import { canonicalJson, exactKeys, freeze, record } from "./compiler.ts";
import { isIntentId, type ExperiencePlan, type IntakeRequest } from "./intake.ts";
import type { CompiledRelease } from "./contracts.ts";
import { captureExperienceIntakeJson, SHORT_STORY_SETUP_V2_BASE_RELEASE_HASH, type ExperienceIntakeJson, type ShortStorySetupV2Identity, type ShortStorySetupV2Plan } from "./short-story-setup-v2.ts";

/** Recognized archived semantics, NOT current admission or execution authority.
 * setupHash was observed by the owner in the accepted pure checkpoint. */
export const SHORT_STORY_SETUP_V2_ARCHIVED_IDENTITY: ShortStorySetupV2Identity = freeze({
  id: "short_story.output-setup@2", version: 2,
  baseReleaseHash: SHORT_STORY_SETUP_V2_BASE_RELEASE_HASH,
  setupHash: "sha256:367cc9b62833e6a7fab24f8316fb7d3a02b8bce7b629ebfba5cde2bf00b9b370",
});
/** Activation is an explicit owner-approved deployment change, isolated from
 * archive recognition. Do not infer activation from a matching base hash. */
export const EXPERIENCE_SETUP_ACTIVATION = Object.freeze({ shortStoryV2: false });

export type ExperiencePrepare = Readonly<{ version: 1; request: IntakeRequest } | { version: 2; request: IntakeRequest; setup: ShortStorySetupV2Identity }>;
export type ExperienceCommit = Readonly<{ version: 1; draftHash: string } | { version: 2; draftHash: string; setup: ShortStorySetupV2Identity }>;
export type ExperiencePrepareBody = IntakeRequest | Extract<ExperiencePrepare, { version: 2 }>;
export type ExperienceCommitBody = Readonly<{ draftHash: string }> | Extract<ExperienceCommit, { version: 2 }>;
export type ExperienceAdmission = Readonly<
  { planVersion: 1; experienceId: string; baseReleaseHash: string }
  | { planVersion: 2; experienceId: "short-story"; setup: ShortStorySetupV2Identity }
>;
type Json = ExperienceIntakeJson;
type Obj = { [key: string]: Json };
const hash = /^sha256:[a-f0-9]{64}$/u;
const experienceId = /^[a-z][a-z0-9-]{1,63}$/u;
function invalid(): never { throw new Error("experience_protocol_invalid"); }
function check(value: unknown): asserts value { if (!value) invalid(); }
function capture(value: unknown): Json { try { return captureExperienceIntakeJson(value); } catch { return invalid(); } }
function exact(value: Json | undefined, keys: readonly string[]): Obj {
  check(record(value) && exactKeys(value, keys)); return value as Obj;
}
function hashValue(value: Json | undefined): string { check(typeof value === "string" && hash.test(value)); return value; }
function idValue(value: Json | undefined): string { check(typeof value === "string" && experienceId.test(value)); return value; }
function setup(value: Json | undefined): ShortStorySetupV2Identity {
  const item = exact(value, ["id", "version", "baseReleaseHash", "setupHash"]);
  check(canonicalJson(item) === canonicalJson(SHORT_STORY_SETUP_V2_ARCHIVED_IDENTITY));
  return freeze(item) as unknown as ShortStorySetupV2Identity;
}
function typedValue(value: Json | undefined) {
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) { const row = exact(item, ["id", "text"]); check(typeof row.id === "string" && typeof row.text === "string"); }
    return;
  }
  check(record(value) && Object.values(value).every(item => typeof item === "string" || typeof item === "number"));
}
/** Wire shape only; source completeness, limits, provenance/default equality and
 * registration still require the existing release-specific intake validator. */
function request(value: Json | undefined): IntakeRequest {
  const item = exact(value, ["intentId", "experienceId", "releaseHash", "values"]);
  check(isIntentId(item.intentId)); idValue(item.experienceId); hashValue(item.releaseHash);
  check(record(item.values));
  for (const [key, raw] of Object.entries(item.values)) {
    check(/^[a-z][a-zA-Z0-9-]{0,63}$/u.test(key));
    const entry = exact(raw as Json, ["value", "provenance"]);
    check(entry.provenance === "authored" || entry.provenance === "default"); typedValue(entry.value);
  }
  return freeze(item) as unknown as IntakeRequest;
}
function v2Prepare(value: Obj): Extract<ExperiencePrepare, { version: 2 }> {
  exact(value, ["version", "request", "setup"]); check(value.version === 2);
  const input = request(value.request), identity = setup(value.setup);
  check(input.experienceId === "short-story" && input.releaseHash === identity.baseReleaseHash);
  return freeze({ version: 2 as const, request: input, setup: identity });
}
/** Exact raw V1 request OR explicit V2 wire envelope. Never infer a version from
 * releaseHash, silently upgrade V1, or accept an internal normalized V1 wrapper. */
export function readExperiencePrepare(input: unknown): ExperiencePrepare {
  const value = capture(input); check(record(value));
  if (Object.hasOwn(value, "version")) return v2Prepare(value as Obj);
  return freeze({ version: 1 as const, request: request(value) });
}
function normalizedPrepare(value: Json): ExperiencePrepare {
  check(record(value));
  if (value.version === 2) return v2Prepare(value as Obj);
  const item = exact(value, ["version", "request"]); check(item.version === 1);
  return freeze({ version: 1 as const, request: request(item.request) });
}
/** Serialize the captured original, not a request rebuilt from current defaults. */
export function experiencePrepareBody(input: unknown): ExperiencePrepareBody {
  const prepared = normalizedPrepare(capture(input)); return prepared.version === 1 ? prepared.request : prepared;
}
function normalizedCommit(value: Json): ExperienceCommit {
  check(record(value));
  if (value.version === 2) {
    const item = exact(value, ["version", "draftHash", "setup"]);
    return freeze({ version: 2 as const, draftHash: hashValue(item.draftHash), setup: setup(item.setup) });
  }
  const item = exact(value, ["version", "draftHash"]); check(item.version === 1);
  check(typeof item.draftHash === "string");
  return freeze({ version: 1 as const, draftHash: item.draftHash });
}
/** The existing V1 server parser remains unchanged: it accepts any string and
 * compares it with the retained hash (including its legacy stale-409 behavior).
 * This bounded helper must not replace that server body/parser boundary. */
export function readExperienceCommit(input: unknown): ExperienceCommit {
  const value = capture(input); check(record(value));
  if (Object.hasOwn(value, "version")) { check(value.version === 2); return normalizedCommit(value as Json); }
  const item = exact(value as Json, ["draftHash"]);
  check(typeof item.draftHash === "string");
  return freeze({ version: 1 as const, draftHash: item.draftHash });
}
export function experienceCommitBody(input: unknown): ExperienceCommitBody {
  const commit = normalizedCommit(capture(input)); return commit.version === 1 ? freeze({ draftHash: commit.draftHash }) : commit;
}
function admission(value: Json): ExperienceAdmission | null {
  if (value === null) return null;
  check(record(value));
  if (value.planVersion === 2) {
    const item = exact(value, ["planVersion", "experienceId", "setup"]); check(item.experienceId === "short-story");
    return freeze({ planVersion: 2 as const, experienceId: "short-story" as const, setup: setup(item.setup) });
  }
  const item = exact(value, ["planVersion", "experienceId", "baseReleaseHash"]); check(item.planVersion === 1);
  return freeze({ planVersion: 1 as const, experienceId: idValue(item.experienceId), baseReleaseHash: hashValue(item.baseReleaseHash) });
}
/** Public metadata decoder; a valid identity is not authentication/admission. */
export function readExperienceAdmission(input: unknown): ExperienceAdmission | null { return admission(capture(input)); }
export function experienceAdmissionsEqual(leftInput: unknown, rightInput: unknown): boolean {
  try {
    const left = admission(capture(leftInput)), right = admission(capture(rightInput));
    return left !== null && right !== null && canonicalJson(left) === canonicalJson(right);
  } catch { return false; }
}
/** Covers uncertain prepares even when no retained plan has been returned. */
export function experiencePrepareAdmission(input: unknown): ExperienceAdmission {
  const prepared = normalizedPrepare(capture(input));
  return prepared.version === 1
    ? freeze({ planVersion: 1 as const, experienceId: prepared.request.experienceId, baseReleaseHash: prepared.request.releaseHash })
    : freeze({ planVersion: 2 as const, experienceId: "short-story" as const, setup: prepared.setup });
}
/** Metadata projection for an ALREADY decoded retained plan. This does not
 * validate its events/hash/custody; hosts must not use it as a plan decoder. */
export function experiencePlanAdmission(planInput: ExperiencePlan | ShortStorySetupV2Plan): ExperienceAdmission {
  const plan = capture(planInput); check(record(plan) && record(plan.release));
  const input = request(plan.request as Json);
  check(input.releaseHash === plan.release.releaseHash && record(plan.release.definition) && input.experienceId === plan.release.definition.id);
  if (plan.version === 2) return experiencePrepareAdmission({ version: 2, request: input, setup: plan.setup });
  check(plan.version === 1 && !Object.hasOwn(plan, "setup"));
  return experiencePrepareAdmission({ version: 1, request: input });
}
/** Call only with the server's current registered release, never an embedded
 * browser/retained release. Client canRetry uses the server's returned metadata.
 * Activation changes are a separately approved deployment boundary. */
export function activeExperienceAdmission(release: CompiledRelease | null): ExperienceAdmission | null {
  if (!release) return null;
  if (release.definition.id === "short-story" && EXPERIENCE_SETUP_ACTIVATION.shortStoryV2) {
    return release.releaseHash === SHORT_STORY_SETUP_V2_ARCHIVED_IDENTITY.baseReleaseHash
      ? freeze({ planVersion: 2 as const, experienceId: "short-story" as const, setup: SHORT_STORY_SETUP_V2_ARCHIVED_IDENTITY }) : null;
  }
  return freeze({ planVersion: 1 as const, experienceId: release.definition.id, baseReleaseHash: release.releaseHash });
}
