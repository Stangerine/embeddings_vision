'use client';

import { useGalleryStore } from '@/lib/store';
import { datasetInfo } from '@/lib/mock-data';
import type { ViewMode } from '@/lib/types';
import { cn } from '@/lib/utils';

const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: 'grid', label: '图库', icon: '⊞' },
  { mode: 'scatter', label: '向量分布', icon: '◎' },
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
    <header className="h-[52px] border-b border-[#E2E8F0] bg-[#FFFFFF] flex items-center px-4 gap-4 shrink-0">
      {/* Logo & Dataset */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
            DG
          </div>
          <span className="text-[#0F172A] font-semibold text-sm whitespace-nowrap">
            {datasetInfo.name}
          </span>
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-1 bg-[#F8FAFC] rounded-md p-0.5">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => setViewMode(opt.mode)}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-medium transition-all duration-150 flex items-center gap-1.5',
              viewMode === opt.mode
                ? 'bg-[#2563EB] text-white'
                : 'text-[#475569] hover:text-[#0F172A]'
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
          placeholder="搜索文件名、类别、标签或语义属性..."
          value={filters.searchQuery}
          onChange={(e) => setFilters({ searchQuery: e.target.value })}
          className="w-full h-8 px-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-md text-xs text-[#0F172A] placeholder-[#64748B] focus:outline-none focus:border-[#2563EB] transition-colors"
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-[#475569]">
        <span>
          <span className="text-[#0F172A] font-medium">{filteredCount}</span>
          <span className="text-[#64748B]"> / {datasetInfo.imageCount} 张图片</span>
        </span>
        <span>
          <span className="text-[#0F172A] font-medium">{datasetInfo.annotationCount}</span>
          <span className="text-[#64748B]"> 个标注</span>
        </span>
      </div>
    </header>
  );
}
