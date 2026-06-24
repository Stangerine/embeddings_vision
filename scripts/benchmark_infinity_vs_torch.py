#!/usr/bin/env python3
"""
Benchmark: Infinity Embedding vs Standard PyTorch for BGE-VL-large image inference.

Compares:
1. Standard PyTorch inference (via sentence-transformers)
2. Infinity Embedding optimized inference

Outputs JSON logs to logs/ directory.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

import numpy as np
import torch
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config.dataset_settings import BGE_SETTINGS, DATASET_SETTINGS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark Infinity Embedding vs PyTorch for BGE-VL-large"
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=os.environ.get(
            "SAMPLE_ZIP_PATH",
            "E:\\zzq\\误报\\2025-04-01\\sample_split_80_10_10.zip" if os.name == "nt"
            else "/home/shao/zzq/误报/2025-04-01/sample_split_80_10_10.zip",
        ),
    )
    parser.add_argument(
        "--model-path",
        type=Path,
        default=BGE_SETTINGS.model_path,
        help="BGE-VL-large model path.",
    )
    parser.add_argument("--device", default=BGE_SETTINGS.device or "cuda:0")
    parser.add_argument("--batch-size", type=int, default=BGE_SETTINGS.batch_size)
    parser.add_argument("--limit", type=int, default=200, help="Max images to process.")
    parser.add_argument("--warmup", type=int, default=2, help="Warmup iterations.")
    parser.add_argument("--output-dir", type=Path, default=Path("logs"))
    return parser.parse_args()


def extract_images(dataset_zip: Path, limit: int) -> list[Path]:
    """Extract images from ZIP to temp directory."""
    temp_dir = Path(tempfile.mkdtemp(prefix="infinity_benchmark_"))
    image_paths: list[Path] = []
    count = 0

    with zipfile.ZipFile(dataset_zip) as archive:
        for member in archive.infolist():
            suffix = Path(member.filename).suffix.lower()
            if member.is_dir() or suffix not in DATASET_SETTINGS.image_extensions:
                continue
            target = temp_dir / Path(member.filename).name
            with archive.open(member) as source, target.open("wb") as destination:
                destination.write(source.read())
            image_paths.append(target)
            count += 1
            if count >= limit:
                break

    LOGGER.info(f"Extracted {len(image_paths)} images to {temp_dir}")
    return image_paths


def load_torch_model(model_path: Path, device: str) -> Any:
    """Load BGE model with standard PyTorch."""
    from transformers import AutoModel

    LOGGER.info(f"Loading PyTorch model from {model_path} to {device}")
    model = AutoModel.from_pretrained(str(model_path), trust_remote_code=True)
    model.set_processor(str(model_path))
    model.to(device)
    model.eval()
    return model


def load_infinity_engine(model_path: Path, device: str, batch_size: int) -> Any:
    """Load BGE model with Infinity Embedding engine."""
    from infinity_emb import AsyncEmbeddingEngine, EngineArgs

    LOGGER.info(f"Loading Infinity engine from {model_path} to {device}")

    # Determine device type for Infinity
    device_type = "cuda" if "cuda" in device else "cpu"

    engine_args = EngineArgs(
        model_name_or_path=str(model_path),
        device=device_type,
        batch_size=batch_size,
        model_warmup=False,  # We'll do manual warmup
    )
    engine = AsyncEmbeddingEngine.from_args(engine_args)
    return engine


def preprocess_images_torch(processor: object, paths: list[Path], device: str) -> torch.Tensor:
    """Preprocess images for PyTorch model."""
    images = [Image.open(path).convert("RGB") for path in paths]
    inputs = processor(images=images, return_tensors="pt")
    return inputs["pixel_values"].to(device)


def encode_torch(
    model: Any,
    processor: object,
    image_paths: list[Path],
    batch_size: int,
    device: str,
) -> tuple[np.ndarray, float]:
    """Encode images using standard PyTorch inference."""
    outputs: list[np.ndarray] = []
    started_at = time.perf_counter()

    with torch.no_grad():
        for i in range(0, len(image_paths), batch_size):
            batch = image_paths[i : i + batch_size]
            pixel_values = preprocess_images_torch(processor, batch, device)
            embeddings = model(pixel_values)
            # Pool if needed (BGE returns last_hidden_state)
            if hasattr(embeddings, "last_hidden_state"):
                embeddings = embeddings.last_hidden_state.mean(dim=1)
            outputs.append(embeddings.detach().cpu().numpy())

    elapsed = time.perf_counter() - started_at
    return np.concatenate(outputs, axis=0), elapsed


def encode_infinity(
    engine: Any,
    image_paths: list[Path],
    batch_size: int,
) -> tuple[np.ndarray, float]:
    """Encode images using Infinity Embedding engine."""
    import asyncio

    async def _encode() -> tuple[np.ndarray, float]:
        # Load images as bytes
        image_bytes_list = []
        for path in image_paths:
            with open(path, "rb") as f:
                image_bytes_list.append(f.read())

        started_at = time.perf_counter()
        embeddings, usage = await engine.image_embed(images=image_bytes_list)
        elapsed = time.perf_counter() - started_at

        return np.array(embeddings), elapsed

    # Run async in sync context
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(_encode())
    finally:
        loop.close()


def cosine_similarity_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Compute cosine similarity between corresponding rows."""
    numerator = np.sum(a * b, axis=1)
    denominator = np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1)
    return numerator / np.maximum(denominator, 1e-12)


