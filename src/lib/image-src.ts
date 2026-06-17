import type { DatasetImage } from './types';
import { getImageUrl } from './mock-data';

export function resolveImageSrc(image: DatasetImage, width: number, height: number): string {
  if (image.filepath.startsWith('/api/')) return image.filepath;
  return getImageUrl(image.id, width, height);
}
