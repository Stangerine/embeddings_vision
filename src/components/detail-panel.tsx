'use client';

import { useGalleryStore } from '@/lib/store';
import {
  CATEGORY_COLORS,
  SEMANTIC_COLORS,
  SEMANTIC_LABELS,
  SEMANTIC_VALUE_LABELS,
  getImageUrl,
  getConfidenceColor,
  SPLIT_COLORS,
  SPLIT_LABELS,
} from '@/lib/mock-data';
import type { ColorByMode, SemanticAttributes } from '@/lib/types';

export function DetailPanel() {
  const { selectedImageId, images, selectImage, getFilteredImages, colorByMode } = useGalleryStore();

  const selectedImage = images.find((img) => img.id === selectedImageId);
  const filteredImages = getFilteredImages();

  const filteredAnnotationCount = filteredImages.reduce(
    (sum, img) => sum + img.detections.length,
    0
  );
  const filteredCategoryCounts = filteredImages.reduce<Record<string, number>>((counts, img) => {
    for (const det of img.detections) {
      counts[det.label] = (counts[det.label] || 0) + 1;
    }
    return counts;
  }, {});
  const topCategories = Object.entries(filteredCategoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const splitCounts = filteredImages.reduce<Record<string, number>>((counts, img) => {
    counts[img.split] = (counts[img.split] || 0) + 1;
    return counts;
  }, {});
  const timeCounts = filteredImages.reduce<Record<string, number>>((counts, img) => {
    const value = img.metadata.semantics.timeOfDay;
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
  const environmentCounts = filteredImages.reduce<Record<string, number>>((counts, img) => {
    const value = img.metadata.semantics.environment;
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
  const semanticDistribution = (key: keyof SemanticAttributes) =>
    filteredImages.reduce<Record<string, number>>((counts, img) => {
      const value = img.metadata.semantics[key];
      counts[value] = (counts[value] || 0) + 1;
      return counts;
    }, {});

  const colorModeLabel: Record<ColorByMode, string> = {
    split: '划分',
    lighting: SEMANTIC_LABELS.lighting,
    viewpoint: SEMANTIC_LABELS.viewpoint,
    blur: SEMANTIC_LABELS.blur,
    weather: SEMANTIC_LABELS.weather,
    timeOfDay: SEMANTIC_LABELS.timeOfDay,
    environment: SEMANTIC_LABELS.environment,
  };
  const overviewSections = buildOverviewSections({
    colorByMode,
    topCategories,
    filteredAnnotationCount,
    splitCounts,
    timeCounts,
    environmentCounts,
    semanticDistribution,
    filteredImageCount: filteredImages.length,
  });

  if (!selectedImage) {
    return (
      <aside className="w-[320px] border-l border-[#1e2030] bg-[#0f1117] overflow-y-auto shrink-0 flex flex-col">
        <div className="px-4 py-3 border-b border-[#1e2030]">
          <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider">
            当前分布概览
          </h3>
          <p className="mt-1 text-[10px] text-[#555872]">
            点击散点或图片可查看单图详情
          </p>
        </div>

        <div className="px-4 py-3 border-b border-[#1e2030]">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded bg-[#161822]/60 px-2 py-2">
              <span className="block text-[9px] text-[#555872]">图片</span>
              <span className="text-sm font-semibold text-[#e2e4f0]">{filteredImages.length}</span>
            </div>
            <div className="rounded bg-[#161822]/60 px-2 py-2">
              <span className="block text-[9px] text-[#555872]">标注</span>
              <span className="text-sm font-semibold text-[#e2e4f0]">{filteredAnnotationCount}</span>
            </div>
            <div className="rounded bg-[#161822]/60 px-2 py-2">
              <span className="block text-[9px] text-[#555872]">着色</span>
              <span className="text-sm font-semibold text-[#e2e4f0]">
                {colorModeLabel[colorByMode]}
              </span>
            </div>
          </div>
        </div>

        {overviewSections.map((section) => (
          <OverviewSection key={section.title} title={section.title} active={section.active}>
            {section.rows.map((row) => (
              <OverviewBar key={row.label} label={row.label} count={row.count} pct={row.pct} />
            ))}
          </OverviewSection>
        ))}
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

  const getTagLabel = (tag: string): string => {
    for (const labels of Object.values(SEMANTIC_VALUE_LABELS)) {
      if (labels[tag]) return labels[tag];
    }
    return tag;
  };

  return (
    <aside className="w-[320px] border-l border-[#1e2030] bg-[#0f1117] overflow-y-auto shrink-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2030]">
        <h3 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider">
          图片详情
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
            <span className="text-[#555872]">文件名</span>
            <p className="text-[#e2e4f0] font-mono truncate">{selectedImage.filename}</p>
          </div>
          <div>
            <span className="text-[#555872]">尺寸</span>
            <p className="text-[#e2e4f0] font-mono">{selectedImage.width} x {selectedImage.height}</p>
          </div>
          <div>
            <span className="text-[#555872]">划分</span>
            <p className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: SPLIT_COLORS[selectedImage.split] }}
              />
              <span className="text-[#e2e4f0]">{SPLIT_LABELS[selectedImage.split]}</span>
            </p>
          </div>
          <div>
            <span className="text-[#555872]">来源</span>
            <p className="text-[#e2e4f0]">{selectedImage.metadata.source}</p>
          </div>
          <div>
            <span className="text-[#555872]">日期</span>
            <p className="text-[#e2e4f0] font-mono">{selectedImage.metadata.captureDate}</p>
          </div>
          <div>
            <span className="text-[#555872]">向量坐标</span>
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
              {getTagLabel(tag)}
            </span>
          ))}
        </div>
      </div>

      {/* Semantic Attributes */}
      <div className="px-4 py-3 border-b border-[#1e2030]">
        <h4 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-2">
          语义属性
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
                  {SEMANTIC_VALUE_LABELS[key][value]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detections Table */}
      <div className="px-4 py-3 border-b border-[#1e2030]">
        <h4 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-2">
          检测结果（{selectedImage.detections.length}）
        </h4>
        <div className="space-y-1">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_60px_60px_50px] gap-1 text-[9px] text-[#555872] uppercase px-2 py-1">
            <span>类别</span>
            <span className="text-right">置信度</span>
            <span className="text-right">BBox</span>
            <span className="text-right">类型</span>
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
                  <span className="text-[#f59e0b] text-[9px]">预测</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Similar Images */}
      <div className="px-4 py-3">
        <h4 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider mb-2">
          相似图片（向量距离）
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

function OverviewSection({
  title,
  active = false,
  children,
}: {
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-b border-[#1e2030]">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-xs font-semibold text-[#8b8ea8] uppercase tracking-wider">
          {title}
        </h4>
        {active && (
          <span className="rounded bg-[#6366f1]/15 px-1.5 py-0.5 text-[9px] text-[#a5b4fc]">
            当前着色
          </span>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

interface OverviewRow {
  label: string;
  count: number;
  pct: number;
}

interface OverviewSectionData {
  title: string;
  active: boolean;
  rows: OverviewRow[];
}

function buildOverviewSections({
  colorByMode,
  topCategories,
  filteredAnnotationCount,
  splitCounts,
  timeCounts,
  environmentCounts,
  semanticDistribution,
  filteredImageCount,
}: {
  colorByMode: ColorByMode;
  topCategories: [string, number][];
  filteredAnnotationCount: number;
  splitCounts: Record<string, number>;
  timeCounts: Record<string, number>;
  environmentCounts: Record<string, number>;
  semanticDistribution: (key: keyof SemanticAttributes) => Record<string, number>;
  filteredImageCount: number;
}): OverviewSectionData[] {
  const categorySection: OverviewSectionData = {
    title: '类别 Top 分布',
    active: false,
    rows: topCategories.map(([label, count]) => ({
      label,
      count,
      pct: filteredAnnotationCount > 0 ? (count / filteredAnnotationCount) * 100 : 0,
    })),
  };

  const splitSection: OverviewSectionData = {
    title: '数据划分',
    active: colorByMode === 'split',
    rows: (['train', 'validation', 'test'] as const).map((split) => {
      const count = splitCounts[split] || 0;
      return {
        label: SPLIT_LABELS[split],
        count,
        pct: filteredImageCount > 0 ? (count / filteredImageCount) * 100 : 0,
      };
    }),
  };

  const timeSection: OverviewSectionData = {
    title: '时段分布',
    active: colorByMode === 'timeOfDay',
    rows: Object.entries(timeCounts).map(([value, count]) => ({
      label: SEMANTIC_VALUE_LABELS.timeOfDay[value],
      count,
      pct: filteredImageCount > 0 ? (count / filteredImageCount) * 100 : 0,
    })),
  };

  const environmentSection: OverviewSectionData = {
    title: '环境分布',
    active: colorByMode === 'environment',
    rows: Object.entries(environmentCounts).map(([value, count]) => ({
      label: SEMANTIC_VALUE_LABELS.environment[value],
      count,
      pct: filteredImageCount > 0 ? (count / filteredImageCount) * 100 : 0,
    })),
  };

  const semanticKeyByMode: Partial<Record<ColorByMode, keyof SemanticAttributes>> = {
    lighting: 'lighting',
    viewpoint: 'viewpoint',
    blur: 'blur',
    weather: 'weather',
  };

  const activeSemanticKey = semanticKeyByMode[colorByMode];
  const activeSemanticSection: OverviewSectionData | null = activeSemanticKey
    ? {
        title: `${SEMANTIC_LABELS[activeSemanticKey]}分布`,
        active: true,
        rows: Object.entries(semanticDistribution(activeSemanticKey)).map(([value, count]) => ({
          label: SEMANTIC_VALUE_LABELS[activeSemanticKey][value],
          count,
          pct: filteredImageCount > 0 ? (count / filteredImageCount) * 100 : 0,
        })),
      }
    : null;

  const baseSections = [categorySection, splitSection, timeSection, environmentSection];
  if (!activeSemanticSection) {
    return [...baseSections].sort((a, b) => Number(b.active) - Number(a.active));
  }

  return [activeSemanticSection, ...baseSections];
}

function OverviewBar({
  label,
  count,
  pct,
}: {
  label: string;
  count: number;
  pct: number;
}) {
  const barWidth = count > 0 ? Math.max(2, pct) : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="w-16 truncate text-[10px] text-[#8b8ea8]">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#161822]">
        <div
          className="h-full rounded-full bg-[#6366f1]/70"
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-[10px] text-[#555872]">{count}</span>
    </div>
  );
}
