'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useGalleryStore } from '@/lib/store';
import {
  CATEGORY_COLORS,
  SEMANTIC_COLORS,
  SEMANTIC_LABELS,
  SPLIT_COLORS,
  getConfidenceColorScale,
  getImageUrl,
} from '@/lib/mock-data';
import type { DatasetImage } from '@/lib/types';
import type { ColorByMode } from '@/lib/types';
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

  // Compute bounds
  const allEmbeddings = images.map((img) => img.embedding2d);
  const xMin = allEmbeddings.length > 0 ? Math.min(...allEmbeddings.map((e) => e[0])) - 0.5 : -5;
  const xMax = allEmbeddings.length > 0 ? Math.max(...allEmbeddings.map((e) => e[0])) + 0.5 : 5;
  const yMin = allEmbeddings.length > 0 ? Math.min(...allEmbeddings.map((e) => e[1])) - 0.5 : -5;
  const yMax = allEmbeddings.length > 0 ? Math.max(...allEmbeddings.map((e) => e[1])) + 0.5 : 5;

  const getPointColor = useCallback(
    (img: DatasetImage): string => {
      switch (colorByMode) {
        case 'category':
          return CATEGORY_COLORS[img.detections[0]?.label] || '#6366f1';
        case 'split':
          return SPLIT_COLORS[img.split] || '#6366f1';
        case 'confidence':
          return getConfidenceColorScale(img.detections[0]?.confidence || 0.5);
        case 'cluster':
          return CATEGORY_COLORS[img.detections[0]?.label] || '#6366f1';
        case 'lighting':
        case 'viewpoint':
        case 'blur':
        case 'weather':
        case 'timeOfDay':
        case 'environment':
          return SEMANTIC_COLORS[colorByMode][img.metadata.semantics[colorByMode]] || '#6366f1';
        default:
          return '#6366f1';
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
    ctx.fillStyle = '#0a0b10';
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#1a1c2a';
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
        ctx.strokeStyle = '#ffffff40';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Draw rectangle selection
    if (rectSelection) {
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.06)';
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
        ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
        ctx.fill();
      }
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw vertices
      for (const v of polygonVertices) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#6366f1';
        ctx.fill();
        ctx.strokeStyle = '#0a0b10';
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
      ctx.fillStyle = 'rgba(99, 102, 241, 0.06)';
      ctx.fill();
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axis labels
    ctx.fillStyle = '#555872';
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
  }, [images, colorByMode, scatterSelection, rectSelection, polygonVertices, polygonCursor, lassoPath, xMin, xMax, yMin, yMax, getPointColor]);

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
    { mode: 'category', label: 'Category' },
    { mode: 'split', label: 'Split' },
    { mode: 'confidence', label: 'Confidence' },
    { mode: 'lighting', label: SEMANTIC_LABELS.lighting },
    { mode: 'viewpoint', label: SEMANTIC_LABELS.viewpoint },
    { mode: 'blur', label: SEMANTIC_LABELS.blur },
    { mode: 'weather', label: SEMANTIC_LABELS.weather },
    { mode: 'timeOfDay', label: SEMANTIC_LABELS.timeOfDay },
    { mode: 'environment', label: SEMANTIC_LABELS.environment },
  ];

  const tools: { tool: SelectionTool; label: string; icon: string; hint: string }[] = [
    { tool: 'rect', label: 'Rect', icon: '▭', hint: 'Drag to select' },
    { tool: 'polygon', label: 'Polygon', icon: '⬡', hint: 'Click vertices, dbl-click/Enter to close' },
    { tool: 'lasso', label: 'Lasso', icon: '◌', hint: 'Draw freeform, release to close' },
  ];

  const getCursorClass = (): string => {
    if (activeTool === 'polygon') return 'cursor-crosshair';
    if (activeTool === 'lasso') return 'cursor-crosshair';
    return 'cursor-crosshair';
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Scatter controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e2030]">
        <div className="flex items-center gap-3">
          {/* Color mode */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#555872] uppercase tracking-wider">Color</span>
            {colorModes.map((cm) => (
              <button
                key={cm.mode}
                onClick={() => setColorByMode(cm.mode)}
                className={cn(
                  'text-[11px] px-2 py-1 rounded transition-colors',
                  colorByMode === cm.mode
                    ? 'bg-[#6366f1] text-white'
                    : 'text-[#8b8ea8] hover:text-[#e2e4f0] hover:bg-[#161822]'
                )}
              >
                {cm.label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-[#1e2030]" />

          {/* Selection tools */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[#555872] uppercase tracking-wider mr-1">Select</span>
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
                    ? 'bg-[#1e2030] text-[#e2e4f0] ring-1 ring-[#6366f1]/50'
                    : 'text-[#8b8ea8] hover:text-[#e2e4f0] hover:bg-[#161822]'
                )}
              >
                <span className="text-xs">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {scatterSelection.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#6366f1] font-medium">
                {scatterSelection.length} selected
              </span>
              <button
                onClick={() => {
                  setScatterSelection([]);
                  setShowSelectedPanel(false);
                }}
                className="text-[10px] px-2 py-0.5 rounded bg-[#1e2030] text-[#8b8ea8] hover:text-[#e2e4f0] hover:bg-[#2a2d42] transition-colors"
              >
                Clear
              </button>
              <button
                onClick={() => setShowSelectedPanel(!showSelectedPanel)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded transition-colors',
                  showSelectedPanel
                    ? 'bg-[#6366f1] text-white'
                    : 'bg-[#1e2030] text-[#8b8ea8] hover:text-[#e2e4f0] hover:bg-[#2a2d42]'
                )}
              >
                {showSelectedPanel ? 'Hide' : 'Show'} Panel
              </button>
            </div>
          )}
          <span className="text-[10px] text-[#555872]">
            {activeTool === 'polygon'
              ? 'Click to add vertex | Dbl-click/Enter to close | Esc cancel'
              : activeTool === 'lasso'
              ? 'Draw & release to select'
              : 'Drag to select | Click point to inspect'}
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

          {/* Tooltip */}
          {hoveredPoint && !isDraggingRect && !isDrawingLasso && !isDrawingPolygon && (
            <div
              className="fixed z-50 pointer-events-none"
              style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 10 }}
            >
              <div className="bg-[#161822] border border-[#2a2d42] rounded-lg p-2 shadow-xl min-w-[160px]">
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: getPointColor(hoveredPoint.image) }}
                  />
                  <span className="text-xs text-[#e2e4f0] font-mono">
                    {hoveredPoint.image.filename}
                  </span>
                </div>
                <div className="text-[10px] text-[#8b8ea8] space-y-0.5">
                  <div>Labels: {hoveredPoint.image.detections.map((d) => d.label).join(', ')}</div>
                  <div>
                    Split: <span className="text-[#e2e4f0]">{hoveredPoint.image.split}</span>
                  </div>
                  <div>
                    Semantics:{' '}
                    <span className="text-[#e2e4f0]">
                      {hoveredPoint.image.metadata.semantics.timeOfDay},{' '}
                      {hoveredPoint.image.metadata.semantics.environment},{' '}
                      {hoveredPoint.image.metadata.semantics.blur}
                    </span>
                  </div>
                  <div>
                    Embedding: [{hoveredPoint.image.embedding2d[0].toFixed(2)},{' '}
                    {hoveredPoint.image.embedding2d[1].toFixed(2)}]
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Selected Images Panel */}
        {showSelectedPanel && scatterSelection.length > 0 && (
          <div className="h-[200px] border-t border-[#1e2030] bg-[#0f1117] flex flex-col shrink-0">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e2030] shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#e2e4f0]">Selected Images</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#6366f1]/20 text-[#6366f1] font-mono">
                  {selectedImages.length}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-[#555872]">
                <span>
                  Categories:{' '}
                  <span className="text-[#8b8ea8]">
                    {new Set(selectedImages.flatMap((i) => i.detections.map((d) => d.label))).size}
                  </span>
                </span>
                <span>
                  Annotations:{' '}
                  <span className="text-[#8b8ea8]">
                    {selectedImages.reduce((s, i) => s + i.detections.length, 0)}
                  </span>
                </span>
                <button
                  onClick={() => setShowSelectedPanel(false)}
                  className="text-[#555872] hover:text-[#e2e4f0] transition-colors"
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
          ? 'border-[#6366f1] ring-1 ring-[#6366f1]/30'
          : 'border-[#1e2030] hover:border-[#2a2d42]'
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
          const color = CATEGORY_COLORS[det.label] || '#6366f1';
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
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
        <p className="text-[9px] text-[#e2e4f0] font-mono truncate">{image.filename}</p>
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
            'text-[8px] font-medium px-1 py-0.5 rounded bg-black/60 backdrop-blur-sm',
            image.split === 'train'
              ? 'text-blue-400'
              : image.split === 'validation'
              ? 'text-amber-400'
              : 'text-emerald-400'
          )}
        >
          {image.split.slice(0, 3).toUpperCase()}
        </span>
      </div>
    </button>
  );
}
