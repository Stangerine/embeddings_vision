'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useGalleryStore } from '@/lib/store';
import { CATEGORY_COLORS, SPLIT_SHORT_LABELS } from '@/lib/mock-data';
import { resolveImageSrc } from '@/lib/image-src';
import type { DatasetImage, BoundingBox } from '@/lib/types';
import { cn } from '@/lib/utils';

function BBoxOverlay({ detections, width, height }: {
  detections: BoundingBox[];
  width: number;
  height: number;
}) {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {detections.map((det) => {
        const [x, y, w, h] = det.bbox;
        const color = CATEGORY_COLORS[det.label] || '#2563EB';
        const px = x * width;
        const py = y * height;
        const pw = w * width;
        const ph = h * height;
        return (
          <g key={det.id}>
            <rect
              x={px}
              y={py}
              width={pw}
              height={ph}
              fill="none"
              stroke={color}
              strokeWidth="2"
              opacity={det.isGroundTruth ? 1 : 0.6}
              strokeDasharray={det.isGroundTruth ? 'none' : '4 2'}
            />
            {/* Label background */}
            <rect
              x={px}
              y={Math.max(0, py - 16)}
              width={Math.min(pw, det.label.length * 7 + 30)}
              height={16}
              fill={color}
              opacity={0.9}
              rx={2}
            />
            {/* Label text */}
            <text
              x={px + 4}
              y={Math.max(12, py - 4)}
              fill="white"
              fontSize="10"
              fontFamily="monospace"
              fontWeight="600"
            >
              {det.label} {det.confidence < 1 ? `(${(det.confidence * 100).toFixed(0)}%)` : 'GT'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ImageCard({ image }: { image: DatasetImage }) {
  const { selectedImageId, selectImage } = useGalleryStore();
  const isSelected = selectedImageId === image.id;
  const imgRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(() => {
    selectImage(isSelected ? null : image.id);
  }, [isSelected, image.id, selectImage]);

  // Aspect ratio for the card
  const aspectRatio = image.width / image.height;

  return (
    <div
      ref={imgRef}
      data-image-id={image.id}
      onClick={handleClick}
      className={cn(
        'relative group cursor-pointer rounded-lg overflow-hidden border transition-all duration-150',
        isSelected
          ? 'border-[#2563EB] ring-1 ring-[#2563EB]/30 shadow-[0_0_12px_rgba(37,99,235,0.15)]'
          : 'border-[#E2E8F0] hover:border-[#CBD5E1] hover:shadow-lg'
      )}
    >
      {/* Image container with fixed aspect ratio */}
      <div
        className="relative bg-[#F8FAFC] overflow-hidden"
        style={{ aspectRatio: aspectRatio }}
      >
        {/* Placeholder with gradient based on primary category */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${CATEGORY_COLORS[image.detections[0]?.label] || '#2563EB'}15, ${CATEGORY_COLORS[image.detections[0]?.label] || '#2563EB'}05)`,
          }}
        />
        
        {/* Image */}
        <img
          src={resolveImageSrc(image, 400, Math.round(400 / aspectRatio))}
          alt={image.filename}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />

        {/* BBox overlay */}
        <BBoxOverlay
          detections={image.detections}
          width={image.width}
          height={image.height}
        />

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-[#0F172A]/0 group-hover:bg-[#0F172A]/10 transition-colors" />

        {/* Split badge */}
        <div className="absolute top-1.5 right-1.5">
          <span
            className={cn(
              'text-[9px] font-medium px-1.5 py-0.5 rounded border bg-white/90 text-[#0F172A] shadow-sm backdrop-blur-sm',
              image.split === 'train' ? 'border-blue-200' :
              image.split === 'validation' ? 'border-amber-200' : 'border-emerald-200'
            )}
          >
            {SPLIT_SHORT_LABELS[image.split]}
          </span>
        </div>

        {/* Detection count */}
        <div className="absolute bottom-1.5 left-1.5">
          <span className="text-[9px] font-mono text-[#0F172A] bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded shadow-sm">
            {image.detections.length} 个标注
          </span>
        </div>

        {/* Category chips on focus */}
        <div
          className={cn(
            'absolute inset-x-1.5 bottom-6 flex flex-wrap gap-1 transition-opacity duration-150',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          {image.detections.slice(0, 3).map((det) => (
            <span
              key={det.id}
              className="rounded bg-white/90 px-1 py-0 text-[9px] shadow-sm backdrop-blur-sm"
              style={{ color: CATEGORY_COLORS[det.label] }}
            >
              {det.label}
            </span>
          ))}
          {image.detections.length > 3 && (
            <span className="rounded bg-white/90 px-1 py-0 text-[9px] text-[#475569] shadow-sm backdrop-blur-sm">
              +{image.detections.length - 3}
            </span>
          )}
        </div>
      </div>

      {/* Card footer */}
      <div className="px-2 py-1.5 bg-[#FFFFFF]">
        <p className="text-[10px] text-[#475569] truncate font-mono">
          {image.filename}
        </p>
      </div>
    </div>
  );
}

export function GridView() {
  const {
    getFilteredImages,
    getVisibleFilteredImages,
    gridColumns,
    setGridColumns,
    datasetInfo,
    isUploadingDataset,
    loadMoreImages,
    gridFocusImageId,
  } = useGalleryStore();
  const filteredImages = getFilteredImages();
  const visibleImages = getVisibleFilteredImages();
  const hasDataset = datasetInfo.imageCount > 0;
  const canLoadMore = visibleImages.length < filteredImages.length;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gridFocusImageId) return;
    const container = scrollContainerRef.current;
    const target = container?.querySelector<HTMLElement>(
      `[data-image-id="${CSS.escape(gridFocusImageId)}"]`
    );
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [gridFocusImageId, visibleImages.length]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Grid controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#E2E8F0]">
        <span className="text-xs text-[#475569]">
          已显示 {visibleImages.length} / {filteredImages.length} 张图片
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#64748B]">密度</span>
          <input
            type="range"
            min="2"
            max="8"
            value={gridColumns}
            onChange={(e) => setGridColumns(parseInt(e.target.value))}
            className="w-20 accent-[#2563EB] h-1"
          />
          <span className="text-[10px] text-[#64748B] font-mono w-3">{gridColumns}</span>
        </div>
      </div>

      {/* Grid */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3">
        {filteredImages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-3xl mb-2 opacity-30">⊘</div>
              <p className="text-sm text-[#64748B]">
                {isUploadingDataset
                  ? '正在解析上传的数据集...'
                  : hasDataset
                    ? '没有符合当前筛选条件的图片'
                    : '请点击顶部“上传 ZIP”加载数据集'}
              </p>
            </div>
          </div>
        ) : (
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${gridColumns}, 1fr)`,
            }}
          >
            {visibleImages.map((image) => (
              <ImageCard key={image.id} image={image} />
            ))}
            {canLoadMore && (
              <button
                type="button"
                onClick={loadMoreImages}
                className="col-span-full mt-2 h-10 rounded-md border border-[#CBD5E1] bg-white text-xs font-medium text-[#475569] transition-colors hover:border-[#93C5FD] hover:bg-[#EFF6FF] hover:text-[#1D4ED8]"
              >
                加载更多图片
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
