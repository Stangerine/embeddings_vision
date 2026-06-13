'use client';

import { useGalleryStore } from '@/lib/store';
import {
  CATEGORIES,
  SEMANTIC_LABELS,
  SEMANTIC_OPTIONS,
  SEMANTIC_VALUE_LABELS,
  SPLIT_LABELS,
} from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import type { SemanticAttributes } from '@/lib/types';

export function Sidebar() {
  const {
    filters,
    toggleCategory,
    toggleSplit,
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

  const splitCounts = images.reduce<Record<string, number>>((counts, img) => {
    counts[img.split] = (counts[img.split] || 0) + 1;
    return counts;
  }, {});

  // Count images by semantic attribute.
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
      {/* Dataset Splits */}
      <div className="p-4 border-b border-[#1e2030]">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-3">
          数据划分
        </h3>
        <div className="space-y-1">
          {(['train', 'validation', 'test'] as const).map((split) => {
            const checked = filters.selectedSplits.includes(split);
            return (
              <label
                key={split}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors',
                  checked ? 'bg-[#161822]' : 'hover:bg-[#161822]/50'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSplit(split)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    'w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center transition-all',
                    checked ? 'border-[#6366f1] bg-[#6366f1]' : 'border-[#2a2d42]'
                  )}
                >
                  {checked && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={cn('text-xs flex-1', checked ? 'text-[#e2e4f0]' : 'text-[#555872]')}>
                  {SPLIT_LABELS[split]}
                </span>
                <span className="text-[10px] text-[#555872] font-mono">{splitCounts[split] || 0}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Categories */}
      <div className="p-4 border-b border-[#1e2030]">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-3">
          目标类别
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
                    checked ? 'border-[#6366f1] bg-[#6366f1]' : 'border-[#2a2d42]'
                  )}
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

      {/* Semantic Attributes */}
      <div className="p-4 border-b border-[#1e2030]">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-3">
          语义属性
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
                        className={cn(
                          'flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border',
                          active ? 'border-[#6366f1] bg-[#6366f1]' : 'border-[#2a2d42]'
                        )}
                      >
                        {active && (
                          <svg className="h-2 w-2 text-white" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span>{SEMANTIC_VALUE_LABELS[key][value]}</span>
                      <span className="text-[#555872] font-mono">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
