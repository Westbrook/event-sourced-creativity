/** This namespace never falls through to whole-Document sharing. Invalid tokens
 * select the unavailable recipient, without decoding a different authority. */
export function isSelectedOutputSharePagePath(pathname: string): boolean {
  return pathname === "/share/output" || pathname.startsWith("/share/output/");
}

export function selectedOutputSharePageToken(pathname: string): string {
  return pathname.match(/^\/share\/output\/([A-Za-z0-9_-]{32})\/?$/u)?.[1] ?? "";
}
