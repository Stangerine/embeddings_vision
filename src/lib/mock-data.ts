import type { DatasetImage, DatasetInfo, BoundingBox, SemanticAttributes } from './types';

// Category definitions with colors
export const CATEGORIES = [
  'person', 'car', 'dog', 'cat', 'bird',
  'bicycle', 'truck', 'bus', 'motorcycle', 'traffic light',
];

export const CATEGORY_COLORS: Record<string, string> = {
  person: '#f43f5e',
  car: '#8b5cf6',
  dog: '#3b82f6',
  cat: '#06b6d4',
  bird: '#10b981',
  bicycle: '#eab308',
  truck: '#f97316',
  bus: '#ec4899',
  motorcycle: '#6366f1',
  'traffic light': '#14b8a6',
};

export const SPLIT_COLORS: Record<string, string> = {
  train: '#3b82f6',
  validation: '#f59e0b',
  test: '#10b981',
};

export const SPLIT_LABELS: Record<string, string> = {
  train: '训练集',
  validation: '验证集',
  test: '测试集',
};

export const SPLIT_SHORT_LABELS: Record<string, string> = {
  train: '训',
  validation: '验',
  test: '测',
};

export const SEMANTIC_OPTIONS: Record<keyof SemanticAttributes, string[]> = {
  lighting: ['bright', 'moderate', 'dim'],
  viewpoint: ['front', 'side', 'rear', 'overhead'],
  blur: ['sharp', 'motion-blur', 'out-of-focus'],
  weather: ['clear', 'cloudy', 'rain', 'snow', 'fog'],
  timeOfDay: ['day', 'dusk', 'night'],
  environment: ['indoor', 'urban-street', 'construction-site', 'rural-field', 'aerial-scene'],
};

export const SEMANTIC_LABELS: Record<keyof SemanticAttributes, string> = {
  lighting: '光照',
  viewpoint: '视角',
  blur: '清晰度',
  weather: '天气',
  timeOfDay: '时段',
  environment: '环境',
};

export const SEMANTIC_VALUE_LABELS: Record<keyof SemanticAttributes, Record<string, string>> = {
  lighting: {
    'front-lit': '正向受光',
    shadowed: '阴影遮挡',
    'night-lit': '夜间灯光',
    bright: '明亮',
    moderate: '适中',
    dim: '昏暗',
    backlit: '逆光',
    'low-light': '弱光',
    mixed: '混合光',
  },
  viewpoint: {
    front: '正面',
    side: '侧面',
    rear: '背面',
    overhead: '高位俯视',
    'top-down': '俯视',
    aerial: '航拍',
    wide: '广角',
    'close-up': '近景',
  },
  blur: {
    sharp: '清晰',
    'slight-blur': '轻微模糊',
    'motion-blur': '运动模糊',
    'out-of-focus': '失焦',
  },
  weather: {
    clear: '晴朗',
    cloudy: '多云',
    rain: '雨天',
    snow: '雪天',
    fog: '雾天',
    'fog-dust': '雾/扬尘',
    indoor: '室内',
  },
  timeOfDay: {
    day: '白天',
    dusk: '黄昏',
    night: '夜间',
  },
  environment: {
    indoor: '室内',
    outdoor: '户外',
    urban: '城市',
    rural: '乡村',
    road: '道路',
    aerial: '空中',
    'urban-street': '城市道路',
    'construction-site': '施工现场',
    'rural-field': '郊野场地',
    'aerial-scene': '航拍场景',
  },
};

export const SEMANTIC_COLORS: Record<keyof SemanticAttributes, Record<string, string>> = {
  lighting: {
    'front-lit': '#facc15',
    bright: '#facc15',
    moderate: '#22c55e',
    dim: '#a78bfa',
    backlit: '#fb7185',
    'low-light': '#60a5fa',
    mixed: '#34d399',
    shadowed: '#64748b',
    'night-lit': '#818cf8',
  },
  viewpoint: {
    front: '#22c55e',
    side: '#06b6d4',
    rear: '#f97316',
    overhead: '#8b5cf6',
    'top-down': '#8b5cf6',
    aerial: '#ec4899',
    wide: '#14b8a6',
    'close-up': '#eab308',
  },
  blur: {
    sharp: '#10b981',
    'slight-blur': '#f59e0b',
    'motion-blur': '#ef4444',
    'out-of-focus': '#a855f7',
  },
  weather: {
    clear: '#38bdf8',
    cloudy: '#94a3b8',
    rain: '#2563eb',
    snow: '#e2e8f0',
    fog: '#c4b5fd',
    'fog-dust': '#c4b5fd',
    indoor: '#f472b6',
  },
  timeOfDay: {
    day: '#facc15',
    dusk: '#fb923c',
    night: '#818cf8',
  },
  environment: {
    indoor: '#f472b6',
    outdoor: '#22c55e',
    urban: '#60a5fa',
    rural: '#84cc16',
    road: '#f97316',
    aerial: '#a855f7',
    'urban-street': '#60a5fa',
    'construction-site': '#f97316',
    'rural-field': '#84cc16',
    'aerial-scene': '#a855f7',
  },
};

