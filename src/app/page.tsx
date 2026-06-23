'use client';

import { useEffect } from 'react';
import { TopBar } from '@/components/topbar';
import { Sidebar } from '@/components/sidebar';
import { GridView } from '@/components/grid-view';
import { ScatterView } from '@/components/scatter-view';
import { DetailPanel } from '@/components/detail-panel';
import { useGalleryStore } from '@/lib/store';

export default function HomePage() {
  const viewMode = useGalleryStore((s) => s.viewMode);
  const loadDataset = useGalleryStore((s) => s.loadDataset);

  useEffect(() => {
    void loadDataset();
  }, [loadDataset]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F6F8FB] text-[#0F172A] overflow-hidden">
      {/* Top Bar */}
      <TopBar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Filters */}
        <Sidebar />

        {/* Center - Main View */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#F6F8FB]">
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
    <footer className="h-[32px] border-t border-[#E2E8F0] bg-[#FFFFFF] flex items-center px-4 gap-6 shrink-0">
      <span className="text-[10px] text-[#64748B]">
        当前视图: <span className="text-[#475569]">{viewMode === 'grid' ? '图库' : '向量分布'}</span>
      </span>
      <span className="text-[10px] text-[#64748B]">
        图片: <span className="text-[#475569]">{filtered.length}</span>
      </span>
      <span className="text-[10px] text-[#64748B]">
        标注: <span className="text-[#475569]">{totalAnnotations}</span>
      </span>
      <span className="text-[10px] text-[#64748B]">
        类别: <span className="text-[#475569]">{categories.size}</span>
      </span>
      {scatterSelection.length > 0 && (
        <span className="text-[10px] text-[#2563EB]">
          已选: <span className="font-medium">{scatterSelection.length}</span>
        </span>
      )}
      <div className="flex-1" />
      <span className="text-[10px] text-[#64748B]">
        数据集分析台 v1.0
      </span>
    </footer>
  );
}
