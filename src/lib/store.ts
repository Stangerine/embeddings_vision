import { create } from 'zustand';
import type {
  ViewMode,
  ColorByMode,
  FilterState,
  DatasetImage,
  DatasetInfo,
  DatasetPayload,
  DatasetUploadJob,
  SemanticAttributes,
} from './types';
import { fetchCurrentDataset, fetchUploadJob, uploadDatasetZip } from './dataset-api';
import {
  SEMANTIC_LABELS,
  SEMANTIC_OPTIONS,
  SEMANTIC_VALUE_LABELS,
} from './mock-data';

const emptyDatasetInfo: DatasetInfo = {
  id: 'empty',
  name: '未加载数据集',
  description: '点击上传 ZIP 后展示真实数据集信息',
  imageCount: 0,
  annotationCount: 0,
  categories: [],
  splits: {
    train: 0,
    validation: 0,
    test: 0,
  },
};

const INITIAL_VISIBLE_IMAGE_LIMIT = 200;
const VISIBLE_IMAGE_BATCH_SIZE = 200;

interface GalleryState {
  // Data
  images: DatasetImage[];
  datasetInfo: DatasetInfo;
  categories: string[];
  categoryCounts: Record<string, number>;
  embeddingInfo: DatasetPayload['embedding'] | null;
  isLoadingDataset: boolean;
  isUploadingDataset: boolean;
  uploadJob: DatasetUploadJob | null;
  datasetError: string | null;
  
  // View
  viewMode: ViewMode;
  colorByMode: ColorByMode;
  selectedImageId: string | null;
  
  // Dataset
  activeDataset: string;
  
  // Filters
  filters: FilterState;
  
  // Scatter selection
  scatterSelection: string[];
  
  // Grid density
  gridColumns: number;
  visibleImageLimit: number;
  
  // Actions
  setViewMode: (mode: ViewMode) => void;
  setColorByMode: (mode: ColorByMode) => void;
  selectImage: (id: string | null) => void;
  setActiveDataset: (id: string) => void;
  setFilters: (filters: Partial<FilterState>) => void;
  toggleCategory: (category: string) => void;
  setSelectedCategories: (categories: string[]) => void;
  toggleSplit: (split: 'train' | 'validation' | 'test') => void;
  setSelectedSplits: (splits: ('train' | 'validation' | 'test')[]) => void;
  toggleSemanticFilter: (key: keyof SemanticAttributes, value: string) => void;
  setSemanticFilter: (key: keyof SemanticAttributes, values: string[]) => void;
  setScatterSelection: (ids: string[]) => void;
  setGridColumns: (cols: number) => void;
  setVisibleImageLimit: (limit: number) => void;
  loadMoreImages: () => void;
  loadDataset: () => Promise<void>;
  uploadDataset: (file: File) => Promise<void>;
  applyDataset: (payload: DatasetPayload) => void;
  
  // Computed
  getFilteredImages: () => DatasetImage[];
  getVisibleFilteredImages: () => DatasetImage[];
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  images: [],
  datasetInfo: emptyDatasetInfo,
  categories: [],
  categoryCounts: {},
  embeddingInfo: null,
  isLoadingDataset: false,
  isUploadingDataset: false,
  uploadJob: null,
  datasetError: null,
  viewMode: 'grid',
  colorByMode: 'split',
  selectedImageId: null,
  activeDataset: 'empty',
  filters: {
    selectedCategories: [],
    selectedSplits: ['train', 'validation', 'test'],
    selectedTags: [],
    selectedSemantics: {
      lighting: [...SEMANTIC_OPTIONS.lighting],
      viewpoint: [...SEMANTIC_OPTIONS.viewpoint],
      blur: [...SEMANTIC_OPTIONS.blur],
      weather: [...SEMANTIC_OPTIONS.weather],
      timeOfDay: [...SEMANTIC_OPTIONS.timeOfDay],
      environment: [...SEMANTIC_OPTIONS.environment],
    },
    searchQuery: '',
  },
  scatterSelection: [],
  gridColumns: 4,
  visibleImageLimit: INITIAL_VISIBLE_IMAGE_LIMIT,

  setViewMode: (mode) => set({ viewMode: mode }),
  setColorByMode: (mode) => set({ colorByMode: mode }),
  selectImage: (id) => set({ selectedImageId: id }),
  setActiveDataset: (id) => set({ activeDataset: id }),
  
  setFilters: (partial) =>
    set((state) => ({
      filters: { ...state.filters, ...partial },
    })),
  