// Seeded random for reproducibility
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = seededRandom(42);

function randomBBox(label: string, isGT: boolean): BoundingBox {
  const x = rand() * 0.7;
  const y = rand() * 0.7;
  const w = 0.05 + rand() * 0.3;
  const h = 0.05 + rand() * 0.3;
  return {
    id: `det-${Math.random().toString(36).slice(2, 9)}`,
    label,
    confidence: isGT ? 1.0 : 0.3 + rand() * 0.7,
    bbox: [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)],
    isGroundTruth: isGT,
    attributes: {
      occluded: rand() > 0.7,
      truncated: rand() > 0.8,
    },
  };
}

// Generate cluster centers for embedding visualization
const clusterCenters: Record<string, [number, number]> = {
  person: [-2.5, 1.8],
  car: [2.2, -1.5],
  dog: [-1.0, -2.8],
  cat: [1.5, 2.5],
  bird: [3.0, 3.0],
  bicycle: [-3.0, -1.0],
  truck: [2.8, -2.5],
  bus: [-2.0, -2.5],
  motorcycle: [0.5, -3.0],
  'traffic light': [3.5, 0.5],
};

function generateEmbedding2D(
  primaryLabel: string,
  split: string
): [number, number] {
  const center = clusterCenters[primaryLabel] || [0, 0];
  // Add some spread
  const spread = 1.2;
  const dx = (rand() - 0.5) * spread * 2;
  const dy = (rand() - 0.5) * spread * 2;
  // Slight split offset
  const splitOffset: Record<string, [number, number]> = {
    train: [0, 0],
    validation: [0.3, 0.2],
    test: [-0.2, 0.3],
  };
  const so = splitOffset[split] || [0, 0];
  return [center[0] + dx + so[0], center[1] + dy + so[1]];
}

const SOURCES = ['COCO-2024', 'CityScapes', 'Indoor-Scene', 'Aerial-View'];
const TAGS_POOL = ['outdoor', 'indoor', 'night', 'day', 'crowded', 'single-object', 'occluded', 'close-up', 'wide-angle'];

function pickWeighted<T extends string>(items: [T, number][]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = rand() * total;
  for (const [item, weight] of items) {
    cursor -= weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1][0];
}

function generateSemantics(source: string, tags: string[], primaryLabel: string): SemanticAttributes {
  const environment = source === 'Indoor-Scene'
    ? 'indoor'
    : source === 'Aerial-View'
      ? 'aerial-scene'
      : primaryLabel === 'car' || primaryLabel === 'truck' || primaryLabel === 'bus' || primaryLabel === 'traffic light'
        ? pickWeighted([['urban-street', 5], ['construction-site', 3], ['rural-field', 1]])
        : pickWeighted([['construction-site', 4], ['urban-street', 2], ['rural-field', 2], ['indoor', 1]]);

  const timeOfDay = tags.includes('night')
    ? 'night'
    : tags.includes('day')
      ? 'day'
      : pickWeighted([['day', 7], ['dusk', 2], ['night', 1]]);

  const lighting = timeOfDay === 'night'
    ? pickWeighted([['dim', 7], ['moderate', 3]])
    : environment === 'indoor'
      ? pickWeighted([['moderate', 6], ['dim', 3], ['bright', 1]])
      : pickWeighted([['bright', 5], ['moderate', 4], ['dim', 1]]);

  const viewpoint = environment === 'aerial-scene'
    ? 'overhead'
    : tags.includes('close-up')
      ? pickWeighted([['front', 3], ['side', 2]])
      : tags.includes('wide-angle')
        ? pickWeighted([['front', 3], ['side', 3], ['overhead', 1]])
        : pickWeighted([['front', 4], ['side', 4], ['rear', 1], ['overhead', 1]]);

  const blur = pickWeighted([
    ['sharp', 6],
    ['motion-blur', primaryLabel === 'car' || primaryLabel === 'motorcycle' ? 2 : 1],
    ['out-of-focus', 1],
  ]);

  const weather = environment === 'indoor'
    ? 'clear'
    : pickWeighted([['clear', 5], ['cloudy', 2], ['rain', 1], ['snow', 0.5], ['fog', 1.5]]);

  return {
    lighting,
    viewpoint,
    blur,
    weather,
    timeOfDay,
    environment,
  };
}

