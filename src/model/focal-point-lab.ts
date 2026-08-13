import { CURRENT_FOCAL_POINT_METHOD, type ImageFocalPoint } from "./focal-point.ts";

export type FocalPointCandidate<T> = {
  item: T;
  focalPoint: ImageFocalPoint;
};

const distance = (left: ImageFocalPoint, right: ImageFocalPoint) =>
  Math.hypot(left.x - right.x, left.y - right.y);

/**
 * Selects a small review set whose focal points cover as much of the image
 * plane as the available assets allow. This keeps the visual lab useful when
 * a project contains many near-centred outputs.
 */
export function diverseFocalPointCandidates<T>(
  candidates: FocalPointCandidate<T>[],
  limit = 6,
) {
  if (limit <= 0 || !candidates.length) return [];
  const remaining = [...candidates];
  const center: ImageFocalPoint = {
    x: .5,
    y: .5,
    confidence: 1,
    method: CURRENT_FOCAL_POINT_METHOD,
    sampleWidth: 1,
    sampleHeight: 1,
  };
  const firstIndex = remaining.reduce((best, candidate, index) =>
    distance(candidate.focalPoint, center) > distance(remaining[best].focalPoint, center) ? index : best, 0);
  const selected = [remaining.splice(firstIndex, 1)[0]];

  while (selected.length < limit && remaining.length) {
    const nextIndex = remaining.reduce((best, candidate, index) => {
      const nearest = Math.min(...selected.map((picked) => distance(candidate.focalPoint, picked.focalPoint)));
      const bestNearest = Math.min(...selected.map((picked) => distance(remaining[best].focalPoint, picked.focalPoint)));
      return nearest > bestNearest ? index : best;
    }, 0);
    selected.push(remaining.splice(nextIndex, 1)[0]);
  }

  return selected;
}
