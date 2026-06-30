'use client';

import { useGalleryStore } from '@/lib/store';
import type { CleaningSuggestions } from '@/lib/types';

/**
 * Returns the precomputed cleaning suggestions from the backend (high-dim
 * cosine similarity for duplicates, k-NN distance for outliers), computed once
 * during dataset embedding. Returns null when disabled or not yet available.
 *
 * The `images` argument is kept for call-site compatibility but no longer
 * drives an O(n^2) in-browser computation.
 */
export function useCleaningIssues(
  _images: unknown,
  _options?: unknown,
  enabled = true
): CleaningSuggestions | null {
  const cleaning = useGalleryStore((s) => s.cleaning);
  if (!enabled) return null;
  return cleaning;
}
