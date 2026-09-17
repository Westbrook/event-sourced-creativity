import { canonicalJson, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { captureSponsorAudioJson, SponsorEntitlementError } from "./experience-sponsor-policy.ts";

export const SPONSOR_AUDIO_OUTPUT_READ_OPERATIONS = Object.freeze([
  "audio-output-state", "audio-output-prepare", "audio-output-review", "audio-output-authorize",
] as const);
export type SponsorAudioOutputReadOperation = typeof SPONSOR_AUDIO_OUTPUT_READ_OPERATIONS[number];
export type SponsorAudioOutputReadAllowance = {
  maximumRequestsPerWindow: number; maximumBytesPerWindow: number;
  maximumQueriesPerWindow: number; maximumRowsPerWindow: number;
};
export type SponsorAudioOutputReadOperationLimit = {
  maximumBytes: number; deadlineMs: number; maximumQueries: number; maximumRows: number;
};
export type SponsorAudioOutputReadPolicyV1 = {
  version: 1; family: "canonical-audio-output-read@1"; purpose: "native-output-continuation";
  startsAtMs: number; expiresAtMs: number; windowMs: number;
  operations: Record<SponsorAudioOutputReadOperation, SponsorAudioOutputReadOperationLimit>;
  actor: SponsorAudioOutputReadAllowance; campaign: SponsorAudioOutputReadAllowance;
};
const fail = (): never => { throw new SponsorEntitlementError("sponsor_audio_output_read_policy_invalid"); };
const integer = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value)
  && Number(value) >= minimum && Number(value) <= maximum;

/** Explicit finite terms for the actual native initial-state, deliberate prepare,
 * passive review and authorize read chains. Bytes include control, repeated
 * private reads, native acknowledgements and responses; queries and returned
 * rows count again on every actual dispatch. The native personal context reader
 * traverses the actor's whole personal creative stream, including other Documents.
 * No default allocation, initial-intake IO, storage, generation, Run, job polling,
 * result, recovery, media or provider permission is created by these terms. */
export function readSponsorAudioOutputReadPolicy(raw: unknown): Readonly<SponsorAudioOutputReadPolicyV1> {
  raw = captureSponsorAudioJson(raw);
  if (!record(raw) || !exactKeys(raw, ["version", "family", "purpose", "startsAtMs", "expiresAtMs", "windowMs", "operations", "actor", "campaign"])
    || raw.version !== 1 || raw.family !== "canonical-audio-output-read@1" || raw.purpose !== "native-output-continuation"
    || !integer(raw.startsAtMs, 0, 8_000_000_000_000) || !integer(raw.expiresAtMs, 1, 8_000_000_000_000)
    || raw.expiresAtMs <= raw.startsAtMs || !integer(raw.windowMs, 1, 31_536_000_000)
    || !record(raw.operations) || !exactKeys(raw.operations, SPONSOR_AUDIO_OUTPUT_READ_OPERATIONS)) return fail();
  for (const allowance of [raw.actor, raw.campaign]) {
    if (!record(allowance) || !exactKeys(allowance, ["maximumRequestsPerWindow", "maximumBytesPerWindow", "maximumQueriesPerWindow", "maximumRowsPerWindow"])
      || !integer(allowance.maximumRequestsPerWindow, 1, 1_000_000)
      || !integer(allowance.maximumBytesPerWindow, 1, 1_000_000_000_000)
      || !integer(allowance.maximumQueriesPerWindow, 1, 1_000_000_000)
      || !integer(allowance.maximumRowsPerWindow, 1, 1_000_000_000_000)) return fail();
  }
  const policy = raw as SponsorAudioOutputReadPolicyV1;
  for (const key of ["maximumRequestsPerWindow", "maximumBytesPerWindow", "maximumQueriesPerWindow", "maximumRowsPerWindow"] as const) {
    if (policy.actor[key] > policy.campaign[key]) return fail();
  }
  for (const operation of SPONSOR_AUDIO_OUTPUT_READ_OPERATIONS) {
    const limit = raw.operations[operation];
    if (!record(limit) || !exactKeys(limit, ["maximumBytes", "deadlineMs", "maximumQueries", "maximumRows"])
      || !integer(limit.maximumBytes, 1, 192_000_000) || !integer(limit.deadlineMs, 1, 30_000)
      || !integer(limit.maximumQueries, 1, 100_000) || !integer(limit.maximumRows, 1, 1_000_000)
      || limit.maximumBytes > policy.actor.maximumBytesPerWindow || limit.maximumQueries > policy.actor.maximumQueriesPerWindow
      || limit.maximumRows > policy.actor.maximumRowsPerWindow || limit.deadlineMs > policy.expiresAtMs - policy.startsAtMs) return fail();
  }
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorAudioOutputReadPolicyV1);
}

/** Dormant immutable terms only. The real original V8 payer separately approves
 * this namespace. A later consumer must prove policy validity, current native
 * custody and a fresh finite request debit; importing does not install schema or
 * create a native reader. Generation expiry cannot rewrite historical terms. */
export const SPONSOR_AUDIO_OUTPUT_READ_POLICY_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_audio_output_read_policies(
    campaign_id TEXT NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),
    sponsor_policy_digest TEXT NOT NULL,read_policy_digest TEXT NOT NULL,policy_json TEXT NOT NULL,
    review_receipt_digest TEXT NOT NULL,
    PRIMARY KEY(campaign_id,sponsor_policy_digest)) WITHOUT ROWID`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_audio_output_read_policies_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_audio_output_read_policies BEGIN SELECT RAISE(ABORT,'sponsor_audio_output_read_policy_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_audio_output_read_policies_no_replace BEFORE INSERT ON experience_sponsor_audio_output_read_policies
    WHEN EXISTS(SELECT 1 FROM main.experience_sponsor_audio_output_read_policies old
      WHERE old.campaign_id=NEW.campaign_id AND old.sponsor_policy_digest=NEW.sponsor_policy_digest)
    BEGIN SELECT RAISE(ABORT,'sponsor_audio_output_read_policy_exists'); END`,
]);
