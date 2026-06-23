from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Iterator

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config.dataset_settings import BGE_SETTINGS, DATASET_SETTINGS
from scripts.export_bge_image_onnx import BGEImageEmbeddingWrapper


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark BGE image embeddings with PyTorch vs ONNX Runtime.")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--onnx-model", type=Path, default=Path(".model-cache/bge-vl-large-image/model.onnx"))
    parser.add_argument("--model-path", type=Path, default=BGE_SETTINGS.model_path)
    parser.add_argument("--device", default=BGE_SETTINGS.device or "cuda:0")
    parser.add_argument("--batch-size", type=int, default=BGE_SETTINGS.batch_size)
    parser.add_argument("--limit", type=int, default=512)
    parser.add_argument("--output-dir", type=Path, default=Path("logs"))
    return parser.parse_args()


def iter_zip_images(dataset_zip: Path, limit: int) -> Iterator[Path]:
    temp_dir = Path(tempfile.mkdtemp(prefix="bge_onnx_benchmark_images_"))
    count = 0
    with zipfile.ZipFile(dataset_zip) as archive:
        for member in archive.infolist():
            suffix = Path(member.filename).suffix.lower()
            if member.is_dir() or suffix not in DATASET_SETTINGS.image_extensions:
                continue
            target = temp_dir / Path(member.filename).name
            with archive.open(member) as source, target.open("wb") as destination:
                destination.write(source.read())
            yield target
            count += 1
            if count >= limit:
                return


def batched(items: list[Path], batch_size: int) -> Iterator[list[Path]]:
    for index in range(0, len(items), batch_size):
        yield items[index : index + batch_size]


def load_torch_model(model_path: Path, device: str) -> tuple[torch.nn.Module, object]:
    from transformers import AutoModel

    model = AutoModel.from_pretrained(str(model_path), trust_remote_code=True)
    model.set_processor(str(model_path))
    model.to(device)
    model.eval()
    return BGEImageEmbeddingWrapper(model).to(device), model.processor


def preprocess_images(processor: object, paths: list[Path], device: str) -> torch.Tensor:
    images = [Image.open(path).convert("RGB") for path in paths]
    inputs = processor(images=images, return_tensors="pt")
    return inputs["pixel_values"].to(device)


def encode_torch(wrapper: torch.nn.Module, processor: object, paths: list[Path], batch_size: int, device: str) -> tuple[np.ndarray, float]:
    outputs: list[np.ndarray] = []
    started_at = time.perf_counter()
    with torch.no_grad():
        for batch in batched(paths, batch_size):
            pixel_values = preprocess_images(processor, batch, device)
            embeddings = wrapper(pixel_values)
            outputs.append(embeddings.detach().cpu().numpy())
    return np.concatenate(outputs, axis=0), time.perf_counter() - started_at


def encode_onnx(session: ort.InferenceSession, processor: object, paths: list[Path], batch_size: int) -> tuple[np.ndarray, float]:
    outputs: list[np.ndarray] = []
    started_at = time.perf_counter()
    for batch in batched(paths, batch_size):
        pixel_values = preprocess_images(processor, batch, "cpu").numpy()
        embeddings = session.run(["image_embeds"], {"pixel_values": pixel_values})[0]
        outputs.append(embeddings)
    return np.concatenate(outputs, axis=0), time.perf_counter() - started_at


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    numerator = np.sum(a * b, axis=1)
    denominator = np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1)
    return numerator / np.maximum(denominator, 1e-12)


def main() -> None:
    args = parse_args()
    if not args.onnx_model.exists():
        raise FileNotFoundError(args.onnx_model)
    image_paths = list(iter_zip_images(args.dataset, args.limit))
    if not image_paths:
        raise FileNotFoundError(f"No images found in {args.dataset}")

    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    session = ort.InferenceSession(str(args.onnx_model), providers=providers)
    wrapper, processor = load_torch_model(args.model_path, args.device)

    # Warm up both backends.
    _torch_warm, _ = encode_torch(wrapper, processor, image_paths[: min(args.batch_size, len(image_paths))], args.batch_size, args.device)
    _onnx_warm, _ = encode_onnx(session, processor, image_paths[: min(args.batch_size, len(image_paths))], args.batch_size)

    torch_embeddings, torch_seconds = encode_torch(wrapper, processor, image_paths, args.batch_size, args.device)
    onnx_embeddings, onnx_seconds = encode_onnx(session, processor, image_paths, args.batch_size)
    cosine = cosine_similarity(torch_embeddings, onnx_embeddings)

    result = {
        "createdAt": datetime.now().isoformat(),
        "dataset": str(args.dataset),
        "imageCount": len(image_paths),
        "batchSize": args.batch_size,
        "onnxModel": str(args.onnx_model),
        "providers": session.get_providers(),
        "torchSeconds": round(torch_seconds, 6),
        "onnxSeconds": round(onnx_seconds, 6),
        "torchMsPerImage": round((torch_seconds / len(image_paths)) * 1000, 3),
        "onnxMsPerImage": round((onnx_seconds / len(image_paths)) * 1000, 3),
        "speedup": round(torch_seconds / onnx_seconds, 4) if onnx_seconds else None,
        "torchShape": list(torch_embeddings.shape),
        "onnxShape": list(onnx_embeddings.shape),
        "cosineMean": round(float(np.mean(cosine)), 6),
        "cosineMin": round(float(np.min(cosine)), 6),
        "maxAbsDiff": round(float(np.max(np.abs(torch_embeddings - onnx_embeddings))), 6),
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output_dir / f"bge_onnx_benchmark_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    print(f"logPath={output_path.resolve()}", flush=True)


if __name__ == "__main__":
    main()