function generateImage(index: number): DatasetImage {
  const splits: ('train' | 'validation' | 'test')[] = ['train', 'validation', 'test'];
  // 70/15/15 split
  const r = rand();
  const split = r < 0.7 ? splits[0] : r < 0.85 ? splits[1] : splits[2];

  // 1-5 detections per image
  const numDetections = 1 + Math.floor(rand() * 5);
  const detections: BoundingBox[] = [];
  const usedLabels = new Set<string>();

  for (let i = 0; i < numDetections; i++) {
    let label = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
    // Avoid duplicate labels in same image (mostly)
    if (usedLabels.has(label) && rand() > 0.3) {
      label = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
    }
    usedLabels.add(label);
    // First detection is ground truth
    detections.push(randomBBox(label, i === 0));
    // Some images have additional predicted boxes
    if (rand() > 0.6) {
      detections.push(randomBBox(label, false));
    }
  }

  const primaryLabel = detections[0]?.label || 'person';
  const embedding2d = generateEmbedding2D(primaryLabel, split);

  const numTags = 1 + Math.floor(rand() * 3);
  const tags: string[] = [];
  for (let i = 0; i < numTags; i++) {
    const tag = TAGS_POOL[Math.floor(rand() * TAGS_POOL.length)];
    if (!tags.includes(tag)) tags.push(tag);
  }

  const widths = [640, 800, 1024, 1280, 1920];
  const heights = [480, 600, 768, 960, 1080];
  const wIdx = Math.floor(rand() * widths.length);

  const source = SOURCES[Math.floor(rand() * SOURCES.length)];
  const semantics = generateSemantics(source, tags, primaryLabel);
  const semanticTags = Object.values(semantics);

  return {
    id: `img-${String(index).padStart(4, '0')}`,
    filepath: `/images/${String(index).padStart(4, '0')}.jpg`,
    filename: `image_${String(index).padStart(4, '0')}.jpg`,
    width: widths[wIdx],
    height: heights[wIdx],
    split,
    detections,
    embedding2d,
    metadata: {
      source,
      captureDate: `2024-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
      tags: Array.from(new Set([...tags, ...semanticTags])),
      semantics,
    },
  };
}

// Generate dataset
const TOTAL_IMAGES = 120;
export const mockImages: DatasetImage[] = Array.from({ length: TOTAL_IMAGES }, (_, i) =>
  generateImage(i)
);

export const datasetInfo: DatasetInfo = {
  id: 'ds-001',
  name: '目标检测数据集 v2.1',
  description: '覆盖多场景、多语义属性的目标检测数据集',
  imageCount: TOTAL_IMAGES,
  annotationCount: mockImages.reduce((sum, img) => sum + img.detections.length, 0),
  categories: CATEGORIES,
  splits: {
    train: mockImages.filter((img) => img.split === 'train').length,
    validation: mockImages.filter((img) => img.split === 'validation').length,
    test: mockImages.filter((img) => img.split === 'test').length,
  },
};

// Generate placeholder image URLs using picsum
export function getImageUrl(imageId: string, width: number = 300, height: number = 200): string {
  if (imageId.startsWith('/api/')) return imageId;
  const idx = parseInt(imageId.replace('img-', ''), 10);
  return `https://picsum.photos/seed/det${idx}/${width}/${height}`;
}

// Color utilities
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#10b981';
  if (confidence >= 0.5) return '#f59e0b';
  return '#ef4444';
}

export function getConfidenceColorScale(confidence: number): string {
  // Green (high) -> Yellow (mid) -> Red (low)
  const r = confidence < 0.5 ? 255 : Math.round(255 * (1 - confidence) * 2);
  const g = confidence > 0.5 ? 255 : Math.round(255 * confidence * 2);
  return `rgb(${r}, ${g}, 80)`;
}
