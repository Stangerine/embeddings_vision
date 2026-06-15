'use client';

import { useMemo } from 'react';
import type { DatasetImage } from '@/lib/types';
import { runCleaning, type CleaningOptions, type CleaningResult } from '@/lib/cleaning';

/**
 * Memoized cleaning analysis. Returns null when disabled or no images.
 */
export function useCleaningIssues(
  images: DatasetImage[],
  options?: Partial<CleaningOptions>,
  enabled = true
): CleaningResult | null {
  return useMemo(() => {
    if (!enabled || images.length === 0) return null;
    return runCleaning(images, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, enabled, options?.kNeighbors, options?.outlierThresholdSigma, options?.duplicateEpsilon]);
}
