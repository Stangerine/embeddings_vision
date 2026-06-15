import type { DatasetImage } from '../types';
import type {
  CleaningOptions,
  CleaningResult,
  DuplicatePair,
  OutlierIssue,
} from './types';
import { DEFAULT_CLEANING_OPTIONS } from './types';

function euclid(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function withDefaults(opts?: Partial<CleaningOptions>): CleaningOptions {
  return { ...DEFAULT_CLEANING_OPTIONS, ...(opts ?? {}) };
}

/**
 * Outlier detection via average k-nearest-neighbour distance.
 * Points whose score exceeds mean + sigma * std are flagged.
 * O(n^2) — fine for prototype-scale datasets (< 10k).
 */
export function detectOutliers(
  images: DatasetImage[],
  opts?: Partial<CleaningOptions>
): OutlierIssue[] {
  const { kNeighbors, outlierThresholdSigma } = withDefaults(opts);
  const n = images.length;
  if (n <= kNeighbors) return [];

  const scores = images.map((img, i) => {
    const dists: { id: string; d: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      dists.push({ id: images[j].id, d: euclid(img.embedding2d, images[j].embedding2d) });
    }
    dists.sort((a, b) => a.d - b.d);
    const knn = dists.slice(0, kNeighbors);
    const avg = knn.reduce((s, x) => s + x.d, 0) / kNeighbors;
    return { imageId: img.id, score: avg, neighbors: knn.map((x) => x.id) };
  });

  const mean = scores.reduce((s, x) => s + x.score, 0) / scores.length;
  const variance =
    scores.reduce((s, x) => s + (x.score - mean) ** 2, 0) / scores.length;
  const std = Math.sqrt(variance);
  const threshold = mean + outlierThresholdSigma * std;

  return scores
    .filter((s) => s.score > threshold)
    .sort((a, b) => b.score - a.score)
    .map((s) => ({
      type: 'outlier' as const,
      imageId: s.imageId,
      score: s.score,
      neighbors: s.neighbors,
    }));
}

/**
 * Near-duplicate detection via pairwise distance in 2D embedding space.
 * Note: 2D projection can collapse points that differ in higher dims — treat
 * suggestions as candidates, not ground truth.
 */
export function detectDuplicates(
  images: DatasetImage[],
  opts?: Partial<CleaningOptions>
): DuplicatePair[] {
  const { duplicateEpsilon } = withDefaults(opts);
  const n = images.length;
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = euclid(images[i].embedding2d, images[j].embedding2d);
      if (d < duplicateEpsilon) {
        pairs.push({
          type: 'duplicate',
          imageIdA: images[i].id,
          imageIdB: images[j].id,
          distance: d,
        });
      }
    }
  }
  return pairs.sort((a, b) => a.distance - b.distance);
}

export function runCleaning(
  images: DatasetImage[],
  opts?: Partial<CleaningOptions>
): CleaningResult {
  return {
    outliers: detectOutliers(images, opts),
    duplicates: detectDuplicates(images, opts),
  };
}
