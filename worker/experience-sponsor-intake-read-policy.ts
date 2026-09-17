import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";

export const SPONSOR_IMAGE_INTAKE_READ_OPERATIONS = Object.freeze(["image-intake-bootstrap", "image-intake-draft", "image-intake-receipt"] as const);
export type SponsorImageIntakeReadOperation = typeof SPONSOR_IMAGE_INTAKE_READ_OPERATIONS[number];
export type SponsorIntakeReadAllowance = { maximumRequestsPerWindow: number; maximumBytesPerWindow: number };
export type SponsorIntakeReadOperationLimit = { maximumBytes: number; deadlineMs: number };
export type SponsorIntakeReadPolicyV1 = {
  version: 1; windowMs: number;
  operations: Record<SponsorImageIntakeReadOperation, SponsorIntakeReadOperationLimit>;
  actor: SponsorIntakeReadAllowance; campaign: SponsorIntakeReadAllowance;
};
const fail = (): never => { throw new SponsorEntitlementError("sponsor_intake_read_policy_invalid"); };
const integer = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value)
  && Number(value) >= minimum && Number(value) <= maximum;

/** Separate, explicit pre-job Image read terms, not activation or defaults.
 * Bytes cover combined retained reads and emitted responses, including rejected
 * work after admission. This adds no storage, upload, generation or guest claim
 * permission and does not reuse the generated-result read allocation. */
export function readSponsorIntakeReadPolicy(raw: unknown): Readonly<SponsorIntakeReadPolicyV1> {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["version", "windowMs", "operations", "actor", "campaign"])
    || raw.version !== 1 || !integer(raw.windowMs, 1, 31_536_000_000)
    || !record(raw.operations) || !exactKeys(raw.operations, SPONSOR_IMAGE_INTAKE_READ_OPERATIONS)) return fail();
  for (const allowance of [raw.actor, raw.campaign]) {
    if (!record(allowance) || !exactKeys(allowance, ["maximumRequestsPerWindow", "maximumBytesPerWindow"])
      || !integer(allowance.maximumRequestsPerWindow, 1, 1_000_000)
      || !integer(allowance.maximumBytesPerWindow, 1, 1_000_000_000_000)) return fail();
  }
  const policy = raw as SponsorIntakeReadPolicyV1;
  if (policy.actor.maximumRequestsPerWindow > policy.campaign.maximumRequestsPerWindow
    || policy.actor.maximumBytesPerWindow > policy.campaign.maximumBytesPerWindow) return fail();
  for (const operation of SPONSOR_IMAGE_INTAKE_READ_OPERATIONS) {
    const limit = raw.operations[operation];
    if (!record(limit) || !exactKeys(limit, ["maximumBytes", "deadlineMs"])
      || !integer(limit.maximumBytes, 1, 192_000_000) || !integer(limit.deadlineMs, 1, 30_000)
      || limit.maximumBytes > policy.actor.maximumBytesPerWindow) return fail();
  }
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorIntakeReadPolicyV1);
}

/** Dormant schema only; importing installs nothing. Direct-payer approval
 * provisions the exact original sponsor-policy digest in this separate namespace.
 * Fresh bootstrap still needs current approved campaign access; original saved
 * draft/receipt reads instead retain current native custody and retention checks
 * after generation expiry or revocation. A read consumer must reserve each actual
 * request and enforce bytes/deadline; this module grants no read capability. */
export const SPONSOR_INTAKE_READ_POLICY_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_intake_read_policies(
    campaign_id TEXT NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),
    sponsor_policy_digest TEXT NOT NULL,read_policy_digest TEXT NOT NULL,policy_json TEXT NOT NULL,
    review_receipt_digest TEXT NOT NULL,
    PRIMARY KEY(campaign_id,sponsor_policy_digest)) WITHOUT ROWID`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_intake_read_policies_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_intake_read_policies BEGIN SELECT RAISE(ABORT,'sponsor_intake_read_policy_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_intake_read_policies_no_replace BEFORE INSERT ON experience_sponsor_intake_read_policies
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_intake_read_policies old
      WHERE old.campaign_id=NEW.campaign_id AND old.sponsor_policy_digest=NEW.sponsor_policy_digest)
    BEGIN SELECT RAISE(ABORT,'sponsor_intake_read_policy_exists'); END`,
]);
