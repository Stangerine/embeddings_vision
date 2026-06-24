from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
import zipfile
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

import torch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import backend.dataset_service as dataset_service


class Timer:
    def __init__(self) -> None:
        self.timings: list[dict[str, Any]] = []

    @contextmanager
    def measure(self, name: str, **extra: Any) -> Iterator[None]:
        started_at = time.perf_counter()
        try:
            yield
        finally:
            seconds = time.perf_counter() - started_at
            self.timings.append({"stage": name, "seconds": round(seconds, 6), **extra})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Profile dataset upload/parse/embedding/PCA pipeline.")
    parser.add_argument(
        "--dataset",
        type=Path,
        default=os.environ.get(
            "SAMPLE_ZIP_PATH",
            "E:\\zzq\\误报\\2025-04-01\\sample_split_80_10_10.zip" if os.name == "nt"
            else "/home/shao/zzq/误报/2025-04-01/sample_split_80_10_10.zip",
        ),
    )
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--output-dir", type=Path, default=Path("logs"))
    parser.add_argument("--warmup", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args()


def configure_runtime(device: str, batch_size: int) -> None:
    dataset_service.BGE_DEVICE = device
    dataset_service.BGE_BATCH_SIZE = batch_size
    dataset_service.BGE_IMAGE_INFERENCE_STATS = None
    dataset_service.SEMANTIC_CONFIG = {"provider": "bge", "gptVision": {}}
    dataset_service.SEMANTIC_TEXT_EMBEDDINGS = None


def warmup_bge(dataset_zip: Path, device: str, batch_size: int) -> dict[str, Any]:
    configure_runtime(device, batch_size)
    store_root = Path(tempfile.mkdtemp(prefix="pipeline_profile_warmup_"))
    try:
        image_path = extract_first_image(dataset_zip, store_root)
        started_at = time.perf_counter()
        vectors = dataset_service.encode_images_with_bge([{"_absolutePath": str(image_path)}])
        seconds = time.perf_counter() - started_at
        return {
            "seconds": round(seconds, 6),
            "dimensions": len(vectors[0]) if vectors else 0,
        }
    finally:
        shutil.rmtree(store_root, ignore_errors=True)


def extract_first_image(dataset_zip: Path, output_root: Path) -> Path:
    with zipfile.ZipFile(dataset_zip) as archive:
        for member in archive.infolist():
            suffix = Path(member.filename).suffix.lower()
            if member.is_dir() or suffix not in dataset_service.IMAGE_EXTENSIONS:
                continue
            target = output_root / "warmup" / Path(member.filename).name
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, target.open("wb") as destination:
                shutil.copyfileobj(source, destination, length=1024 * 1024)
            return target
    raise FileNotFoundError(f"No image found in {dataset_zip}")


def profile_pipeline(dataset_zip: Path, device: str, batch_size: int) -> dict[str, Any]:
    configure_runtime(device, batch_size)
    timer = Timer()
    store_root = Path(tempfile.mkdtemp(prefix="pipeline_profile_"))
    service = dataset_service.DatasetService(store_root=store_root, enable_bge=True)
    dataset_id = f"profile-{int(time.time())}"
    dataset_root = store_root / dataset_id
    archive_dir = dataset_root / "archive"
    extract_dir = dataset_root / "extracted"
    archive_dir.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archive_dir / "dataset.zip"

    with timer.measure("upload_write_zip", bytes=dataset_zip.stat().st_size):
        shutil.copy2(dataset_zip, archive_path)

    with timer.measure("extract_zip"):
        service._safe_extract_zip(archive_path, extract_dir)

    with timer.measure("find_dataset_root"):
        data_root = dataset_service.find_dataset_root(extract_dir)

    with timer.measure("parse_images_annotations"):
        payload = service.analyze_dataset_directory(
            data_root,
            dataset_id=dataset_id,
            display_name=dataset_zip.stem,
            source_archive=archive_path,
            include_embedding=False,
        )

    with timer.measure("restore_absolute_paths"):
        images = dataset_service.add_absolute_paths(payload["images"], data_root)

    with timer.measure("bge_image_embedding", imageCount=len(images)):
        embeddings = dataset_service.get_cached_or_encode_image_embeddings(images, store_root)

    image_embedding_perf = dataset_service.BGE_IMAGE_INFERENCE_STATS or {}

    with timer.measure("persist_embedding_npy"):
        dataset_service.persist_dataset_embeddings(store_root, dataset_id, images, embeddings)

    with timer.measure("bge_semantic_text_embedding"):
        text_embeddings = dataset_service.get_semantic_text_embeddings()

    semantic_text_count = sum(len(candidates) for candidates in text_embeddings.values())

    with timer.measure("semantic_zero_shot_scoring"):
        dataset_service.apply_bge_semantic_classification(images, embeddings)

    with timer.measure("pca_projection"):
        projected = dataset_service.project_to_2d(embeddings)
        for image, point in zip(images, projected):
            image["embedding2d"] = [round(point[0], 4), round(point[1], 4)]

    with timer.measure("write_dataset_json"):
        for image in images:
            image.pop("_absolutePath", None)
        payload["images"] = images
        payload["embedding"] = dataset_service.build_embedding_info(
            {
                "status": "ready",
                "method": "BGE-VL-large image embeddings + PCA",
                "dimensions": str(len(embeddings[0]) if embeddings else 0),
                "message": "profile run",
                "performance": image_embedding_perf,
            }
        )
        service._write_dataset(dataset_id, payload)

    total_seconds = round(sum(item["seconds"] for item in timer.timings), 6)
    profile = {
        "dataset": str(dataset_zip),
        "device": device,
        "batchSize": batch_size,
        "imageCount": len(images),
        "semanticTextCount": semantic_text_count,
        "totalProfiledSeconds": total_seconds,
        "imageEmbeddingPerformance": image_embedding_perf,
        "timings": [
            {
                **item,
                "percent": round((item["seconds"] / total_seconds) * 100, 2) if total_seconds else 0.0,
            }
            for item in timer.timings
        ],
    }
    shutil.rmtree(store_root, ignore_errors=True)
    return profile


def main() -> None:
    args = parse_args()
    args.dataset = Path(args.dataset)
    if not args.dataset.exists():
        raise FileNotFoundError(args.dataset)

    print(f"dataset={args.dataset}", flush=True)
    print(f"modelPath={dataset_service.BGE_MODEL_PATH}", flush=True)
    print(f"torchCudaAvailable={torch.cuda.is_available()} deviceCount={torch.cuda.device_count()}", flush=True)
    print(f"device={args.device} batchSize={args.batch_size}", flush=True)

    warmup = warmup_bge(args.dataset, args.device, args.batch_size) if args.warmup else None
    if warmup is not None:
        print(f"warmup={json.dumps(warmup, ensure_ascii=False)}", flush=True)

    profile = profile_pipeline(args.dataset, args.device, args.batch_size)
    profile["createdAt"] = datetime.now().isoformat()
    profile["warmup"] = warmup
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output_dir / f"dataset_pipeline_profile_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    output_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")

    print("timings:", flush=True)
    for item in sorted(profile["timings"], key=lambda row: row["seconds"], reverse=True):
        print(f"- {item['stage']}: {item['seconds']}s ({item['percent']}%)", flush=True)
    print(f"totalProfiledSeconds={profile['totalProfiledSeconds']}", flush=True)
    print(f"logPath={output_path.resolve()}", flush=True)


if __name__ == "__main__":
    main()
