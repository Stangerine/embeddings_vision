import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useGalleryStore } from './store';
import { SEMANTIC_OPTIONS } from './mock-data';
import type { DatasetPayload } from './types';

const payload: DatasetPayload = {
  info: {
    id: 'unit-dataset',
    name: 'Unit Dataset',
    description: 'unit',
    imageCount: 2,
    annotationCount: 2,
    categories: ['diaoche', 'wajueji'],
    splits: { train: 1, validation: 1, test: 0 },
  },
  categories: ['diaoche', 'wajueji'],
  categoryCounts: { diaoche: 1, wajueji: 1 },
  embedding: {
    model: 'bge-vl-large',
    modelPath: '/mock/model/BGE-VL-large',
    status: 'ready',
    method: 'test',
    dimensions: 2,
    generatedAt: '2026-06-17T00:00:00Z',
    message: 'test',
  },
  images: [
    {
      id: 'train-a',
      filepath: '/api/dataset/image?id=unit-dataset&path=train/images/a.jpg',
      filename: 'a.jpg',
      width: 100,
      height: 100,
      split: 'train',
      embedding2d: [0, 0],
      detections: [
        { id: 'a-0', label: 'diaoche', confidence: 1, bbox: [0, 0, 0.5, 0.5], isGroundTruth: true },
      ],
      metadata: {
        source: 'unit',
        captureDate: '2026-06-17',
        tags: ['bright'],
        semantics: {
          lighting: 'bright',
          viewpoint: 'front',
          blur: 'sharp',
          weather: 'clear',
          timeOfDay: 'day',
          environment: 'construction-site',
        },
      },
    },
    {
      id: 'validation-b',
      filepath: '/api/dataset/image?id=unit-dataset&path=val/images/b.jpg',
      filename: 'b.jpg',
      width: 100,
      height: 100,
      split: 'validation',
      embedding2d: [1, 1],
      detections: [
        { id: 'b-0', label: 'wajueji', confidence: 1, bbox: [0.1, 0.1, 0.5, 0.5], isGroundTruth: true },
      ],
      metadata: {
        source: 'unit',
        captureDate: '2026-06-17',
        tags: ['dim'],
        semantics: {
          lighting: 'dim',
          viewpoint: 'side',
          blur: 'motion-blur',
          weather: 'fog',
          timeOfDay: 'night',
          environment: 'urban-street',
        },
      },
    },
  ],
};

test('initial store waits for explicit zip upload before showing dataset images', () => {
  const state = useGalleryStore.getState();

  assert.equal(state.datasetInfo.id, 'empty');
  assert.equal(state.datasetInfo.imageCount, 0);
  assert.deepEqual(state.images, []);
  assert.deepEqual(state.categories, []);
  assert.equal(state.getFilteredImages().length, 0);
});

test('loadDataset restores the current cached dataset from the backend', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/dataset/current');
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const store = useGalleryStore.getState();
    await store.loadDataset();

    const state = useGalleryStore.getState();
    assert.equal(state.datasetInfo.id, 'unit-dataset');
    assert.equal(state.images.length, 2);
    assert.equal(state.activeDataset, 'unit-dataset');
    assert.equal(state.datasetError, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('semantic filter options keep the configured lighting and weather labels', () => {
  assert.deepEqual(SEMANTIC_OPTIONS.lighting, ['bright', 'moderate', 'dim']);
  assert.deepEqual(SEMANTIC_OPTIONS.weather, ['clear', 'cloudy', 'rain', 'snow', 'fog']);
});

test('applyDataset loads backend categories and applies semantic filters', () => {
  const store = useGalleryStore.getState();
  store.applyDataset(payload);

  let state = useGalleryStore.getState();
  assert.equal(state.datasetInfo.id, 'unit-dataset');
  assert.deepEqual(state.categories, ['diaoche', 'wajueji']);
  assert.equal(state.getFilteredImages().length, 2);

  state.setSemanticFilter('lighting', ['bright']);
  state = useGalleryStore.getState();
  assert.deepEqual(
    state.getFilteredImages().map((image) => image.id),
    ['train-a']
  );

  state.setSelectedCategories(['diaoche']);
  state = useGalleryStore.getState();
  assert.deepEqual(
    state.getFilteredImages().map((image) => image.id),
    ['train-a']
  );
});

test('empty semantic dimension is ignored instead of filtering out all images', () => {
  const store = useGalleryStore.getState();
  store.applyDataset({
    ...payload,
    info: { ...payload.info, id: 'empty-semantic-dimension-dataset' },
  });

  store.setSemanticFilter('lighting', ['bright']);
  store.setSemanticFilter('timeOfDay', []);

  const state = useGalleryStore.getState();
  assert.deepEqual(
    state.getFilteredImages().map((image) => image.id),
    ['train-a']
  );
});

test('progressive image limit controls how many filtered images are rendered first', () => {
  const store = useGalleryStore.getState();
  store.applyDataset({
    ...payload,
    info: { ...payload.info, id: 'progressive-dataset', imageCount: 2 },
    images: payload.images,
  });
  store.setSemanticFilter('lighting', [...SEMANTIC_OPTIONS.lighting]);
  store.setVisibleImageLimit(1);

  let state = useGalleryStore.getState();
  assert.equal(state.getVisibleFilteredImages().length, 1);
  assert.equal(state.getFilteredImages().length, 2);

  state.loadMoreImages();
  state = useGalleryStore.getState();
  assert.equal(state.getVisibleFilteredImages().length, 2);
});

test('focusImageInGrid selects an image, switches to grid, and expands visible range', () => {
  const store = useGalleryStore.getState();
  store.applyDataset({
    ...payload,
    info: { ...payload.info, id: 'focus-dataset' },
  });
  store.setSemanticFilter('lighting', [...SEMANTIC_OPTIONS.lighting]);
  store.setSemanticFilter('timeOfDay', [...SEMANTIC_OPTIONS.timeOfDay]);
  store.setVisibleImageLimit(1);
  store.setViewMode('scatter');

  store.focusImageInGrid('validation-b');

  const state = useGalleryStore.getState();
  assert.equal(state.viewMode, 'grid');
  assert.equal(state.selectedImageId, 'validation-b');
  assert.equal(state.gridFocusImageId, 'validation-b');
  assert.equal(state.getVisibleFilteredImages().length, 2);
});
