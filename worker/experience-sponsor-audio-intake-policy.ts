import { canonicalJson, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { captureSponsorAudioJson, SponsorEntitlementError } from "./experience-sponsor-policy.ts";

export const SPONSOR_AUDIO_INTAKE_IO_OPERATIONS = Object.freeze([
  "audio-intake-prepare", "audio-intake-commit", "audio-intake-draft", "audio-intake-receipt",
] as const);
export type SponsorAudioIntakeIoOperation = typeof SPONSOR_AUDIO_INTAKE_IO_OPERATIONS[number];
export type SponsorAudioIntakeStorageAllowance = {
  maximumOperations: number; maximumBytes: number; maximumOperationsPerWindow: number; maximumBytesPerWindow: number;
};
export type SponsorAudioIntakeIoAllowance = { maximumRequestsPerWindow: number; maximumBytesPerWindow: number };
export type SponsorAudioIntakeIoOperationLimit = { maximumBytes: number; deadlineMs: number };
export type SponsorAudioIntakePolicyV1 = {
  version: 1; family: "canonical-audio-initial-intake@1"; purpose: "initial-context";
  storage: {
    startsAtMs: number; expiresAtMs: number; windowMs: number;
    maximumDraftBytes: number; maximumEventBytes: number; maximumOriginalBytes: number;
    actor: SponsorAudioIntakeStorageAllowance; campaign: SponsorAudioIntakeStorageAllowance;
  };
  io: {
    windowMs: number; operations: Record<SponsorAudioIntakeIoOperation, SponsorAudioIntakeIoOperationLimit>;
    actor: SponsorAudioIntakeIoAllowance; campaign: SponsorAudioIntakeIoAllowance;
  };
};
const fail = (): never => { throw new SponsorEntitlementError("sponsor_audio_intake_policy_invalid"); };
const integer = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value)
  && Number(value) >= minimum && Number(value) <= maximum;

/** Additional explicit initial-context terms. Logical storage covers the marked
 * canonical draft plus every exact native event-private JSON payload, once.
 * These are neither existing V1 text-intake resources nor provider money. The
 * bounded native draft collector still enforces its own 65,536-byte ceiling;
 * the larger validation ceilings below cannot override that native boundary.
 * Four intake IO terms grant no later preflight, review, source or result read. */
export function readSponsorAudioIntakePolicy(raw: unknown): Readonly<SponsorAudioIntakePolicyV1> {
  raw = captureSponsorAudioJson(raw);
  if (!record(raw) || !exactKeys(raw, ["version", "family", "purpose", "storage", "io"])
    || raw.version !== 1 || raw.family !== "canonical-audio-initial-intake@1" || raw.purpose !== "initial-context"
    || !record(raw.storage) || !exactKeys(raw.storage, ["startsAtMs", "expiresAtMs", "windowMs", "maximumDraftBytes", "maximumEventBytes", "maximumOriginalBytes", "actor", "campaign"])
    || !integer(raw.storage.startsAtMs, 0, 8_000_000_000_000) || !integer(raw.storage.expiresAtMs, 1, 8_000_000_000_000)
    || raw.storage.expiresAtMs <= raw.storage.startsAtMs || !integer(raw.storage.windowMs, 1, 31_536_000_000)
    || !integer(raw.storage.maximumDraftBytes, 1, 1_048_576) || !integer(raw.storage.maximumEventBytes, 1, 1_048_576)
    || !integer(raw.storage.maximumOriginalBytes, 1, 2_097_152)
    || !record(raw.io) || !exactKeys(raw.io, ["windowMs", "operations", "actor", "campaign"])
    || !integer(raw.io.windowMs, 1, 31_536_000_000) || !record(raw.io.operations)
    || !exactKeys(raw.io.operations, SPONSOR_AUDIO_INTAKE_IO_OPERATIONS)) return fail();
  for (const allowance of [raw.storage.actor, raw.storage.campaign]) {
    if (!record(allowance) || !exactKeys(allowance, ["maximumOperations", "maximumBytes", "maximumOperationsPerWindow", "maximumBytesPerWindow"])
      || !integer(allowance.maximumOperations, 1, 1_000_000) || !integer(allowance.maximumOperationsPerWindow, 1, 1_000_000)
      || !integer(allowance.maximumBytes, 1, 1_000_000_000_000) || !integer(allowance.maximumBytesPerWindow, 1, 1_000_000_000_000)
      || allowance.maximumOperationsPerWindow > allowance.maximumOperations || allowance.maximumBytesPerWindow > allowance.maximumBytes) return fail();
  }
  for (const allowance of [raw.io.actor, raw.io.campaign]) {
    if (!record(allowance) || !exactKeys(allowance, ["maximumRequestsPerWindow", "maximumBytesPerWindow"])
      || !integer(allowance.maximumRequestsPerWindow, 1, 1_000_000)
      || !integer(allowance.maximumBytesPerWindow, 1, 1_000_000_000_000)) return fail();
  }
  const policy = raw as SponsorAudioIntakePolicyV1;
  for (const key of ["maximumOperations", "maximumBytes", "maximumOperationsPerWindow", "maximumBytesPerWindow"] as const) {
    if (policy.storage.actor[key] > policy.storage.campaign[key]) return fail();
  }
  if (policy.storage.maximumDraftBytes > policy.storage.maximumOriginalBytes
    || policy.storage.maximumEventBytes > policy.storage.maximumOriginalBytes
    || policy.storage.maximumOriginalBytes > policy.storage.actor.maximumBytesPerWindow
    || policy.io.actor.maximumRequestsPerWindow > policy.io.campaign.maximumRequestsPerWindow
    || policy.io.actor.maximumBytesPerWindow > policy.io.campaign.maximumBytesPerWindow) return fail();
  for (const operation of SPONSOR_AUDIO_INTAKE_IO_OPERATIONS) {
    const limit = raw.io.operations[operation];
    if (!record(limit) || !exactKeys(limit, ["maximumBytes", "deadlineMs"])
      || !integer(limit.maximumBytes, 1, 192_000_000) || !integer(limit.deadlineMs, 1, 30_000)
      || limit.maximumBytes > policy.io.actor.maximumBytesPerWindow) return fail();
  }
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorAudioIntakePolicyV1);
}

/** Dormant DDL only. Original payer review installs both policy and approval;
 * importing this module neither installs a schema nor chooses launch limits. */
export const SPONSOR_AUDIO_INTAKE_POLICY_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_audio_intake_policies(
    campaign_id TEXT NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),
    sponsor_policy_digest TEXT NOT NULL,intake_policy_digest TEXT NOT NULL,policy_json TEXT NOT NULL,
    review_receipt_digest TEXT NOT NULL,
    PRIMARY KEY(campaign_id,sponsor_policy_digest)) WITHOUT ROWID`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_audio_intake_policies_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_audio_intake_policies BEGIN SELECT RAISE(ABORT,'sponsor_audio_intake_policy_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_audio_intake_policies_no_replace BEFORE INSERT ON experience_sponsor_audio_intake_policies
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_audio_intake_policies old
      WHERE old.campaign_id=NEW.campaign_id AND old.sponsor_policy_digest=NEW.sponsor_policy_digest)
    BEGIN SELECT RAISE(ABORT,'sponsor_audio_intake_policy_exists'); END`,
]);
