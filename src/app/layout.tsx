import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Detection Gallery',
  description: 'Object Detection Dataset Visualization & Analysis Tool',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-[#08090d] text-[#e2e4f0]">
        {children}
      </body>
    </html>
  );
}
