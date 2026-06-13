'use client';

import { useGalleryStore } from '@/lib/store';
import {
  CATEGORIES,
  CATEGORY_COLORS,
  datasetInfo,
  SEMANTIC_COLORS,
  SEMANTIC_LABELS,
  SEMANTIC_OPTIONS,
} from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import type { SemanticAttributes } from '@/lib/types';

export function Sidebar() {
  const {
    filters,
    toggleCategory,
    setConfidenceRange,
    images,
    toggleSemanticFilter,
  } = useGalleryStore();

  // Count annotations per category
  const categoryCounts: Record<string, number> = {};
  for (const img of images) {
    for (const det of img.detections) {
      categoryCounts[det.label] = (categoryCounts[det.label] || 0) + 1;
    }
  }

  // Collect all unique tags
  const semanticCounts: Record<keyof SemanticAttributes, Record<string, number>> = {
    lighting: {},
    viewpoint: {},
    blur: {},
    weather: {},
    timeOfDay: {},
    environment: {},
  };
  for (const img of images) {
    for (const key of Object.keys(semanticCounts) as (keyof SemanticAttributes)[]) {
      const value = img.metadata.semantics[key];
      semanticCounts[key][value] = (semanticCounts[key][value] || 0) + 1;
    }
  }

  return (
    <aside className="w-[260px] border-r border-[#1e2030] bg-[#0f1117] overflow-y-auto shrink-0 flex flex-col">
      {/* Categories */}
      <div className="p-4 border-b border-[#1e2030]">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-3">
          Categories
        </h3>
        <div className="space-y-1">
          {CATEGORIES.map((cat) => {
            const checked = filters.selectedCategories.includes(cat);
            const count = categoryCounts[cat] || 0;
            return (
              <label
                key={cat}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors',
                  checked ? 'bg-[#161822]' : 'hover:bg-[#161822]/50'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCategory(cat)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    'w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center transition-all',
                    checked ? 'border-transparent' : 'border-[#2a2d42]'
                  )}
                  style={{ backgroundColor: checked ? CATEGORY_COLORS[cat] : 'transparent' }}
                >
                  {checked && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={cn(
                  'text-xs flex-1',
                  checked ? 'text-[#e2e4f0]' : 'text-[#555872]'
                )}>
                  {cat}
                </span>
                <span className="text-[10px] text-[#555872] font-mono">{count}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Confidence Range */}
      <div className="p-4 border-b border-[#1e2030]">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-3">
          Confidence Range
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#555872] font-mono w-8 text-right">
            {filters.confidenceRange[0].toFixed(2)}
          </span>
          <div className="flex-1 flex gap-1">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={filters.confidenceRange[0]}
              onChange={(e) =>
                setConfidenceRange([parseFloat(e.target.value), filters.confidenceRange[1]])
              }
              className="flex-1 accent-[#6366f1] h-1"
            />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={filters.confidenceRange[1]}
              onChange={(e) =>
                setConfidenceRange([filters.confidenceRange[0], parseFloat(e.target.value)])
              }
              className="flex-1 accent-[#6366f1] h-1"
            />
          </div>
          <span className="text-[10px] text-[#555872] font-mono w-8">
            {filters.confidenceRange[1].toFixed(2)}
          </span>
        </div>
      </div>

      {/* Semantic Attributes */}
      <div className="p-4 border-b border-[#1e2030]">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-3">
          Semantic Attributes
        </h3>
        <div className="space-y-4">
          {(Object.keys(SEMANTIC_OPTIONS) as (keyof SemanticAttributes)[]).map((key) => (
            <div key={key}>
              <div className="text-[10px] text-[#555872] uppercase tracking-wider mb-1.5">
                {SEMANTIC_LABELS[key]}
              </div>
              <div className="flex flex-wrap gap-1">
                {SEMANTIC_OPTIONS[key].map((value) => {
                  const active = filters.selectedSemantics[key]?.includes(value) || false;
                  const count = semanticCounts[key][value] || 0;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleSemanticFilter(key, value)}
                      className={cn(
                        'flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-colors',
                        active
                          ? 'bg-[#1e2030] text-[#e2e4f0] ring-1 ring-[#2a2d42]'
                          : 'bg-[#161822]/60 text-[#8b8ea8] hover:bg-[#161822] hover:text-[#e2e4f0]'
                      )}
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: SEMANTIC_COLORS[key][value] }}
                      />
                      <span>{value}</span>
                      <span className="text-[#555872] font-mono">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Category Distribution */}
      <div className="p-4 border-b border-[#1e2030]">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-3">
          Distribution
        </h3>
        <div className="space-y-2">
          {CATEGORIES.filter((c) => categoryCounts[c]).map((cat) => {
            const count = categoryCounts[cat] || 0;
            const maxCount = Math.max(...Object.values(categoryCounts));
            const pct = (count / maxCount) * 100;
            return (
              <div key={cat} className="flex items-center gap-2">
                <span className="text-[10px] text-[#8b8ea8] w-16 truncate">{cat}</span>
                <div className="flex-1 h-2 bg-[#161822] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: CATEGORY_COLORS[cat],
                      opacity: 0.8,
                    }}
                  />
                </div>
                <span className="text-[10px] text-[#555872] font-mono w-6 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Split Distribution */}
      <div className="p-4">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-3">
          Split Distribution
        </h3>
        <div className="flex items-center gap-1 h-3 rounded-full overflow-hidden bg-[#161822]">
          {Object.entries(datasetInfo.splits).map(([split, count]) => {
            const pct = (count / datasetInfo.imageCount) * 100;
            const colors: Record<string, string> = {
              train: '#3b82f6',
              validation: '#f59e0b',
              test: '#10b981',
            };
            return (
              <div
                key={split}
                className="h-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  backgroundColor: colors[split],
                }}
                title={`${split}: ${count} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-2">
          {Object.entries(datasetInfo.splits).map(([split, count]) => {
            const colors: Record<string, string> = {
              train: '#3b82f6',
              validation: '#f59e0b',
              test: '#10b981',
            };
            return (
              <div key={split} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[split] }} />
                <span className="text-[10px] text-[#8b8ea8]">
                  {split.slice(0, 3)}: {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
