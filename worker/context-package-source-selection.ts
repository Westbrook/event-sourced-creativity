/** The same licensed-source predicate is used by prechecks and transactional Output assertions. */
export function licensedPackageSourceBlocks<T extends {type:string;properties:Record<string,unknown>;rightsExpiresAt?:string|null;source?:unknown}>(blocks:readonly T[]):T[]{
  return blocks.filter((block)=>Boolean(block.source)||block.type==="reference"||Boolean(block.rightsExpiresAt)
    ||["reference_id","source_expires_at","license_expires_at","rights_expires_at","rights_revoked","source_rights_revoked","rights_class","rights_status","source_evidence_hash"]
      .some((field)=>block.properties[field]!==undefined&&block.properties[field]!==null&&block.properties[field]!==""));
}
