'use client';

import { useRef } from 'react';
import { useGalleryStore } from '@/lib/store';
import type { ViewMode } from '@/lib/types';
import { cn } from '@/lib/utils';

const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: 'grid', label: '图库', icon: '⊞' },
  { mode: 'scatter', label: '向量分布', icon: '◎' },
];

export function TopBar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    viewMode,
    setViewMode,
    filters,
    setFilters,
    getFilteredImages,
    datasetInfo,
    embeddingInfo,
    isLoadingDataset,
    isUploadingDataset,
    uploadJob,
    datasetError,
    uploadDataset,
  } = useGalleryStore();

  const filteredCount = getFilteredImages().length;
  const isBusy = isLoadingDataset || isUploadingDataset;
  const uploadLabel = uploadJob
    ? `${uploadJob.cached ? '缓存命中' : uploadJob.message} ${uploadJob.progress}%`
    : null;

  return (
    <header className="h-[52px] border-b border-[#E2E8F0] bg-[#FFFFFF] flex items-center px-4 gap-3 shrink-0">
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

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadDataset(file);
          event.currentTarget.value = '';
        }}
      />
      <button
        type="button"
        disabled={isBusy}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'h-8 rounded-md border px-3 text-xs font-medium transition-colors',
          isBusy
            ? 'cursor-not-allowed border-[#E2E8F0] bg-[#F8FAFC] text-[#94A3B8]'
            : 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE]'
        )}
      >
        {isUploadingDataset ? '解析中...' : isLoadingDataset ? '加载中...' : '上传 ZIP'}
      </button>

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
      <div className="flex-1 max-w-sm">
        <input
          type="text"
          placeholder="搜索文件名、类别、标签或语义属性..."
          value={filters.searchQuery}
          onChange={(e) => setFilters({ searchQuery: e.target.value })}
          className="w-full h-8 px-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-md text-xs text-[#0F172A] placeholder-[#64748B] focus:outline-none focus:border-[#2563EB] transition-colors"
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-[#475569]">
        <span>
          <span className="text-[#0F172A] font-medium">{filteredCount}</span>
          <span className="text-[#64748B]"> / {datasetInfo.imageCount} 张图片</span>
        </span>
        <span>
          <span className="text-[#0F172A] font-medium">{datasetInfo.annotationCount}</span>
          <span className="text-[#64748B]"> 个标注</span>
        </span>
        {embeddingInfo && (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px]',
              embeddingInfo.status === 'ready'
                ? 'bg-[#ECFDF5] text-[#047857]'
                : embeddingInfo.status === 'pending' || embeddingInfo.status === 'running'
                  ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                  : 'bg-[#FFF7ED] text-[#C2410C]'
            )}
            title={embeddingInfo.message}
          >
            {embeddingInfo.status === 'pending' || embeddingInfo.status === 'running'
              ? `${embeddingInfo.model} 生成中`
              : embeddingInfo.model}
          </span>
        )}
        {isUploadingDataset && uploadLabel && (
          <div className="flex min-w-[180px] max-w-[280px] items-center gap-2" title={uploadJob?.message}>
            <span className="truncate rounded bg-[#EFF6FF] px-1.5 py-0.5 text-[10px] text-[#1D4ED8]">
              {uploadLabel}
            </span>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#DBEAFE]">
              <div
                className="h-full rounded-full bg-[#2563EB] transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(uploadJob?.progress ?? 0, 100))}%` }}
              />
            </div>
          </div>
        )}
        {datasetError && (
          <span className="max-w-[220px] truncate rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] text-[#B91C1C]">
            {datasetError}
          </span>
        )}
      </div>
    </header>
  );
}
