'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useGalleryStore } from '@/lib/store';
import { CATEGORY_COLORS, SPLIT_SHORT_LABELS, getImageUrl } from '@/lib/mock-data';
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
        const color = CATEGORY_COLORS[det.label] || '#6366f1';
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
      onClick={handleClick}
      className={cn(
        'relative group cursor-pointer rounded-lg overflow-hidden border transition-all duration-150',
        isSelected
          ? 'border-[#6366f1] ring-1 ring-[#6366f1]/30 shadow-[0_0_12px_rgba(99,102,241,0.15)]'
          : 'border-[#1e2030] hover:border-[#2a2d42] hover:shadow-lg'
      )}
    >
      {/* Image container with fixed aspect ratio */}
      <div
        className="relative bg-[#161822] overflow-hidden"
        style={{ aspectRatio: aspectRatio }}
      >
        {/* Placeholder with gradient based on primary category */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${CATEGORY_COLORS[image.detections[0]?.label] || '#6366f1'}15, ${CATEGORY_COLORS[image.detections[0]?.label] || '#6366f1'}05)`,
          }}
        />
        
        {/* Image */}
        <img
          src={getImageUrl(image.id, 400, Math.round(400 / aspectRatio))}
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
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />

        {/* Split badge */}
        <div className="absolute top-1.5 right-1.5">
          <span
            className={cn(
              'text-[9px] font-medium px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm',
              image.split === 'train' ? 'text-blue-400' :
              image.split === 'validation' ? 'text-amber-400' : 'text-emerald-400'
            )}
          >
            {SPLIT_SHORT_LABELS[image.split]}
          </span>
        </div>

        {/* Detection count */}
        <div className="absolute bottom-1.5 left-1.5">
          <span className="text-[9px] font-mono text-[#8b8ea8] bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded">
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
              className="rounded bg-black/65 px-1 py-0 text-[9px] backdrop-blur-sm"
              style={{ color: CATEGORY_COLORS[det.label] }}
            >
              {det.label}
            </span>
          ))}
          {image.detections.length > 3 && (
            <span className="rounded bg-black/65 px-1 py-0 text-[9px] text-[#8b8ea8] backdrop-blur-sm">
              +{image.detections.length - 3}
            </span>
          )}
        </div>
      </div>

      {/* Card footer */}
      <div className="px-2 py-1.5 bg-[#0f1117]">
        <p className="text-[10px] text-[#8b8ea8] truncate font-mono">
          {image.filename}
        </p>
      </div>
    </div>
  );
}

export function GridView() {
  const { getFilteredImages, gridColumns, setGridColumns } = useGalleryStore();
  const filteredImages = getFilteredImages();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Grid controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e2030]">
        <span className="text-xs text-[#8b8ea8]">
          共 {filteredImages.length} 张图片
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#555872]">密度</span>
          <input
            type="range"
            min="2"
            max="8"
            value={gridColumns}
            onChange={(e) => setGridColumns(parseInt(e.target.value))}
            className="w-20 accent-[#6366f1] h-1"
          />
          <span className="text-[10px] text-[#555872] font-mono w-3">{gridColumns}</span>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredImages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-3xl mb-2 opacity-30">⊘</div>
              <p className="text-sm text-[#555872]">没有符合当前筛选条件的图片</p>
            </div>
          </div>
        ) : (
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${gridColumns}, 1fr)`,
            }}
          >
            {filteredImages.map((image) => (
              <ImageCard key={image.id} image={image} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
