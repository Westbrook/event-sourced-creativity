import { freeze, jsonIssues } from "../src/experiences/compiler.ts";

/** Only the captured byte field uses the transport's explicit bound. Retain
 * every other JSON/descriptor guard; never inspect an accessor or clone before
 * the dedicated encoded-byte cap has been checked. The caller owns its existing
 * refusal code and all lease, identity, decoded-byte and hash checks. */
export function captureBoundedVideoEnvelope<T extends object>(value: T, field: "bodyBase64" | "decodedBodyBase64", maximumBytes: number, reject: () => never): T {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || jsonIssues(value).some(issue => issue.code !== "string_limit" || issue.path !== `$.${field}`)) reject();
  const encoded = Object.getOwnPropertyDescriptor(value, field)?.value;
  if (typeof encoded !== "string" || encoded.length > Math.ceil(maximumBytes / 3) * 4) reject();
  return freeze(structuredClone(value));
}
