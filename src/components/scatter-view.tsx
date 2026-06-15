'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useGalleryStore } from '@/lib/store';
import {
  CATEGORY_COLORS,
  SEMANTIC_COLORS,
  SEMANTIC_LABELS,
  SEMANTIC_VALUE_LABELS,
  SPLIT_COLORS,
  SPLIT_LABELS,
  SPLIT_SHORT_LABELS,
  getImageUrl,
} from '@/lib/mock-data';
import type { DatasetImage } from '@/lib/types';
import type { ColorByMode } from '@/lib/types';
import { useCleaningIssues } from '@/hooks/use-cleaning-issues';
import { cn } from '@/lib/utils';

type SelectionTool = 'rect' | 'polygon' | 'lasso';

interface ScreenPoint {
  x: number;
  y: number;
}

interface DataPoint {
  x: number;
  y: number;
  image: DatasetImage;
  screenX: number;
  screenY: number;
}

interface LegendItem {
  label: string;
  color: string;
  count: number | null;
}

// Reusable empty set to avoid re-allocation on each render.
const EMPTY_SET: Set<string> = new Set();

// Point-in-polygon test (ray casting)
function pointInPolygon(px: number, py: number, polygon: ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function ScatterView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<DataPoint | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Selection tool state
  const [activeTool, setActiveTool] = useState<SelectionTool>('rect');

  // Rectangle selection
  const [rectSelection, setRectSelection] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [isDraggingRect, setIsDraggingRect] = useState(false);

  // Polygon selection
  const [polygonVertices, setPolygonVertices] = useState<ScreenPoint[]>([]);
  const [polygonCursor, setPolygonCursor] = useState<ScreenPoint | null>(null);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);

  // Lasso selection
  const [lassoPath, setLassoPath] = useState<ScreenPoint[]>([]);
  const [isDrawingLasso, setIsDrawingLasso] = useState(false);

  // Show selected panel
  const [showSelectedPanel, setShowSelectedPanel] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // Cleaning analysis overlay
  const [showCleaning, setShowCleaning] = useState(false);

  const {
    getFilteredImages,
    colorByMode,
    setColorByMode,
    scatterSelection,
    setScatterSelection,
    selectImage,
    images: allImages,
  } = useGalleryStore();

  const images = getFilteredImages();

  // Cleaning analysis overlay (depends on filtered images)
  const cleaning = useCleaningIssues(images, undefined, showCleaning);
  const outlierIds = cleaning
    ? new Set(cleaning.outliers.map((o) => o.imageId))
    : EMPTY_SET;
  const duplicateIdSet = cleaning
    ? new Set(cleaning.duplicates.flatMap((d) => [d.imageIdA, d.imageIdB]))
    : EMPTY_SET;

  // Compute bounds
  const allEmbeddings = images.map((img) => img.embedding2d);
  const xMin = allEmbeddings.length > 0 ? Math.min(...allEmbeddings.map((e) => e[0])) - 0.5 : -5;
  const xMax = allEmbeddings.length > 0 ? Math.max(...allEmbeddings.map((e) => e[0])) + 0.5 : 5;
  const yMin = allEmbeddings.length > 0 ? Math.min(...allEmbeddings.map((e) => e[1])) - 0.5 : -5;
  const yMax = allEmbeddings.length > 0 ? Math.max(...allEmbeddings.map((e) => e[1])) + 0.5 : 5;

  const getPointColor = useCallback(
    (img: DatasetImage): string => {
      switch (colorByMode) {
        case 'split':
          return SPLIT_COLORS[img.split] || '#2563EB';
        case 'lighting':
        case 'viewpoint':
        case 'blur':
        case 'weather':
        case 'timeOfDay':
        case 'environment':
          return SEMANTIC_COLORS[colorByMode][img.metadata.semantics[colorByMode]] || '#2563EB';
        default:
          return SEMANTIC_COLORS.timeOfDay[img.metadata.semantics.timeOfDay] || '#2563EB';
      }
    },
    [colorByMode]
  );

  // Get selected images data
  const selectedImages = scatterSelection.length > 0
    ? allImages.filter((img) => scatterSelection.includes(img.id))
    : [];

  // Helper: find points inside polygon
  const findPointsInPolygon = useCallback(
    (polygon: ScreenPoint[], points: DataPoint[]): string[] => {
      return points
        .filter((p) => pointInPolygon(p.screenX, p.screenY, polygon))
        .map((p) => p.image.id);
    },
    []
  );

  // Helper: find points inside lasso path
  const findPointsInLasso = useCallback(
    (path: ScreenPoint[], points: DataPoint[]): string[] => {
      if (path.length < 3) return [];
      return points
        .filter((p) => pointInPolygon(p.screenX, p.screenY, path))
        .map((p) => p.image.id);
    },
    []
  );

  // Draw scatter plot
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = 40;

    // Clear
    ctx.fillStyle = '#F3F7FC';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#F8FBFF';
    ctx.fillRect(padding, padding, w - 2 * padding, h - 2 * padding);

    // Draw grid
    ctx.strokeStyle = '#E6EEF8';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const x = padding + ((w - 2 * padding) * i) / 10;
      const y = padding + ((h - 2 * padding) * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, h - padding);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
    }

    // Map data to screen
    const mapX = (val: number) => padding + ((val - xMin) / (xMax - xMin)) * (w - 2 * padding);
    const mapY = (val: number) => h - padding - ((val - yMin) / (yMax - yMin)) * (h - 2 * padding);

    // Draw points
    const points: DataPoint[] = [];
    for (const img of images) {
      const [ex, ey] = img.embedding2d;
      const sx = mapX(ex);
      const sy = mapY(ey);
      const isSelected = scatterSelection.length === 0 || scatterSelection.includes(img.id);
      const color = getPointColor(img);

      points.push({ x: ex, y: ey, image: img, screenX: sx, screenY: sy });

      ctx.beginPath();
      ctx.arc(sx, sy, isSelected ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? color : `${color}30`;
      ctx.fill();

      if (isSelected && scatterSelection.length > 0) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Draw rectangle selection
    if (rectSelection) {
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.fillStyle = 'rgba(37, 99, 235, 0.06)';
      const rx = Math.min(rectSelection.startX, rectSelection.endX);
      const ry = Math.min(rectSelection.startY, rectSelection.endY);
      const rw = Math.abs(rectSelection.endX - rectSelection.startX);
      const rh = Math.abs(rectSelection.endY - rectSelection.startY);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }

    // Draw polygon selection
    if (polygonVertices.length > 0) {
      ctx.beginPath();
      ctx.moveTo(polygonVertices[0].x, polygonVertices[0].y);
      for (let i = 1; i < polygonVertices.length; i++) {
        ctx.lineTo(polygonVertices[i].x, polygonVertices[i].y);
      }
      if (polygonCursor) {
        ctx.lineTo(polygonCursor.x, polygonCursor.y);
      }
      if (polygonVertices.length >= 3) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
        ctx.fill();
      }
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw vertices
      for (const v of polygonVertices) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#2563EB';
        ctx.fill();
        ctx.strokeStyle = '#F6F8FB';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // First vertex highlight (close indicator)
      if (polygonVertices.length >= 3) {
        ctx.beginPath();
        ctx.arc(polygonVertices[0].x, polygonVertices[0].y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Draw lasso path
    if (lassoPath.length > 1) {
      ctx.beginPath();
      ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
      for (let i = 1; i < lassoPath.length; i++) {
        ctx.lineTo(lassoPath[i].x, lassoPath[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(37, 99, 235, 0.06)';
      ctx.fill();
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Cleaning overlay: duplicate capsule bonds first, then outlier rings on top
    if (cleaning) {
      const screenById = new Map<string, { x: number; y: number }>();
      for (const p of points) screenById.set(p.image.id, { x: p.screenX, y: p.screenY });

      // Duplicate pairs — capsule bond: wide translucent body + crisp core + endpoint rings
      if (cleaning.duplicates.length > 0) {
        const pairSegments = cleaning.duplicates
          .map((pair) => {
            const a = screenById.get(pair.imageIdA);
            const b = screenById.get(pair.imageIdB);
            if (!a || !b) return null;
            return { a, b };
          })
          .filter((s): s is { a: { x: number; y: number }; b: { x: number; y: number } } => s !== null);

        // Outer translucent body (gives the "capsule" feel)
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.18)';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const { a, b } of pairSegments) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();

        // Crisp center line
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (const { a, b } of pairSegments) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.lineCap = 'butt';

        // Endpoint rings — visually binds each point to its pair
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.95)';
        ctx.lineWidth = 1.5;
        const drawnEndpoints = new Set<string>();
        for (const pair of cleaning.duplicates) {
          for (const id of [pair.imageIdA, pair.imageIdB]) {
            if (drawnEndpoints.has(id)) continue;
            drawnEndpoints.add(id);
            const s = screenById.get(id);
            if (!s) continue;
            ctx.beginPath();
            ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      // Outlier rings — red halo (drawn on top, takes precedence)
      if (cleaning.outliers.length > 0) {
        for (const issue of cleaning.outliers) {
          const s = screenById.get(issue.imageId);
          if (!s) continue;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // Axis labels
    ctx.fillStyle = '#64748B';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('UMAP-1', w / 2, h - 8);
    ctx.save();
    ctx.translate(12, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('UMAP-2', 0, 0);
    ctx.restore();

    // Store points for hover detection
    (canvas as unknown as Record<string, DataPoint[]>).__points = points;
  }, [images, colorByMode, scatterSelection, rectSelection, polygonVertices, polygonCursor, lassoPath, xMin, xMax, yMin, yMax, getPointColor, cleaning]);

  // Get mouse position relative to canvas
  const getCanvasPos = useCallback((e: React.MouseEvent): ScreenPoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // Hit test for points
  const hitTestPoint = useCallback((mx: number, my: number): DataPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const points = (canvas as unknown as Record<string, DataPoint[]>).__points || [];
    let closest: DataPoint | null = null;
    let minDist = 15;
    for (const p of points) {
      const d = Math.sqrt((p.screenX - mx) ** 2 + (p.screenY - my) ** 2);
      if (d < minDist) {
        minDist = d;
        closest = p;
      }
    }
    return closest;
  }, []);

  // Close polygon and select
  const closePolygon = useCallback(() => {
    if (polygonVertices.length < 3) {
      setPolygonVertices([]);
      setIsDrawingPolygon(false);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const points = (canvas as unknown as Record<string, DataPoint[]>).__points || [];
    const selected = findPointsInPolygon(polygonVertices, points);
    setScatterSelection(selected);
    setShowSelectedPanel(true);
    setPolygonVertices([]);
    setIsDrawingPolygon(false);
    setPolygonCursor(null);
  }, [polygonVertices, findPointsInPolygon, setScatterSelection]);

  // Close lasso and select
  const closeLasso = useCallback(() => {
    if (lassoPath.length < 3) {
      setLassoPath([]);
      setIsDrawingLasso(false);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const points = (canvas as unknown as Record<string, DataPoint[]>).__points || [];
    const selected = findPointsInLasso(lassoPath, points);
    setScatterSelection(selected);
    setShowSelectedPanel(true);
    setLassoPath([]);
    setIsDrawingLasso(false);
  }, [lassoPath, findPointsInLasso, setScatterSelection]);

  // Mouse move handler
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);

      // Rectangle dragging
      if (isDraggingRect && rectSelection) {
        setRectSelection((prev) => (prev ? { ...prev, endX: pos.x, endY: pos.y } : null));
        return;
      }

      // Polygon cursor tracking
      if (isDrawingPolygon) {
        setPolygonCursor(pos);
        return;
      }

      // Lasso drawing
      if (isDrawingLasso) {
        setLassoPath((prev) => [...prev, pos]);
        return;
      }

      // Hover detection
      const hit = hitTestPoint(pos.x, pos.y);
      setHoveredPoint(hit);
      setTooltipPos({ x: e.clientX, y: e.clientY });
    },
    [getCanvasPos, isDraggingRect, rectSelection, isDrawingPolygon, isDrawingLasso, hitTestPoint]
  );

  // Mouse down handler
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // left click only
      const pos = getCanvasPos(e);

      if (activeTool === 'rect') {
        setRectSelection({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
        setIsDraggingRect(true);
      } else if (activeTool === 'lasso') {
        setLassoPath([pos]);
        setIsDrawingLasso(true);
      }
      // Polygon uses click, not mousedown
    },
    [getCanvasPos, activeTool]
  );

  // Mouse up handler
  const handleMouseUp = useCallback(() => {
    // Rectangle selection complete
    if (isDraggingRect && rectSelection) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const points = (canvas as unknown as Record<string, DataPoint[]>).__points || [];
      const rx1 = Math.min(rectSelection.startX, rectSelection.endX);
      const ry1 = Math.min(rectSelection.startY, rectSelection.endY);
      const rx2 = Math.max(rectSelection.startX, rectSelection.endX);
      const ry2 = Math.max(rectSelection.startY, rectSelection.endY);

      if (Math.abs(rx2 - rx1) < 5 && Math.abs(ry2 - ry1) < 5) {
        // Click - select single point
        const hit = hitTestPoint(rectSelection.startX, rectSelection.startY);
        if (hit) {
          selectImage(hit.image.id);
        }
        setScatterSelection([]);
        setShowSelectedPanel(false);
      } else {
        const selected = points
          .filter((p) => p.screenX >= rx1 && p.screenX <= rx2 && p.screenY >= ry1 && p.screenY <= ry2)
          .map((p) => p.image.id);
        setScatterSelection(selected);
        if (selected.length > 0) setShowSelectedPanel(true);
      }
      setRectSelection(null);
      setIsDraggingRect(false);
    }

    // Lasso selection complete
    if (isDrawingLasso) {
      closeLasso();
    }
  }, [isDraggingRect, rectSelection, isDrawingLasso, hitTestPoint, selectImage, setScatterSelection, closeLasso]);

  // Canvas click handler (for polygon)
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'polygon') return;
      if (e.button !== 0) return;

      const pos = getCanvasPos(e);

      // Check if clicking near first vertex to close
      if (polygonVertices.length >= 3) {
        const first = polygonVertices[0];
        const dist = Math.sqrt((pos.x - first.x) ** 2 + (pos.y - first.y) ** 2);
        if (dist < 10) {
          closePolygon();
          return;
        }
      }

      // Add vertex
      setPolygonVertices((prev) => [...prev, pos]);
      setIsDrawingPolygon(true);
    },
    [activeTool, getCanvasPos, polygonVertices, closePolygon]
  );

  // Double click to close polygon
  const handleDoubleClick = useCallback(() => {
    if (activeTool === 'polygon' && polygonVertices.length >= 3) {
      closePolygon();
    }
  }, [activeTool, polygonVertices, closePolygon]);

  // Escape key to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPolygonVertices([]);
        setIsDrawingPolygon(false);
        setPolygonCursor(null);
        setLassoPath([]);
        setIsDrawingLasso(false);
        setRectSelection(null);
        setIsDraggingRect(false);
      }
      if (e.key === 'Enter' && activeTool === 'polygon' && polygonVertices.length >= 3) {
        closePolygon();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, polygonVertices, closePolygon]);

  const colorModes: { mode: ColorByMode; label: string }[] = [
    { mode: 'split', label: '划分' },
    { mode: 'lighting', label: SEMANTIC_LABELS.lighting },
    { mode: 'viewpoint', label: SEMANTIC_LABELS.viewpoint },
    { mode: 'blur', label: SEMANTIC_LABELS.blur },
    { mode: 'weather', label: SEMANTIC_LABELS.weather },
    { mode: 'timeOfDay', label: SEMANTIC_LABELS.timeOfDay },
    { mode: 'environment', label: SEMANTIC_LABELS.environment },
  ];

  const tools: { tool: SelectionTool; label: string; icon: string; hint: string }[] = [
    { tool: 'rect', label: '矩形', icon: '▭', hint: '拖拽框选' },
    { tool: 'polygon', label: '多边形', icon: '⬡', hint: '点击添加顶点，双击或 Enter 完成' },
    { tool: 'lasso', label: '套索', icon: '◌', hint: '按住绘制自由轮廓，松开完成' },
  ];

  const getCursorClass = (): string => {
    if (activeTool === 'polygon') return 'cursor-crosshair';
    if (activeTool === 'lasso') return 'cursor-crosshair';
    return 'cursor-crosshair';
  };

  const legendItems: LegendItem[] = (() => {
    if (colorByMode === 'split') {
      return Object.entries(SPLIT_COLORS).map(([split, color]) => ({
        label: SPLIT_LABELS[split],
        color,
        count: images.filter((img) => img.split === split).length,
      }));
    }

    if (
      colorByMode === 'lighting' ||
      colorByMode === 'viewpoint' ||
      colorByMode === 'blur' ||
      colorByMode === 'weather' ||
      colorByMode === 'timeOfDay' ||
      colorByMode === 'environment'
    ) {
      return Object.entries(SEMANTIC_COLORS[colorByMode]).map(([value, color]) => ({
        label: SEMANTIC_VALUE_LABELS[colorByMode][value],
        color,
        count: images.filter((img) => img.metadata.semantics[colorByMode] === value).length,
      }));
    }

    return Object.entries(SEMANTIC_COLORS.timeOfDay).map(([value, color]) => ({
      label: SEMANTIC_VALUE_LABELS.timeOfDay[value],
      color,
      count: images.filter((img) => img.metadata.semantics.timeOfDay === value).length,
    }));
  })();
  const activeColorLabel = colorModes.find((cm) => cm.mode === colorByMode)?.label || '划分';
  const legendSummary = legendItems.slice(0, 3);
  const remainingLegendCount = Math.max(legendItems.length - legendSummary.length, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Scatter controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#E2E8F0]">
        <div className="flex items-center gap-3">
          {/* Color mode */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#64748B] uppercase tracking-wider">着色</span>
            {colorModes.map((cm) => (
              <button
                key={cm.mode}
                onClick={() => setColorByMode(cm.mode)}
                className={cn(
                  'text-[11px] px-2 py-1 rounded transition-colors',
                  colorByMode === cm.mode
                    ? 'bg-[#2563EB] text-white'
                    : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F8FAFC]'
                )}
              >
                {cm.label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-[#E2E8F0]" />

          {/* Selection tools */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[#64748B] uppercase tracking-wider mr-1">选择</span>
            {tools.map((t) => (
              <button
                key={t.tool}
                onClick={() => {
                  setActiveTool(t.tool);
                  // Cancel ongoing drawing
                  setPolygonVertices([]);
                  setIsDrawingPolygon(false);
                  setPolygonCursor(null);
                  setLassoPath([]);
                  setIsDrawingLasso(false);
                  setRectSelection(null);
                  setIsDraggingRect(false);
                }}
                title={t.hint}
                className={cn(
                  'text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1',
                  activeTool === t.tool
                    ? 'bg-[#E2E8F0] text-[#0F172A] ring-1 ring-[#2563EB]/50'
                    : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F8FAFC]'
                )}
              >
                <span className="text-xs">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-[#E2E8F0]" />

          {/* Cleaning analysis toggle */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[#64748B] uppercase tracking-wider mr-1">清洗</span>
            <button
              onClick={() => setShowCleaning((v) => !v)}
              title="基于 2D embedding 检测离群点和近似重复样本"
              className={cn(
                'text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1',
                showCleaning
                  ? 'bg-[#EF4444]/10 text-[#EF4444] ring-1 ring-[#EF4444]/40'
                  : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F8FAFC]'
              )}
            >
              <span className="text-xs">⊕</span>
              清洗建议
            </button>
            {showCleaning && cleaning && (
              <div className="flex items-center gap-2 ml-1 text-[10px]">
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#EF4444]/10 text-[#EF4444]"
                  title="k-NN 距离异常"
                >
                  离群 {cleaning.outliers.length}
                </span>
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#2563EB]/10 text-[#2563EB]"
                  title="成对距离过近"
                >
                  重复对 {cleaning.duplicates.length}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {scatterSelection.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#2563EB] font-medium">
                已选 {scatterSelection.length} 张
              </span>
              <button
                onClick={() => {
                  setScatterSelection([]);
                  setShowSelectedPanel(false);
                }}
                className="text-[10px] px-2 py-0.5 rounded bg-[#E2E8F0] text-[#475569] hover:text-[#0F172A] hover:bg-[#CBD5E1] transition-colors"
              >
                清除
              </button>
              <button
                onClick={() => setShowSelectedPanel(!showSelectedPanel)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded transition-colors',
                  showSelectedPanel
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-[#E2E8F0] text-[#475569] hover:text-[#0F172A] hover:bg-[#CBD5E1]'
                )}
              >
                {showSelectedPanel ? '收起' : '展开'}列表
              </button>
            </div>
          )}
          <span className="text-[10px] text-[#64748B]">
            {activeTool === 'polygon'
              ? '点击添加顶点 | 双击/Enter 完成 | Esc 取消'
              : activeTool === 'lasso'
              ? '按住绘制，松开完成选择'
              : '拖拽框选 | 点击点查看详情'}
          </span>
        </div>
      </div>

      {/* Canvas + Selection Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Scatter canvas */}
        <div ref={containerRef} className={cn('relative', showSelectedPanel ? 'flex-1 min-h-0' : 'flex-1')}>
          <canvas
            ref={canvasRef}
            className={cn('absolute inset-0', getCursorClass())}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={handleCanvasClick}
            onDoubleClick={handleDoubleClick}
            onMouseLeave={() => {
              setHoveredPoint(null);
              if (isDraggingRect) handleMouseUp();
              if (isDrawingLasso) closeLasso();
            }}
          />

          {/* Color legend */}
          <div className="absolute top-3 right-3 z-10 max-w-[360px] rounded-md border border-[#D8E4F2] bg-white/85 px-2.5 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur-md">
            <button
              type="button"
              onClick={() => setShowLegend((value) => !value)}
              className="flex w-full items-center gap-2 text-left"
            >
              <span className="shrink-0 text-[10px] font-medium text-[#475569]">
                着色：{activeColorLabel}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                {legendSummary.map((item) => (
                  <span key={item.label} className="flex min-w-0 items-center gap-1 text-[10px]">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate text-[#475569]">{item.label}</span>
                    {item.count !== null && (
                      <span className="font-mono text-[#64748B]">{item.count}</span>
                    )}
                  </span>
                ))}
                {remainingLegendCount > 0 && (
                  <span className="shrink-0 text-[10px] text-[#64748B]">
                    +{remainingLegendCount}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[10px] text-[#64748B]">
                {showLegend ? '收起' : '展开'}
              </span>
            </button>
            {showLegend && (
              <div className="mt-2 max-h-[220px] space-y-1 overflow-y-auto border-t border-[#E2E8F0] pt-2">
                {legendItems.map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5 text-[10px]">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[#475569]">{item.label}</span>
                    {item.count !== null && (
                      <span className="font-mono text-[#64748B]">{item.count}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tooltip */}
          {hoveredPoint && !isDraggingRect && !isDrawingLasso && !isDrawingPolygon && (
            <div
              className="fixed z-50 pointer-events-none"
              style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 10 }}
            >
              <div className="bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg p-2 shadow-xl min-w-[160px]">
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: getPointColor(hoveredPoint.image) }}
                  />
                  <span className="text-xs text-[#0F172A] font-mono">
                    {hoveredPoint.image.filename}
                  </span>
                </div>
                <div className="text-[10px] text-[#475569] space-y-0.5">
                  <div>类别: {hoveredPoint.image.detections.map((d) => d.label).join(', ')}</div>
                  <div>
                    划分: <span className="text-[#0F172A]">{SPLIT_LABELS[hoveredPoint.image.split]}</span>
                  </div>
                  <div>
                    语义:{' '}
                    <span className="text-[#0F172A]">
                      {SEMANTIC_VALUE_LABELS.timeOfDay[hoveredPoint.image.metadata.semantics.timeOfDay]},{' '}
                      {SEMANTIC_VALUE_LABELS.environment[hoveredPoint.image.metadata.semantics.environment]},{' '}
                      {SEMANTIC_VALUE_LABELS.blur[hoveredPoint.image.metadata.semantics.blur]}
                    </span>
                  </div>
                  <div>
                    向量: [{hoveredPoint.image.embedding2d[0].toFixed(2)},{' '}
                    {hoveredPoint.image.embedding2d[1].toFixed(2)}]
                  </div>
                  {showCleaning && (
                    <div className="flex flex-wrap gap-1 pt-1 border-t border-[#E2E8F0] mt-1">
                      {outlierIds.has(hoveredPoint.image.id) && (
                        <span className="px-1 py-0 rounded bg-[#EF4444]/15 text-[#EF4444]">
                          疑似离群点
                        </span>
                      )}
                      {duplicateIdSet.has(hoveredPoint.image.id) && (
                        <span className="px-1 py-0 rounded bg-[#2563EB]/15 text-[#2563EB]">
                          疑似重复样本
                        </span>
                      )}
                      {!outlierIds.has(hoveredPoint.image.id) &&
                        !duplicateIdSet.has(hoveredPoint.image.id) && (
                          <span className="text-[#64748B]">无清洗建议</span>
                        )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Cleaning legend */}
          {showCleaning && cleaning && (
            <div className="absolute bottom-3 right-3 z-10 rounded-md border border-[#D8E4F2] bg-white/85 px-2.5 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur-md">
              <div className="text-[10px] font-medium text-[#475569] mb-1.5">
                清洗建议
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="relative inline-flex h-3 w-3 items-center justify-center">
                    <span className="absolute inline-flex h-3 w-3 rounded-full border-[3px] border-[#EF4444]/25" />
                    <span className="absolute inline-flex h-3 w-3 rounded-full border border-[#EF4444]" />
                  </span>
                  <span className="text-[#475569]">离群点</span>
                  <span className="ml-auto font-mono text-[#64748B]">
                    {cleaning.outliers.length}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="relative inline-flex h-3 w-5 items-center justify-center">
                    <span className="absolute inline-flex h-[7px] w-5 rounded-full bg-[#2563EB]/20" />
                    <span className="absolute inline-flex h-[1.5px] w-5 bg-[#2563EB]/85" />
                    <span className="absolute left-0 inline-flex h-3 w-3 rounded-full border border-[#2563EB]" />
                    <span className="absolute right-0 inline-flex h-3 w-3 rounded-full border border-[#2563EB]" />
                  </span>
                  <span className="text-[#475569]">重复对</span>
                  <span className="ml-auto font-mono text-[#64748B]">
                    {cleaning.duplicates.length}
                  </span>
                </div>
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-[#E2E8F0] text-[9px] text-[#64748B] leading-relaxed">
                基于 2D embedding 启发式
              </div>
            </div>
          )}
        </div>

        {/* Selected Images Panel */}
        {showSelectedPanel && scatterSelection.length > 0 && (
          <div className="h-[200px] border-t border-[#E2E8F0] bg-[#FFFFFF] flex flex-col shrink-0">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#E2E8F0] shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#0F172A]">已选图片</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2563EB]/20 text-[#2563EB] font-mono">
                  {selectedImages.length}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-[#64748B]">
                <span>
                  类别:{' '}
                  <span className="text-[#475569]">
                    {new Set(selectedImages.flatMap((i) => i.detections.map((d) => d.label))).size}
                  </span>
                </span>
                <span>
                  标注:{' '}
                  <span className="text-[#475569]">
                    {selectedImages.reduce((s, i) => s + i.detections.length, 0)}
                  </span>
                </span>
                <button
                  onClick={() => setShowSelectedPanel(false)}
                  className="text-[#64748B] hover:text-[#0F172A] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Thumbnail grid */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden p-3">
              <div className="flex gap-2 h-full">
                {selectedImages.map((img) => (
                  <SelectedImageCard key={img.id} image={img} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Selected image thumbnail card
function SelectedImageCard({ image }: { image: DatasetImage }) {
  const { selectImage, selectedImageId } = useGalleryStore();
  const isSelected = selectedImageId === image.id;
  const aspectRatio = image.width / image.height;

  return (
    <button
      onClick={() => selectImage(isSelected ? null : image.id)}
      className={cn(
        'relative group flex-shrink-0 h-full rounded-lg overflow-hidden border transition-all duration-150',
        isSelected
          ? 'border-[#2563EB] ring-1 ring-[#2563EB]/30'
          : 'border-[#E2E8F0] hover:border-[#CBD5E1]'
      )}
      style={{ aspectRatio }}
    >
      {/* Image */}
      <img
        src={getImageUrl(image.id, 240, Math.round(240 / aspectRatio))}
        alt={image.filename}
        className="w-full h-full object-cover"
        loading="lazy"
      />

      {/* BBox overlay */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${image.width} ${image.height}`}
        preserveAspectRatio="none"
      >
        {image.detections.map((det) => {
          const [x, y, w, h] = det.bbox;
          const color = CATEGORY_COLORS[det.label] || '#2563EB';
          return (
            <rect
              key={det.id}
              x={x * image.width}
              y={y * image.height}
              width={w * image.width}
              height={h * image.height}
              fill="none"
              stroke={color}
              strokeWidth="3"
              opacity={0.8}
            />
          );
        })}
      </svg>

      {/* Info overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/95 via-white/75 to-transparent p-2 pt-6 backdrop-blur-[1px]">
        <p className="text-[9px] text-[#0F172A] font-mono truncate">{image.filename}</p>
        <div className="flex items-center gap-1 mt-0.5">
          {image.detections.slice(0, 3).map((det) => (
            <span
              key={det.id}
              className="text-[8px] px-1 py-0 rounded"
              style={{
                backgroundColor: `${CATEGORY_COLORS[det.label]}30`,
                color: CATEGORY_COLORS[det.label],
              }}
            >
              {det.label}
            </span>
          ))}
        </div>
      </div>

      {/* Split badge */}
      <div className="absolute top-1 right-1">
        <span
          className={cn(
            'text-[8px] font-medium px-1 py-0.5 rounded border bg-white/90 text-[#0F172A] shadow-sm backdrop-blur-sm',
            image.split === 'train'
              ? 'border-blue-200'
              : image.split === 'validation'
              ? 'border-amber-200'
              : 'border-emerald-200'
          )}
        >
          {SPLIT_SHORT_LABELS[image.split]}
        </span>
      </div>
    </button>
  );
}
