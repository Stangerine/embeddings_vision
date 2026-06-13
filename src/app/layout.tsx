import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '目标检测数据集分析',
  description: '目标检测数据集可视化与语义切分分析工具',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased bg-[#08090d] text-[#e2e4f0]">
        {children}
      </body>
    </html>
  );
}
