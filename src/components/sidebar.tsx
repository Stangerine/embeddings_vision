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
    setSelectedCategories,
    toggleSplit,
    setSelectedSplits,
    images,
    toggleSemanticFilter,
    setSemanticFilter,
  } = useGalleryStore();

  const allSplits = ['train', 'validation', 'test'] as const;

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
    <aside className="w-[260px] border-r border-[#E2E8F0] bg-[#FFFFFF] overflow-y-auto shrink-0 flex flex-col">
      {/* Dataset Splits */}
      <div className="p-4 border-b border-[#E2E8F0]">
        <FilterHeader
          title="数据划分"
          selected={filters.selectedSplits.length}
          total={allSplits.length}
          onSelectAll={() => setSelectedSplits([...allSplits])}
          onClear={() => setSelectedSplits([])}
        />
        <div className="space-y-1">
          {allSplits.map((split) => {
            const checked = filters.selectedSplits.includes(split);
            return (
              <label
                key={split}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors',
                  checked ? 'bg-[#F8FAFC]' : 'hover:bg-[#F8FAFC]/50'
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
                    checked ? 'border-[#2563EB] bg-[#2563EB]' : 'border-[#CBD5E1]'
                  )}
                >
                  {checked && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={cn('text-xs flex-1', checked ? 'text-[#0F172A]' : 'text-[#64748B]')}>
                  {SPLIT_LABELS[split]}
                </span>
                <span className="text-[10px] text-[#64748B] font-mono">{splitCounts[split] || 0}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Categories */}
      <div className="p-4 border-b border-[#E2E8F0]">
        <FilterHeader
          title="目标类别"
          selected={filters.selectedCategories.length}
          total={CATEGORIES.length}
          onSelectAll={() => setSelectedCategories([...CATEGORIES])}
          onClear={() => setSelectedCategories([])}
        />
        <div className="space-y-1">
          {CATEGORIES.map((cat) => {
            const checked = filters.selectedCategories.includes(cat);
            const count = categoryCounts[cat] || 0;
            return (
              <label
                key={cat}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors',
                  checked ? 'bg-[#F8FAFC]' : 'hover:bg-[#F8FAFC]/50'
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
                    checked ? 'border-[#2563EB] bg-[#2563EB]' : 'border-[#CBD5E1]'
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
                  checked ? 'text-[#0F172A]' : 'text-[#64748B]'
                )}>
                  {cat}
                </span>
                <span className="text-[10px] text-[#64748B] font-mono">{count}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Semantic Attributes */}
      <div className="p-4 border-b border-[#E2E8F0]">
        <h3 className="text-xs font-semibold text-[#475569] uppercase tracking-wider mb-3">
          语义属性
        </h3>
        <div className="space-y-4">
          {(Object.keys(SEMANTIC_OPTIONS) as (keyof SemanticAttributes)[]).map((key) => (
            <div key={key}>
              <FilterHeader
                title={SEMANTIC_LABELS[key]}
                selected={filters.selectedSemantics[key]?.length || 0}
                total={SEMANTIC_OPTIONS[key].length}
                compact
                onSelectAll={() => setSemanticFilter(key, [...SEMANTIC_OPTIONS[key]])}
                onClear={() => setSemanticFilter(key, [])}
              />
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
                        'flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] transition-colors',
                        active
                          ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]'
                          : 'border-transparent bg-[#F8FAFC]/70 text-[#64748B] hover:border-[#E2E8F0] hover:bg-[#FFFFFF] hover:text-[#0F172A]'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border transition-colors',
                          active ? 'border-[#60A5FA] bg-[#DBEAFE]' : 'border-[#CBD5E1] bg-white'
                        )}
                      >
                        {active && (
                          <svg className="h-2 w-2 text-[#2563EB]" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span>{SEMANTIC_VALUE_LABELS[key][value]}</span>
                      <span className={cn('font-mono', active ? 'text-[#3B82F6]' : 'text-[#94A3B8]')}>{count}</span>
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

function FilterHeader({
  title,
  selected,
  total,
  compact = false,
  onSelectAll,
  onClear,
}: {
  title: string;
  selected: number;
  total: number;
  compact?: boolean;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const allSelected = selected === total;
  const noneSelected = selected === 0;

  return (
    <div className={cn('flex items-center justify-between', compact ? 'mb-1.5' : 'mb-3')}>
      <div className="flex items-center gap-1.5">
        <h3
          className={cn(
            'font-semibold text-[#475569] uppercase tracking-wider',
            compact ? 'text-[10px]' : 'text-xs'
          )}
        >
          {title}
        </h3>
        <span
          className={cn(
            'rounded px-1 py-0.5 font-mono text-[9px]',
            allSelected ? 'text-[#64748B]' : 'bg-[#E2E8F0] text-[#0F172A]'
          )}
        >
          {selected}/{total}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSelectAll}
          disabled={allSelected}
          className="text-[9px] text-[#64748B] transition-colors hover:text-[#0F172A] disabled:cursor-default disabled:opacity-35"
        >
          全选
        </button>
        <span className="text-[9px] text-[#CBD5E1]">/</span>
        <button
          type="button"
          onClick={onClear}
          disabled={noneSelected}
          className="text-[9px] text-[#64748B] transition-colors hover:text-[#0F172A] disabled:cursor-default disabled:opacity-35"
        >
          清空
        </button>
      </div>
    </div>
  );
}
