'use client';

import { useGalleryStore } from '@/lib/store';
import {
  CATEGORY_COLORS,
  SEMANTIC_COLORS,
  SEMANTIC_LABELS,
  getImageUrl,
  getConfidenceColor,
  SPLIT_COLORS,
} from '@/lib/mock-data';
import type { SemanticAttributes } from '@/lib/types';

export function DetailPanel() {
  const { selectedImageId, images, selectImage } = useGalleryStore();

  const selectedImage = images.find((img) => img.id === selectedImageId);

  if (!selectedImage) {
    return (
      <aside className="w-[320px] border-l border-[#1e2030] bg-[#0f1117] flex items-center justify-center shrink-0">
        <div className="text-center px-4">
          <div className="text-2xl mb-2 opacity-20">◉</div>
          <p className="text-xs text-[#555872]">Select an image to view details</p>
        </div>
      </aside>
    );
  }

  // Find similar images by embedding distance
  const similarImages = images
    .filter((img) => img.id !== selectedImage.id)
    .map((img) => ({
      image: img,
      distance: Math.sqrt(
        (img.embedding2d[0] - selectedImage.embedding2d[0]) ** 2 +
        (img.embedding2d[1] - selectedImage.embedding2d[1]) ** 2
      ),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6);

  return (
    <aside className="w-[320px] border-l border-[#1e2030] bg-[#0f1117] overflow-y-auto shrink-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2030]">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider">
          Image Details
        </h3>
        <button
          onClick={() => selectImage(null)}
          className="text-[#555872] hover:text-[#e2e4f0] transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Preview */}
      <div className="p-3 border-b border-[#1e2030]">
        <div className="relative rounded-lg overflow-hidden bg-[#161822]">
          <img
            src={getImageUrl(selectedImage.id, 600, 400)}
            alt={selectedImage.filename}
            className="w-full h-auto"
          />
          {/* BBox overlay on detail */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${selectedImage.width} ${selectedImage.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {selectedImage.detections.map((det) => {
              const [x, y, w, h] = det.bbox;
              const color = CATEGORY_COLORS[det.label] || '#6366f1';
              const px = x * selectedImage.width;
              const py = y * selectedImage.height;
              const pw = w * selectedImage.width;
              const ph = h * selectedImage.height;
              return (
                <g key={det.id}>
                  <rect
                    x={px}
                    y={py}
                    width={pw}
                    height={ph}
                    fill={`${color}10`}
                    stroke={color}
                    strokeWidth="3"
                    opacity={det.isGroundTruth ? 1 : 0.6}
                    strokeDasharray={det.isGroundTruth ? 'none' : '6 3'}
                  />
                  <rect
                    x={px}
                    y={Math.max(0, py - 22)}
                    width={det.label.length * 8 + 40}
                    height={22}
                    fill={color}
                    opacity={0.9}
                    rx={3}
                  />
                  <text
                    x={px + 5}
                    y={Math.max(15, py - 6)}
                    fill="white"
                    fontSize="12"
                    fontFamily="monospace"
                    fontWeight="600"
                  >
                    {det.label} {det.confidence < 1 ? `${(det.confidence * 100).toFixed(0)}%` : 'GT'}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Metadata */}
      <div className="px-4 py-3 border-b border-[#1e2030]">
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div>
            <span className="text-[#555872]">Filename</span>
            <p className="text-[#e2e4f0] font-mono truncate">{selectedImage.filename}</p>
          </div>
          <div>
            <span className="text-[#555872]">Dimensions</span>
            <p className="text-[#e2e4f0] font-mono">{selectedImage.width} x {selectedImage.height}</p>
          </div>
          <div>
            <span className="text-[#555872]">Split</span>
            <p className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: SPLIT_COLORS[selectedImage.split] }}
              />
              <span className="text-[#e2e4f0] capitalize">{selectedImage.split}</span>
            </p>
          </div>
          <div>
            <span className="text-[#555872]">Source</span>
            <p className="text-[#e2e4f0]">{selectedImage.metadata.source}</p>
          </div>
          <div>
            <span className="text-[#555872]">Date</span>
            <p className="text-[#e2e4f0] font-mono">{selectedImage.metadata.captureDate}</p>
          </div>
          <div>
            <span className="text-[#555872]">Embedding</span>
            <p className="text-[#e2e4f0] font-mono">
              [{selectedImage.embedding2d[0].toFixed(2)}, {selectedImage.embedding2d[1].toFixed(2)}]
            </p>
          </div>
        </div>
        {/* Tags */}
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {selectedImage.metadata.tags.map((tag) => (
            <span
              key={tag}
              className="text-[9px] px-1.5 py-0.5 rounded bg-[#161822] text-[#8b8ea8] border border-[#1e2030]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Semantic Attributes */}
      <div className="px-4 py-3 border-b border-[#1e2030]">
        <h4 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-2">
          Semantic Attributes
        </h4>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(selectedImage.metadata.semantics) as (keyof SemanticAttributes)[]).map((key) => {
            const value = selectedImage.metadata.semantics[key];
            return (
              <div key={key} className="rounded bg-[#161822]/50 px-2 py-1.5">
                <span className="block text-[9px] text-[#555872] uppercase tracking-wider">
                  {SEMANTIC_LABELS[key]}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#e2e4f0]">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: SEMANTIC_COLORS[key][value] }}
                  />
                  {value}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detections Table */}
      <div className="px-4 py-3 border-b border-[#1e2030]">
        <h4 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-2">
          Detections ({selectedImage.detections.length})
        </h4>
        <div className="space-y-1">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_60px_60px_50px] gap-1 text-[9px] text-[#555872] uppercase px-2 py-1">
            <span>Label</span>
            <span className="text-right">Conf</span>
            <span className="text-right">BBox</span>
            <span className="text-right">Type</span>
          </div>
          {selectedImage.detections.map((det) => (
            <div
              key={det.id}
              className="grid grid-cols-[1fr_60px_60px_50px] gap-1 items-center text-[10px] px-2 py-1.5 rounded bg-[#161822]/50 hover:bg-[#161822] transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[det.label] }}
                />
                <span className="text-[#e2e4f0] truncate">{det.label}</span>
              </div>
              <span
                className="text-right font-mono"
                style={{ color: getConfidenceColor(det.confidence) }}
              >
                {det.confidence < 1 ? `${(det.confidence * 100).toFixed(0)}%` : '—'}
              </span>
              <span className="text-right text-[#555872] font-mono text-[9px]">
                {det.bbox[2].toFixed(2)}x{det.bbox[3].toFixed(2)}
              </span>
              <span className="text-right">
                {det.isGroundTruth ? (
                  <span className="text-[#10b981] text-[9px]">GT</span>
                ) : (
                  <span className="text-[#f59e0b] text-[9px]">Pred</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Similar Images */}
      <div className="px-4 py-3">
        <h4 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-2">
          Similar Images (Embedding)
        </h4>
        <div className="grid grid-cols-3 gap-1.5">
          {similarImages.map(({ image, distance }) => (
            <button
              key={image.id}
              onClick={() => selectImage(image.id)}
              className="relative group rounded overflow-hidden bg-[#161822] aspect-square hover:ring-1 hover:ring-[#6366f1] transition-all"
            >
              <img
                src={getImageUrl(image.id, 100, 100)}
                alt={image.filename}
                className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity"
                loading="lazy"
              />
              {/* Mini bboxes */}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox={`0 0 ${image.width} ${image.height}`}
                preserveAspectRatio="none"
              >
                {image.detections.slice(0, 3).map((det) => {
                  const [x, y, w, h] = det.bbox;
                  return (
                    <rect
                      key={det.id}
                      x={x * image.width}
                      y={y * image.height}
                      width={w * image.width}
                      height={h * image.height}
                      fill="none"
                      stroke={CATEGORY_COLORS[det.label] || '#6366f1'}
                      strokeWidth="4"
                      opacity={0.7}
                    />
                  );
                })}
              </svg>
              {/* Distance badge */}
              <div className="absolute bottom-0.5 right-0.5">
                <span className="text-[8px] font-mono bg-black/70 text-[#8b8ea8] px-1 rounded">
                  {distance.toFixed(1)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
