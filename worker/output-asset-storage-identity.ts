type StorageScope = { ownerUserId: string; projectId: string; documentId: string; key: string };
const encode = (value: string) => {
  if (!value || value === "." || value === ".." || value.length > 160) throw new Error("invalid_output_asset_storage_scope");
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
};
export function outputAssetDocumentPrefix(scope: Pick<StorageScope, "ownerUserId" | "projectId" | "documentId">) {
  return `output-requirements/${encode(scope.ownerUserId)}/${encode(scope.projectId)}/${encode(scope.documentId)}/`;
}
export function outputAssetObjectKeys(scope: StorageScope, assetId: string, sha256: string, extension: string) {
  if (!/^[a-f0-9]{64}$/u.test(sha256) || !/^(?:png|jpg|jpeg|wav|mp3|mp4|pptx|glb|md)$/u.test(extension)) throw new Error("invalid_output_asset_storage_identity");
  const safeLegacy = [scope.ownerUserId, assetId].every((part) => /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/u.test(part));
  return { key: `${outputAssetDocumentPrefix(scope)}${encode(assetId)}/${sha256}.${extension}`, legacyKey: safeLegacy ? `output-requirements/${scope.ownerUserId}/${assetId}/${sha256}.${extension}` : null };
}
export function outputAssetStorageCustodyMatches(expected: { ownerUserId: string; projectId: string; documentId: string; assetId: string; scopeKey: string; sha256: string; storageKey: string }, metadata: Record<string, string> | undefined) {
  const extension = /\.([a-z0-9]+)$/u.exec(expected.storageKey)?.[1];
  if (!extension) return false;
  let keys: ReturnType<typeof outputAssetObjectKeys>;
  try { keys = outputAssetObjectKeys({ ownerUserId: expected.ownerUserId, projectId: expected.projectId, documentId: expected.documentId, key: expected.scopeKey }, expected.assetId, expected.sha256, extension); } catch { return false; }
  if (expected.storageKey !== keys.key && expected.storageKey !== keys.legacyKey) return false;
  return metadata?.outputRequirementAsset === "1" && metadata.ownerId === expected.ownerUserId && metadata.scopeKey === expected.scopeKey
    && metadata.assetId === expected.assetId && metadata.documentId === expected.documentId && metadata.sha256 === expected.sha256
    && (expected.storageKey === keys.key ? metadata.projectId === expected.projectId : metadata.projectId === undefined || metadata.projectId === expected.projectId);
}
