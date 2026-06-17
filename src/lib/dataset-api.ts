import type { DatasetPayload, DatasetUploadJob } from './types';

export async function fetchCurrentDataset(): Promise<DatasetPayload> {
  const response = await fetch('/api/dataset/current', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await readError(response, '加载数据集失败'));
  }
  return (await response.json()) as DatasetPayload;
}

export async function uploadDatasetZip(file: File): Promise<DatasetUploadJob> {
  const response = await fetch('/api/dataset/upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/zip',
      'x-filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    throw new Error(await readError(response, '上传数据集失败'));
  }
  return (await response.json()) as DatasetUploadJob;
}

export async function fetchUploadJob(jobId: string): Promise<DatasetUploadJob> {
  const response = await fetch(`/api/dataset/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await readError(response, '获取数据集解析进度失败'));
  }
  return (await response.json()) as DatasetUploadJob;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || fallback;
  } catch {
    return fallback;
  }
}