  toggleCategory: (category) =>
    set((state) => {
      const current = state.filters.selectedCategories;
      const next = current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category];
      return { filters: { ...state.filters, selectedCategories: next } };
    }),

  setSelectedCategories: (categories) =>
    set((state) => ({
      filters: { ...state.filters, selectedCategories: categories },
    })),
  
  toggleSplit: (split) =>
    set((state) => {
      const current = state.filters.selectedSplits;
      const next = current.includes(split)
        ? current.filter((s) => s !== split)
        : [...current, split];
      return { filters: { ...state.filters, selectedSplits: next } };
    }),

  setSelectedSplits: (splits) =>
    set((state) => ({
      filters: { ...state.filters, selectedSplits: splits },
    })),

  toggleSemanticFilter: (key, value) =>
    set((state) => {
      const current = state.filters.selectedSemantics[key] || [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return {
        filters: {
          ...state.filters,
          selectedSemantics: {
            ...state.filters.selectedSemantics,
            [key]: next,
          },
        },
      };
    }),

  setSemanticFilter: (key, values) =>
    set((state) => ({
      filters: {
        ...state.filters,
        selectedSemantics: {
          ...state.filters.selectedSemantics,
          [key]: values,
        },
      },
    })),
  
  setScatterSelection: (ids) => set({ scatterSelection: ids }),
  setGridColumns: (cols) => set({ gridColumns: cols }),
  setVisibleImageLimit: (limit) => set({ visibleImageLimit: Math.max(1, limit) }),
  loadMoreImages: () =>
    set((state) => ({
      visibleImageLimit: state.visibleImageLimit + VISIBLE_IMAGE_BATCH_SIZE,
    })),
  applyDataset: (payload) =>
    set((state) => {
      const isSameDataset = state.activeDataset === payload.info.id;
      return {
        images: payload.images,
        datasetInfo: payload.info,
        categories: payload.categories,
        categoryCounts: payload.categoryCounts,
        embeddingInfo: payload.embedding,
        activeDataset: payload.info.id,
        selectedImageId: isSameDataset ? state.selectedImageId : null,
        scatterSelection: isSameDataset ? state.scatterSelection : [],
        visibleImageLimit: isSameDataset ? state.visibleImageLimit : INITIAL_VISIBLE_IMAGE_LIMIT,
        datasetError: null,
        filters: {
          ...state.filters,
          selectedCategories: isSameDataset
            ? state.filters.selectedCategories
            : [...payload.categories],
          selectedSplits: isSameDataset
            ? state.filters.selectedSplits
            : ['train', 'validation', 'test'],
          selectedSemantics: state.filters.selectedSemantics,
        },
      };
    }),

  loadDataset: async () => {
    set({ isLoadingDataset: true, datasetError: null });
    try {
      const payload = await fetchCurrentDataset();
      get().applyDataset(payload);
    } catch (error) {
      set({ datasetError: error instanceof Error ? error.message : '加载数据集失败' });
    } finally {
      set({ isLoadingDataset: false });
    }
  },

  uploadDataset: async (file) => {
    set({ isUploadingDataset: true, uploadJob: null, datasetError: null });
    try {
      let job = await uploadDatasetZip(file);
      set({ uploadJob: job });
      if (job.dataset) {
        get().applyDataset(job.dataset);
        set({ uploadJob: job });
      }

      while (job.status === 'queued' || job.status === 'running') {
        await sleep(800);
        job = await fetchUploadJob(job.jobId);
        set({ uploadJob: job });
        if (job.dataset) {
          get().applyDataset(job.dataset);
          set({ uploadJob: job });
        }
      }

      if (job.status === 'completed' && job.dataset) {
        get().applyDataset(job.dataset);
        set({ uploadJob: job });
        return;
      }

      throw new Error(job.error || job.message || '数据集解析失败');
    } catch (error) {
      set({ datasetError: error instanceof Error ? error.message : '上传数据集失败' });
    } finally {
      set({ isUploadingDataset: false });
    }
  },

  getFilteredImages: () => {
    const { images, filters, scatterSelection } = get();
    return images.filter((img) => {
      // Split filter
      if (!filters.selectedSplits.includes(img.split)) return false;
      
      // Category filter - image must have at least one detection with selected category
      if (filters.selectedCategories.length === 0) return false;
      const hasSelectedCategory = img.detections.some((det) =>
        filters.selectedCategories.includes(det.label)
      );
      if (!hasSelectedCategory) return false;
      
      // Scatter selection filter
      if (scatterSelection.length > 0 && !scatterSelection.includes(img.id)) return false;

      // Semantic filters are intentionally display-only for now. The controls stay visible,
      // but semantic filtering will be backed by real semantic attributes in a later phase.
      
      // Search query
      if (filters.searchQuery) {
        const q = filters.searchQuery.toLowerCase();
        const matchesFilename = img.filename.toLowerCase().includes(q);
        const matchesCategory = img.detections.some((d) => d.label.toLowerCase().includes(q));
        const matchesTag = img.metadata.tags.some((t) => t.toLowerCase().includes(q));
        const matchesSemantics = Object.entries(img.metadata.semantics).some(([key, value]) => {
          const semanticKey = key as keyof SemanticAttributes;
          return (
            value.toLowerCase().includes(q) ||
            SEMANTIC_LABELS[semanticKey].toLowerCase().includes(q) ||
            SEMANTIC_VALUE_LABELS[semanticKey][value].toLowerCase().includes(q)
          );
        });
        if (!matchesFilename && !matchesCategory && !matchesTag && !matchesSemantics) return false;
      }
      
      return true;
    });
  },

  getVisibleFilteredImages: () => {
    const { visibleImageLimit } = get();
    return get().getFilteredImages().slice(0, visibleImageLimit);
  },
}));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
