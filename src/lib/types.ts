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

export type LightingCondition = 'bright' | 'dim' | 'backlit' | 'low-light' | 'mixed';
export type Viewpoint = 'front' | 'side' | 'rear' | 'top-down' | 'aerial' | 'wide' | 'close-up';
export type BlurLevel = 'sharp' | 'slight-blur' | 'motion-blur' | 'out-of-focus';
export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'indoor';
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type EnvironmentType = 'indoor' | 'outdoor' | 'urban' | 'rural' | 'road' | 'aerial';

export interface SemanticAttributes {
  lighting: LightingCondition;
  viewpoint: Viewpoint;
  blur: BlurLevel;
  weather: WeatherCondition;
  timeOfDay: TimeOfDay;
  environment: EnvironmentType;
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
