// Types for the Detection Gallery

export interface BoundingBox {
  id: string;
  label: string;
  confidence: number;
  // Normalized coordinates [x, y, width, height] (0-1)
  bbox: [number, number, number, number];
  attributes?: Record<string, string | boolean>;
  isGroundTruth?: boolean;
}

export type LightingCondition = 'bright' | 'moderate' | 'dim';
export type Viewpoint = 'front' | 'side' | 'rear' | 'overhead';
export type BlurLevel = 'sharp' | 'motion-blur' | 'out-of-focus';
export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog';
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type EnvironmentType = 'indoor' | 'urban-street' | 'construction-site' | 'rural-field' | 'aerial-scene';

export interface SemanticAttributes {
  lighting: LightingCondition;
  viewpoint: Viewpoint;
  blur: BlurLevel;
  weather: WeatherCondition;
  timeOfDay: TimeOfDay;
  environment: EnvironmentType;
}

export interface SemanticMeta {
  source: 'placeholder' | 'bge-zero-shot' | 'manual' | string;
  confidence: number;
}

export interface DatasetImage {
  id: string;
  filepath: string;
  filename: string;
  width: number;
  height: number;
  split: 'train' | 'validation' | 'test';
  detections: BoundingBox[];
  // Pre-computed 2D embedding coordinates (UMAP/t-SNE)
  embedding2d: [number, number];
  // Metadata
  metadata: {
    source: string;
    captureDate: string;
    tags: string[];
    semantics: SemanticAttributes;
    semanticMeta?: Partial<Record<keyof SemanticAttributes, SemanticMeta>>;
  };
}

export interface DatasetInfo {
  id: string;
  name: string;
  description: string;
  imageCount: number;
  annotationCount: number;
  categories: string[];
  splits: {
    train: number;
    validation: number;
    test: number;
  };
}

export interface DatasetPayload {
  info: DatasetInfo;
  images: DatasetImage[];
  categories: string[];
  categoryCounts: Record<string, number>;
  embedding: {
    model: string;
    modelPath: string;
    status: 'pending' | 'running' | 'ready' | 'fallback';
    method: string;
    dimensions: number;
    generatedAt: string;
    message: string;
    performance?: {
      totalImages: number;
      encodedImages: number;
      cacheHits: number;
      totalInferenceSeconds: number;
      averageInferenceMsPerImage: number;
      batchSize: number;
      device: string;
    };
  };
}

export interface DatasetUploadJob {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string;
  progress: number;
  message: string;
  cached: boolean;
  dataset: DatasetPayload | null;
  error: string | null;
}

export type ViewMode = 'grid' | 'scatter';

export type ColorByMode =
  | 'split'
  | 'lighting'
  | 'viewpoint'
  | 'blur'
  | 'weather'
  | 'timeOfDay'
  | 'environment';

export interface FilterState {
  selectedCategories: string[];
  selectedSplits: ('train' | 'validation' | 'test')[];
  selectedTags: string[];
  selectedSemantics: Partial<Record<keyof SemanticAttributes, string[]>>;
  searchQuery: string;
}
