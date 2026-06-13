'use client';

import { useGalleryStore } from '@/lib/store';
import { datasetInfo, SPLIT_COLORS } from '@/lib/mock-data';
import type { ViewMode } from '@/lib/types';
import { cn } from '@/lib/utils';

const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: 'grid', label: 'Grid', icon: '⊞' },
  { mode: 'scatter', label: 'Embedding', icon: '◎' },
];

export function TopBar() {
  const {
    viewMode,
    setViewMode,
    filters,
    setFilters,
    getFilteredImages,
  } = useGalleryStore();

  const filteredCount = getFilteredImages().length;

  return (
    <header className="h-[52px] border-b border-[#1e2030] bg-[#0f1117] flex items-center px-4 gap-4 shrink-0">
      {/* Logo & Dataset */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-[#6366f1] flex items-center justify-center text-white text-xs font-bold">
            DG
          </div>
          <span className="text-[#e2e4f0] font-semibold text-sm whitespace-nowrap">
            {datasetInfo.name}
          </span>
        </div>
      </div>

      {/* Split Tabs */}
      <div className="flex items-center gap-1 bg-[#161822] rounded-md p-0.5">
        {(['train', 'validation', 'test'] as const).map((split) => {
          const active = filters.selectedSplits.includes(split);
          const count = datasetInfo.splits[split];
          return (
            <button
              key={split}
              onClick={() => {
                const store = useGalleryStore.getState();
                store.toggleSplit(split);
              }}
              className={cn(
                'px-3 py-1.5 rounded text-xs font-medium transition-all duration-150 flex items-center gap-1.5',
                active
                  ? 'bg-[#1e2030] text-[#e2e4f0]'
                  : 'text-[#555872] hover:text-[#8b8ea8]'
              )}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: active ? SPLIT_COLORS[split] : '#555872' }}
              />
              {split.charAt(0).toUpperCase() + split.slice(1)}
              <span className="text-[#555872] ml-0.5">{count}</span>
            </button>
          );
        })}
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-1 bg-[#161822] rounded-md p-0.5">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => setViewMode(opt.mode)}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-medium transition-all duration-150 flex items-center gap-1.5',
              viewMode === opt.mode
                ? 'bg-[#6366f1] text-white'
                : 'text-[#8b8ea8] hover:text-[#e2e4f0]'
            )}
          >
            <span className="text-sm">{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex-1 max-w-xs">
        <input
          type="text"
          placeholder="Search images, labels, tags..."
          value={filters.searchQuery}
          onChange={(e) => setFilters({ searchQuery: e.target.value })}
          className="w-full h-8 px-3 bg-[#161822] border border-[#1e2030] rounded-md text-xs text-[#e2e4f0] placeholder-[#555872] focus:outline-none focus:border-[#6366f1] transition-colors"
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-[#8b8ea8]">
        <span>
          <span className="text-[#e2e4f0] font-medium">{filteredCount}</span>
          <span className="text-[#555872]"> / {datasetInfo.imageCount} images</span>
        </span>
        <span>
          <span className="text-[#e2e4f0] font-medium">{datasetInfo.annotationCount}</span>
          <span className="text-[#555872]"> annotations</span>
        </span>
      </div>
    </header>
  );
}
