import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";

export const SPONSOR_STORY_IO_OPERATIONS = Object.freeze(["short-story-status", "short-story-result"] as const);
export type SponsorStoryIoOperation = typeof SPONSOR_STORY_IO_OPERATIONS[number];
export type SponsorStoryIoAllowance = { maximumRequestsPerWindow: number; maximumBytesPerWindow: number };
export type SponsorStoryIoOperationLimit = { maximumBytes: number; deadlineMs: number };
export type SponsorStoryIoPolicyV1 = {
  version: 1; family: "canonical-short-story-io@1"; purpose: "selected-result"; windowMs: number;
  operations: Record<SponsorStoryIoOperation, SponsorStoryIoOperationLimit>;
  actor: SponsorStoryIoAllowance; campaign: SponsorStoryIoAllowance;
};
const fail = (): never => { throw new SponsorEntitlementError("sponsor_story_io_policy_invalid"); };
const integer = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value)
  && Number(value) >= minimum && Number(value) <= maximum;

/** Explicit selected-result Short story read terms; no default allocation.
 * Bytes cover combined retained reads and emitted responses, including failed
 * admitted work. There is no storage, intake, upload or generation permission. */
export function readSponsorStoryIoPolicy(raw: unknown): Readonly<SponsorStoryIoPolicyV1> {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["version", "family", "purpose", "windowMs", "operations", "actor", "campaign"])
    || raw.version !== 1 || raw.family !== "canonical-short-story-io@1" || raw.purpose !== "selected-result" || !integer(raw.windowMs, 1, 31_536_000_000)
    || !record(raw.operations) || !exactKeys(raw.operations, SPONSOR_STORY_IO_OPERATIONS)) return fail();
  for (const allowance of [raw.actor, raw.campaign]) {
    if (!record(allowance) || !exactKeys(allowance, ["maximumRequestsPerWindow", "maximumBytesPerWindow"])
      || !integer(allowance.maximumRequestsPerWindow, 1, 1_000_000)
      || !integer(allowance.maximumBytesPerWindow, 1, 1_000_000_000_000)) return fail();
  }
  const policy = raw as SponsorStoryIoPolicyV1;
  if (policy.actor.maximumRequestsPerWindow > policy.campaign.maximumRequestsPerWindow
    || policy.actor.maximumBytesPerWindow > policy.campaign.maximumBytesPerWindow) return fail();
  for (const operation of SPONSOR_STORY_IO_OPERATIONS) {
    const limit = raw.operations[operation];
    if (!record(limit) || !exactKeys(limit, ["maximumBytes", "deadlineMs"])
      || !integer(limit.maximumBytes, 1, 192_000_000) || !integer(limit.deadlineMs, 1, 30_000)
      || limit.maximumBytes > policy.actor.maximumBytesPerWindow) return fail();
  }
  return freeze(JSON.parse(canonicalJson(raw)) as SponsorStoryIoPolicyV1);
}

/** Dormant immutable allocation; importing installs nothing. Original V4 payer
 * approval provisions the exact original sponsor-policy digest. Existing-result
 * consumption later uses this provenance and current native actor/custody proof,
 * without depending on generation enablement, expiry or remaining allowance.
 * A consumer must reserve each actual request and enforce bytes/deadline. */
export const SPONSOR_STORY_IO_POLICY_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_story_io_policies(
    campaign_id TEXT NOT NULL REFERENCES experience_sponsor_campaigns(campaign_id),
    sponsor_policy_digest TEXT NOT NULL,io_policy_digest TEXT NOT NULL,policy_json TEXT NOT NULL,
    review_receipt_digest TEXT NOT NULL,
    PRIMARY KEY(campaign_id,sponsor_policy_digest)) WITHOUT ROWID`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_story_io_policies_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_story_io_policies BEGIN SELECT RAISE(ABORT,'sponsor_story_io_policy_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_story_io_policies_no_replace BEFORE INSERT ON experience_sponsor_story_io_policies
    WHEN EXISTS(SELECT 1 FROM experience_sponsor_story_io_policies old
      WHERE old.campaign_id=NEW.campaign_id AND old.sponsor_policy_digest=NEW.sponsor_policy_digest)
    BEGIN SELECT RAISE(ABORT,'sponsor_story_io_policy_exists'); END`,
]);
