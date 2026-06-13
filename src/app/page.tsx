'use client';

import { TopBar } from '@/components/topbar';
import { Sidebar } from '@/components/sidebar';
import { GridView } from '@/components/grid-view';
import { ScatterView } from '@/components/scatter-view';
import { DetailPanel } from '@/components/detail-panel';
import { useGalleryStore } from '@/lib/store';

export default function HomePage() {
  const viewMode = useGalleryStore((s) => s.viewMode);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#08090d] text-[#e2e4f0] overflow-hidden">
      {/* Top Bar */}
      <TopBar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Filters */}
        <Sidebar />

        {/* Center - Main View */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#0a0b10]">
          {viewMode === 'grid' ? <GridView /> : <ScatterView />}
        </main>

        {/* Right Panel - Details */}
        <DetailPanel />
      </div>

      {/* Bottom Status Bar */}
      <StatusBar />
    </div>
  );
}

function StatusBar() {
  const { getFilteredImages, viewMode, scatterSelection } = useGalleryStore();
  const filtered = getFilteredImages();
  const totalAnnotations = filtered.reduce((sum, img) => sum + img.detections.length, 0);
  const categories = new Set(filtered.flatMap((img) => img.detections.map((d) => d.label)));

  return (
    <footer className="h-[32px] border-t border-[#1e2030] bg-[#0f1117] flex items-center px-4 gap-6 shrink-0">
      <span className="text-[10px] text-[#555872]">
        当前视图: <span className="text-[#8b8ea8]">{viewMode === 'grid' ? '图库' : '向量分布'}</span>
      </span>
      <span className="text-[10px] text-[#555872]">
        图片: <span className="text-[#8b8ea8]">{filtered.length}</span>
      </span>
      <span className="text-[10px] text-[#555872]">
        标注: <span className="text-[#8b8ea8]">{totalAnnotations}</span>
      </span>
      <span className="text-[10px] text-[#555872]">
        类别: <span className="text-[#8b8ea8]">{categories.size}</span>
      </span>
      {scatterSelection.length > 0 && (
        <span className="text-[10px] text-[#6366f1]">
          已选: <span className="font-medium">{scatterSelection.length}</span>
        </span>
      )}
      <div className="flex-1" />
      <span className="text-[10px] text-[#555872]">
        数据集分析台 v1.0
      </span>
    </footer>
  );
}
