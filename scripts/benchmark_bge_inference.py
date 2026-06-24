from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import torch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import backend.dataset_service as dataset_service


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark BGE-VL-large image inference on a dataset ZIP.")
    parser.add_argument(
        "--dataset",
        type=Path,
        default=os.environ.get(
            "SAMPLE_ZIP_PATH",
            "E:\\zzq\\误报\\2025-04-01\\sample_split_80_10_10.zip" if os.name == "nt"
            else "/home/shao/zzq/误报/2025-04-01/sample_split_80_10_10.zip",
        ),
    )
    parser.add_argument("--device", default="cuda:0", help="BGE device, for example cuda:0 or cpu.")
    parser.add_argument("--batches", default="1,4,8,16", help="Comma separated BGE batch sizes to test.")
    parser.add_argument("--output-dir", type=Path, default=Path("logs"), help="Directory for benchmark JSON logs.")
    return parser.parse_args()


def configure_runtime(device: str, batch_size: int) -> None:
    dataset_service.BGE_DEVICE = device
    dataset_service.BGE_BATCH_SIZE = batch_size
    dataset_service.BGE_IMAGE_INFERENCE_STATS = None
    dataset_service.SEMANTIC_CONFIG = {"provider": "bge", "gptVision": {}}
    dataset_service.SEMANTIC_TEXT_EMBEDDINGS = None


def make_absolute_image(payload: dict[str, Any], store_root: Path, dataset_id: str, dataset_dir_name: str) -> dict[str, Any]:
    image = dict(payload["images"][0])
    relative_path = parse_qs(urlparse(image["filepath"]).query).get("path", [""])[0]
    image["_absolutePath"] = str((store_root / dataset_id / "extracted" / dataset_dir_name / relative_path).resolve())
    return image


def warmup_model(dataset_zip: Path, device: str) -> dict[str, Any]:
    configure_runtime(device, 1)
    store_root = Path(tempfile.mkdtemp(prefix="bge_speed_warmup_"))
    service = dataset_service.DatasetService(store_root=store_root, enable_bge=True)
    payload, _dataset_root = service.create_dataset_without_embedding(
        dataset_zip,
        dataset_id="warmup",
        display_name="warmup",
        make_current=False,
        content_hash="warmup",
    )
    image = make_absolute_image(payload, store_root, "warmup", dataset_zip.stem)

    dataset_service.get_bge_model()
    started_at = time.perf_counter()
    vectors = dataset_service.encode_images_with_bge([image])
    elapsed = time.perf_counter() - started_at
    return {
        "seconds": round(elapsed, 6),
        "dimensions": len(vectors[0]) if vectors else 0,
    }


def run_batch(dataset_zip: Path, device: str, batch_size: int) -> dict[str, Any]:
    configure_runtime(device, batch_size)
    store_root = Path(tempfile.mkdtemp(prefix=f"bge_speed_batch_{batch_size}_"))
    service = dataset_service.DatasetService(store_root=store_root, enable_bge=True)

    wall_started_at = time.perf_counter()
    payload = service.create_dataset_from_zip(
        dataset_zip,
        dataset_id=f"bge-speed-batch-{batch_size}",
        display_name=dataset_zip.stem,
        make_current=False,
    )
    wall_seconds = time.perf_counter() - wall_started_at
    performance = payload["embedding"].get("performance", {})
    return {
        "batchSize": batch_size,
        "status": payload["embedding"]["status"],
        "dimensions": payload["embedding"]["dimensions"],
        "imageCount": payload["info"]["imageCount"],
        "wallSeconds": round(wall_seconds, 6),
        **performance,
    }


def main() -> None:
    args = parse_args()
    batches = [int(value.strip()) for value in args.batches.split(",") if value.strip()]
    args.dataset = Path(args.dataset)
    if not args.dataset.exists():
        raise FileNotFoundError(args.dataset)

    print(f"dataset={args.dataset}", flush=True)
    print(f"modelPath={dataset_service.BGE_MODEL_PATH}", flush=True)
    print(f"torchCudaAvailable={torch.cuda.is_available()} deviceCount={torch.cuda.device_count()}", flush=True)
    print(f"device={args.device}", flush=True)

    warmup = warmup_model(args.dataset, args.device)
    print(f"warmup={json.dumps(warmup, ensure_ascii=False)}", flush=True)

    results = []
    for batch_size in batches:
        result = run_batch(args.dataset, args.device, batch_size)
        results.append(result)
        print(f"result={json.dumps(result, ensure_ascii=False)}", flush=True)

    output = {
        "createdAt": datetime.now().isoformat(),
        "dataset": str(args.dataset),
        "modelPath": str(dataset_service.BGE_MODEL_PATH),
        "device": args.device,
        "warmup": warmup,
        "results": results,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output_dir / f"bge_inference_speed_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"logPath={output_path.resolve()}", flush=True)


if __name__ == "__main__":
    main()
