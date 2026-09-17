import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";

export const SPONSOR_IMAGE_READ_OPERATIONS = Object.freeze(["image-status", "image-result", "image-media"] as const);
export type SponsorImageReadOperation = typeof SPONSOR_IMAGE_READ_OPERATIONS[number];
export type SponsorReadAllowance = { maximumRequestsPerWindow: number; maximumBytesPerWindow: number };
export type SponsorReadOperationLimit = { maximumBytes: number; deadlineMs: number };
export type SponsorReadPolicyV1 = {
  version: 1; windowMs: number;
  operations: Record<SponsorImageReadOperation, SponsorReadOperationLimit>;
  actor: SponsorReadAllowance; campaign: SponsorReadAllowance;
};
const fail = (): never => { throw new SponsorEntitlementError("sponsor_read_policy_invalid"); };
const integer = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value)
  && Number(value) >= minimum && Number(value) <= maximum;

/** Closed, explicit review terms, not activation or defaults. Bytes cover the
 * combined retained reads and emitted response, including rejected work after
 * admission. Operational values must come from a reviewed stored policy. */
export function readSponsorReadPolicy(raw: unknown): Readonly<SponsorReadPolicyV1> {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["version", "windowMs", "operations", "actor", "campaign"])
    || raw.version !== 1 || !integer(raw.windowMs, 1, 31_536_000_000)
    || !record(raw.operations) || !exactKeys(raw.operations, SPONSOR_IMAGE_READ_OPERATIONS)) return fail();
  for (const allowance of [raw.actor, raw.campaign]) {
    if (!record(allowance) || !exactKeys(allowance, ["maximumRequestsPerWindow", "maximumBytesPerWindow"])
      || !integer(allowance.maximumRequestsPerWindow, 1, 1_000_000)
      || !integer(allowance.maximumBytesPerWindow, 1, 1_000_000_000_000)) return fail();
  }
  const policy = raw as SponsorReadPolicyV1;
  if (policy.actor.maximumRequestsPerWindow > policy.campaign.maximumRequestsPerWindow
    || policy.actor.maximumBytesPerWindow > policy.campaign.maximumBytesPerWindow) return fail();
  for (const operation of SPONSOR_IMAGE_READ_OPERATIONS) {
    const limit = raw.operations[operation];
    if (!record(limit) || !exactKeys(limit, ["maximumBytes", "deadlineMs"])
      || !integer(limit.maximumBytes, 1, 192_000_000) || !integer(limit.deadlineMs, 1, 30_000)
      || limit.maximumBytes > policy.actor.maximumBytesPerWindow) return fail();
  }
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorReadPolicyV1);
}

/** Dormant schema only. No installer, approval function, public route or schema
 * initializer imports this. A separately reviewed integration must provision a
 * policy for the original immutable sponsor-policy digest. Generation switches,
 * expiry and current campaign terms do not govern an already owned result.
 * The review receipt is provenance, not a substitute for that approval process. */
export const SPONSOR_READ_POLICY_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_read_policies(
    campaign_id TEXT NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),
    sponsor_policy_digest TEXT NOT NULL,read_policy_digest TEXT NOT NULL,policy_json TEXT NOT NULL,
    review_receipt_digest TEXT NOT NULL,
    PRIMARY KEY(campaign_id,sponsor_policy_digest))`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_read_policies_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_read_policies BEGIN SELECT RAISE(ABORT,'sponsor_read_policy_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_read_policies_no_replace BEFORE INSERT ON experience_sponsor_read_policies
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_read_policies old
      WHERE old.campaign_id=NEW.campaign_id AND old.sponsor_policy_digest=NEW.sponsor_policy_digest)
    BEGIN SELECT RAISE(ABORT,'sponsor_read_policy_exists'); END`,
]);
