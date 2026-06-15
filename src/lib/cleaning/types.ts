// Cleaning analysis types for the vector distribution canvas

export type IssueType = 'outlier' | 'duplicate';

export interface OutlierIssue {
  type: 'outlier';
  imageId: string;
  /** Average distance to k nearest neighbours in 2D embedding space. */
  score: number;
  /** Ids of the k nearest neighbours. */
  neighbors: string[];
}

export interface DuplicatePair {
  type: 'duplicate';
  imageIdA: string;
  imageIdB: string;
  /** Distance between the two points. */
  distance: number;
}

export interface CleaningResult {
  outliers: OutlierIssue[];
  duplicates: DuplicatePair[];
}

export interface CleaningOptions {
  /** Number of neighbours for outlier scoring. */
  kNeighbors: number;
  /** Outlier cut-off: mean + sigma * std of neighbour distance. */
  outlierThresholdSigma: number;
  /** Max distance between two points to be considered near-duplicates. */
  duplicateEpsilon: number;
}

export const DEFAULT_CLEANING_OPTIONS: CleaningOptions = {
  kNeighbors: 6,
  outlierThresholdSigma: 1.5,
  duplicateEpsilon: 0.13,
};
