import { create } from 'zustand';
import type { ViewMode, ColorByMode, FilterState, DatasetImage, SemanticAttributes } from './types';
import {
  mockImages,
  CATEGORIES,
  SEMANTIC_LABELS,
  SEMANTIC_OPTIONS,
  SEMANTIC_VALUE_LABELS,
} from './mock-data';

interface GalleryState {
  // Data
  images: DatasetImage[];
  
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
  
  // Computed
  getFilteredImages: () => DatasetImage[];
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  images: mockImages,
  viewMode: 'grid',
  colorByMode: 'category',
  selectedImageId: null,
  activeDataset: 'ds-001',
  filters: {
    selectedCategories: [...CATEGORIES],
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

  getFilteredImages: () => {
    const { images, filters, scatterSelection } = get();
    return images.filter((img) => {
      // Split filter
      if (!filters.selectedSplits.includes(img.split)) return false;
      
      // Category filter - image must have at least one detection with selected category
      const hasSelectedCategory = img.detections.some((det) =>
        filters.selectedCategories.includes(det.label)
      );
      if (!hasSelectedCategory) return false;
      
      // Scatter selection filter
      if (scatterSelection.length > 0 && !scatterSelection.includes(img.id)) return false;

      // Semantic attribute filters - selected values within the same dimension are OR'ed.
      for (const [key, values] of Object.entries(filters.selectedSemantics)) {
        if (values.length === 0) continue;
        const semanticKey = key as keyof SemanticAttributes;
        if (!values.includes(img.metadata.semantics[semanticKey])) return false;
      }
      
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
}));
