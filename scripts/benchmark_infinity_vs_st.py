"""Benchmark: Infinity batch_size=64/concurrency=4 vs batch_size=32/concurrency=1."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SAMPLE_ZIP = Path(os.environ.get(
    "SAMPLE_ZIP_PATH",
    r"E:\zzq\训练集\vehicle-13631-v18-cls9_split_80_10_10_sample1000.zip",
))


def extract_images(zip_path: Path, max_count: int = 100) -> tuple[list[dict], Path]:
    tmpdir = Path(tempfile.mkdtemp())
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(tmpdir)
    images = []
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
        for p in sorted(tmpdir.rglob(f"*{ext}")):
            images.append({"_absolutePath": str(p)})
            if len(images) >= max_count:
                break
        if len(images) >= max_count:
            break
    return images, tmpdir


def run_bench(images: list[dict], batch_size: int, concurrency: int, runs: int = 1):
    """Start a fresh Infinity engine and benchmark."""
    # Reset engine globals so a new one is created with new settings
    import backend.dataset_service as ds
    ds.INFINITY_ENGINE = None
    ds.INFINITY_ENGINE_LOOP = None

    # Override settings
    from config import dataset_settings
    object.__setattr__(dataset_settings.BGE_SETTINGS, "infinity_batch_size", batch_size)
    object.__setattr__(dataset_settings.BGE_SETTINGS, "infinity_concurrency", concurrency)
    object.__setattr__(dataset_settings.BGE_SETTINGS, "use_infinity", True)

    # Warmup
    print(f"  Loading engine (batch_size={batch_size}, concurrency={concurrency})...")
    ds.get_infinity_engine()

    times = []
    for i in range(runs):
        t0 = time.perf_counter()
        result = ds.encode_images_with_bge(images)
        elapsed = time.perf_counter() - t0
        times.append(elapsed)
        print(f"    Run {i+1}: {elapsed:.3f}s  (dim={len(result[0])})")

    avg = sum(times) / len(times)
    return avg, result


def main():
    n_images = 1000
    runs = 1

    print(f"Extracting images from {SAMPLE_ZIP.name}...")
    images, tmpdir = extract_images(SAMPLE_ZIP, n_images)
    print(f"  Found {len(images)} images\n")

    try:
        print(f"Benchmark: {len(images)} images × {runs} runs each\n")

        # Config A: batch=32, concurrency=1 (baseline)
        print("[A] batch_size=32, concurrency=1")
        avg_a, _ = run_bench(images, batch_size=32, concurrency=1, runs=runs)
        print(f"  Average: {avg_a:.3f}s\n")

        # Config B: batch=64, concurrency=4
        print("[B] batch_size=64, concurrency=4")
        avg_b, _ = run_bench(images, batch_size=64, concurrency=4, runs=runs)
        print(f"  Average: {avg_b:.3f}s\n")

        print("=" * 50)
        print(f"[A] batch=32, conc=1:  {avg_a:.3f}s")
        print(f"[B] batch=64, conc=4:  {avg_b:.3f}s")
        if avg_b > 0:
            speedup = avg_a / avg_b
            print(f"Speedup: {speedup:.2f}x")

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