def run_benchmark(args: argparse.Namespace) -> dict[str, Any]:
    """Run the full benchmark."""
    # Extract images
    image_paths = extract_images(args.dataset, args.limit)
    if not image_paths:
        raise FileNotFoundError(f"No images found in {args.dataset}")

    results: dict[str, Any] = {
        "createdAt": datetime.now().isoformat(),
        "dataset": str(args.dataset),
        "modelPath": str(args.model_path),
        "device": args.device,
        "imageCount": len(image_paths),
        "batchSize": args.batch_size,
    }

    # === Standard PyTorch ===
    LOGGER.info("=" * 60)
    LOGGER.info("Running Standard PyTorch Benchmark")
    LOGGER.info("=" * 60)

    torch_model = load_torch_model(args.model_path, args.device)

    # Warmup
    for i in range(args.warmup):
        LOGGER.info(f"PyTorch warmup {i + 1}/{args.warmup}")
        _warmup_emb, _ = encode_torch(
            torch_model,
            torch_model.processor,
            image_paths[: args.batch_size],
            args.batch_size,
            args.device,
        )

    # Benchmark
    torch_embeddings, torch_seconds = encode_torch(
        torch_model,
        torch_model.processor,
        image_paths,
        args.batch_size,
        args.device,
    )

    results["torch"] = {
        "seconds": round(torch_seconds, 6),
        "msPerImage": round((torch_seconds / len(image_paths)) * 1000, 3),
        "embeddingShape": list(torch_embeddings.shape),
        "throughput": round(len(image_paths) / torch_seconds, 2),
    }
    LOGGER.info(f"PyTorch: {torch_seconds:.3f}s, {results['torch']['msPerImage']:.1f}ms/image")

    # Free GPU memory
    del torch_model
    torch.cuda.empty_cache()

    # === Infinity Embedding ===
    LOGGER.info("=" * 60)
    LOGGER.info("Running Infinity Embedding Benchmark")
    LOGGER.info("=" * 60)

    infinity_engine = load_infinity_engine(args.model_path, args.device, args.batch_size)

    # Start engine
    import asyncio

    async def start_engine():
        await infinity_engine.astart()

    asyncio.get_event_loop().run_until_complete(start_engine())

    # Warmup
    for i in range(args.warmup):
        LOGGER.info(f"Infinity warmup {i + 1}/{args.warmup}")
        _warmup_emb, _ = encode_infinity(
            infinity_engine,
            image_paths[: args.batch_size],
            args.batch_size,
        )

    # Benchmark
    infinity_embeddings, infinity_seconds = encode_infinity(
        infinity_engine,
        image_paths,
        args.batch_size,
    )

    results["infinity"] = {
        "seconds": round(infinity_seconds, 6),
        "msPerImage": round((infinity_seconds / len(image_paths)) * 1000, 3),
        "embeddingShape": list(infinity_embeddings.shape),
        "throughput": round(len(image_paths) / infinity_seconds, 2),
    }
    LOGGER.info(f"Infinity: {infinity_seconds:.3f}s, {results['infinity']['msPerImage']:.1f}ms/image")

    # Stop engine
    async def stop_engine():
        await infinity_engine.astop()

    asyncio.get_event_loop().run_until_complete(stop_engine())

    # === Comparison ===
    LOGGER.info("=" * 60)
    LOGGER.info("Computing Comparison Metrics")
    LOGGER.info("=" * 60)

    # Ensure same shape
    min_len = min(len(torch_embeddings), len(infinity_embeddings))
    torch_emb = torch_embeddings[:min_len]
    inf_emb = infinity_embeddings[:min_len]

    cosine_sim = cosine_similarity_matrix(torch_emb, inf_emb)

    results["comparison"] = {
        "speedup": round(torch_seconds / infinity_seconds, 4) if infinity_seconds > 0 else None,
        "timeSavedPercent": round(
            ((torch_seconds - infinity_seconds) / torch_seconds) * 100, 2
        )
        if torch_seconds > 0
        else 0,
        "cosineSimilarity": {
            "mean": round(float(np.mean(cosine_sim)), 6),
            "min": round(float(np.min(cosine_sim)), 6),
            "max": round(float(np.max(cosine_sim)), 6),
            "std": round(float(np.std(cosine_sim)), 6),
        },
        "maxAbsDiff": round(float(np.max(np.abs(torch_emb - inf_emb))), 6),
        "meanAbsDiff": round(float(np.mean(np.abs(torch_emb - inf_emb))), 6),
    }

    LOGGER.info(f"Speedup: {results['comparison']['speedup']}x")
    LOGGER.info(f"Time saved: {results['comparison']['timeSavedPercent']}%")
    LOGGER.info(f"Cosine similarity (mean): {results['comparison']['cosineSimilarity']['mean']}")

    return results


def main() -> None:
    args = parse_args()
    args.dataset = Path(args.dataset)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    LOGGER.info(f"Starting benchmark: {args.dataset}")
    LOGGER.info(f"Model: {args.model_path}")
    LOGGER.info(f"Device: {args.device}, Batch size: {args.batch_size}")

    results = run_benchmark(args)

    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = args.output_dir / f"infinity_vs_torch_{timestamp}.json"
    output_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    LOGGER.info(f"Results saved to {output_path}")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
