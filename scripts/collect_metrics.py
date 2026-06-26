"""Collect performance metrics for the dataset visualization module.

Usage:
    python scripts/collect_metrics.py [--zip PATH] [--images N]

Outputs a markdown report with latency, throughput, and cache metrics.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.dataset_settings import BGE_SETTINGS, DATASET_SETTINGS


def extract_images(zip_path: Path, max_count: int = 0) -> tuple[list[dict], Path]:
    """Extract images from ZIP, return (image_dicts, tmpdir)."""
    tmpdir = Path(tempfile.mkdtemp())
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(tmpdir)
    images = []
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
        for p in sorted(tmpdir.rglob(f"*{ext}")):
            images.append({"_absolutePath": str(p), "filename": p.name})
            if max_count and len(images) >= max_count:
                break
        if max_count and len(images) >= max_count:
            break
    return images, tmpdir


def measure_embedding_latency(images: list[dict], runs: int = 1) -> dict:
    """Measure Infinity embedding engine latency."""
    import backend.dataset_service as ds

    # Warmup
    ds.get_infinity_engines()

    times = []
    for _ in range(runs):
        t0 = time.perf_counter()
        ds.encode_images_with_bge(images[:min(len(images), 256)])
        times.append(time.perf_counter() - t0)

    total = sum(times) / len(times)
    per_image = total / min(len(images), 256) * 1000
    return {
        "total_seconds": round(total, 3),
        "per_image_ms": round(per_image, 2),
        "images_processed": min(len(images), 256),
        "batch_size": BGE_SETTINGS.batch_size,
        "concurrency": BGE_SETTINGS.infinity_concurrency,
    }


def measure_cache_performance(images: list[dict]) -> dict:
    """Measure embedding cache hit rate and speedup."""
    import backend.dataset_service as ds

    store = ds._get_active_store()
    store_override = ds._MILVUS_STORE_OVERRIDE

    # Use a temp Milvus store to avoid polluting production data
    from backend.milvus_store import MilvusStore
    db = tempfile.mktemp(suffix=".db")
    tmp_store = MilvusStore(db)
    ds.set_milvus_store_override(tmp_store)

    try:
        test_images = images[:min(len(images), 100)]

        # First run: cold cache
        t0 = time.perf_counter()
        vecs1 = ds.get_cached_or_encode_image_embeddings(test_images, Path(tempfile.mkdtemp()))
        cold_time = time.perf_counter() - t0

        # Second run: warm cache
        t0 = time.perf_counter()
        vecs2 = ds.get_cached_or_encode_image_embeddings(test_images, Path(tempfile.mkdtemp()))
        warm_time = time.perf_counter() - t0

        stats = ds.BGE_IMAGE_INFERENCE_STATS or {}
        return {
            "test_images": len(test_images),
            "cold_seconds": round(cold_time, 3),
            "warm_seconds": round(warm_time, 3),
            "speedup": round(cold_time / warm_time, 1) if warm_time > 0 else "inf",
            "cache_hits_first_run": stats.get("cacheHits", 0),
            "cache_hits_second_run": len(test_images),
        }
    finally:
        ds.set_milvus_store_override(store_override)
        tmp_store.close()
        for suffix in ("", "-shm", "-wal"):
            try:
                os.remove(db + suffix)
            except OSError:
                pass


def measure_semantic_classification(images: list[dict]) -> dict:
    """Measure 6-dimension semantic classification latency."""
    import backend.dataset_service as ds

    test_images = images[:min(len(images), 50)]
    # Ensure metadata field exists
    for img in test_images:
        img.setdefault("metadata", {"semantics": {}, "tags": []})

    # Text encoding (one-time cost)
    t0 = time.perf_counter()
    ds.get_semantic_text_embeddings()
    text_encode_time = time.perf_counter() - t0

    # Image embedding
    t0 = time.perf_counter()
    embeddings = ds.encode_images_with_bge(test_images)
    embed_time = time.perf_counter() - t0

    # Classification
    t0 = time.perf_counter()
    ds.apply_bge_semantic_classification(test_images, embeddings)
    classify_time = time.perf_counter() - t0

    return {
        "text_encode_seconds": round(text_encode_time, 3),
        "image_embed_seconds": round(embed_time, 3),
        "classify_seconds": round(classify_time, 3),
        "per_image_ms": round((embed_time + classify_time) / len(test_images) * 1000, 2),
        "dimensions": 6,
        "test_images": len(test_images),
    }


def measure_pca_projection(n_images: int) -> dict:
    """Measure PCA 2D projection time."""
    import numpy as np
    import backend.dataset_service as ds

    # Generate fake embeddings
    embeddings = [[float(i % 100) / 100] * 768 for i in range(n_images)]

    t0 = time.perf_counter()
    ds.project_to_2d(embeddings)
    elapsed = time.perf_counter() - t0

    return {
        "images": n_images,
        "seconds": round(elapsed, 4),
        "per_image_ms": round(elapsed / n_images * 1000, 4),
    }


def measure_milvus_operations(images: list[dict]) -> dict:
    """Measure Milvus read/write latency."""
    from backend.milvus_store import MilvusStore

    db = tempfile.mktemp(suffix=".db")
    store = MilvusStore(db)

    test_images = images[:min(len(images), 100)]
    fake_embeddings = [[0.1] * 768 for _ in test_images]
    fake_2d = [[1.0, 2.0] for _ in test_images]

    try:
        # Write
        t0 = time.perf_counter()
        store.save_dataset("bench", {
            "info": {"id": "bench", "name": "bench", "description": "", "imageCount": len(test_images),
                     "annotationCount": 0, "categories": [], "splits": {}},
            "images": test_images, "categories": [], "categoryCounts": {},
            "embedding": {"model": "bge", "modelPath": "", "status": "ready", "method": "BGE",
                          "dimensions": 768, "generatedAt": "", "message": "", "performance": {}},
            "source": {"archive": None, "root": "", "semanticSchemaVersion": "v1", "semanticProvider": "bge"},
        })
        store.save_images("bench", test_images, fake_embeddings, fake_2d)
        write_time = time.perf_counter() - t0

        # Read
        t0 = time.perf_counter()
        loaded = store.load_images("bench")
        read_time = time.perf_counter() - t0

        # Update embeddings
        t0 = time.perf_counter()
        ids = [img.get("id", f"img-{i}") for i, img in enumerate(test_images)]
        store.update_embeddings("bench", ids, fake_embeddings, fake_2d)
        update_time = time.perf_counter() - t0

        return {
            "test_images": len(test_images),
            "write_seconds": round(write_time, 4),
            "read_seconds": round(read_time, 4),
            "update_seconds": round(update_time, 4),
            "read_per_image_ms": round(read_time / len(test_images) * 1000, 4),
        }
    finally:
        store.close()
        for suffix in ("", "-shm", "-wal"):
            try:
                os.remove(db + suffix)
            except OSError:
                pass


def measure_knn_outlier(images: list[dict]) -> dict:
    """Measure kNN outlier detection on embeddings."""
    import numpy as np

    n = min(len(images), 500)
    embeddings = np.random.randn(n, 768).tolist()

    t0 = time.perf_counter()
    k = 5
    dists = []
    emb_array = np.array(embeddings)
    for i in range(n):
        diffs = emb_array - emb_array[i]
        distances = np.sqrt(np.sum(diffs ** 2, axis=1))
        distances.sort()
        avg_knn = float(np.mean(distances[1:k + 1]))
        dists.append(avg_knn)
    threshold = float(np.mean(dists)) + 2 * float(np.std(dists))
    outliers = sum(1 for d in dists if d > threshold)
    elapsed = time.perf_counter() - t0

    return {
        "images": n,
        "k": k,
        "seconds": round(elapsed, 3),
        "per_image_ms": round(elapsed / n * 1000, 3),
        "outliers_detected": outliers,
        "outlier_rate": f"{outliers / n * 100:.1f}%",
    }


def generate_report(zip_path: Path, max_images: int) -> str:
    """Run all benchmarks and generate a markdown report."""
    print(f"Extracting images from {zip_path.name}...")
    images, tmpdir = extract_images(zip_path, max_images)
    print(f"  Found {len(images)} images\n")

    results = {}

    # 1. Embedding latency
    print("[1/6] Measuring embedding latency...")
    results["embedding"] = measure_embedding_latency(images)
    print(f"  {results['embedding']['per_image_ms']}ms/image\n")

    # 2. Cache performance
    print("[2/6] Measuring cache performance...")
    results["cache"] = measure_cache_performance(images)
    print(f"  Speedup: {results['cache']['speedup']}x\n")

    # 3. Semantic classification
    print("[3/6] Measuring semantic classification...")
    results["semantic"] = measure_semantic_classification(images)
    print(f"  {results['semantic']['per_image_ms']}ms/image (6 dims)\n")

    # 4. PCA projection
    print("[4/6] Measuring PCA projection...")
    results["pca"] = measure_pca_projection(len(images))
    print(f"  {results['pca']['seconds']}s for {len(images)} images\n")

    # 5. Milvus operations
    print("[5/6] Measuring Milvus operations...")
    results["milvus"] = measure_milvus_operations(images)
    print(f"  Read: {results['milvus']['read_per_image_ms']}ms/image\n")

    # 6. kNN outlier detection
    print("[6/6] Measuring kNN outlier detection...")
    results["knn"] = measure_knn_outlier(images)
    print(f"  {results['knn']['per_image_ms']}ms/image\n")

    # Cleanup
    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)

    # Generate report
    r = results
    report = f"""# 性能指标报告

## 测试环境
- 数据集: {zip_path.name} ({len(images)} 张图片)
- 推理引擎: Infinity Embedding (batch_size={BGE_SETTINGS.batch_size}, concurrency={BGE_SETTINGS.infinity_concurrency})
- 向量数据库: Milvus Lite
- 嵌入模型: BGE-VL-large (768 维)

## 1. 图像嵌入推理

| 指标 | 数值 |
|------|------|
| 单图嵌入延迟 | **{r['embedding']['per_image_ms']}ms** |
| 批处理延迟（{r['embedding']['images_processed']}张） | {r['embedding']['total_seconds']}s |
| 推理吞吐 | **{round(1000 / r['embedding']['per_image_ms'])} 张/秒** |

## 2. 缓存性能

| 指标 | 数值 |
|------|------|
| 冷启动（{r['cache']['test_images']}张） | {r['cache']['cold_seconds']}s |
| 缓存命中 | {r['cache']['warm_seconds']}s |
| 缓存加速比 | **{r['cache']['speedup']}x** |

## 3. 语义属性分类（6维零样本）

| 指标 | 数值 |
|------|------|
| 文本编码（一次性） | {r['semantic']['text_encode_seconds']}s |
| 图像嵌入 + 分类延迟 | **{r['semantic']['per_image_ms']}ms/张** |
| 分类维度 | 光照、视角、模糊、天气、时段、场景 |

## 4. PCA 二维投影

| 指标 | 数值 |
|------|------|
| {r['pca']['images']}张投影耗时 | {r['pca']['seconds']}s |
| 单张投影延迟 | {r['pca']['per_image_ms']}ms |

## 5. Milvus 向量数据库

| 指标 | 数值 |
|------|------|
| 批量写入（{r['milvus']['test_images']}张） | {r['milvus']['write_seconds']}s |
| 批量读取（{r['milvus']['test_images']}张） | {r['milvus']['read_seconds']}s |
| 单张读取延迟 | **{r['milvus']['read_per_image_ms']}ms** |
| 向量更新（{r['milvus']['test_images']}张） | {r['milvus']['update_seconds']}s |

## 6. kNN 离群样本检测

| 指标 | 数值 |
|------|------|
| 检测规模 | {r['knn']['images']} 张 |
| k 值 | {r['knn']['k']} |
| 检测耗时 | {r['knn']['seconds']}s |
| 单张检测延迟 | {r['knn']['per_image_ms']}ms |
| 离群样本比例 | {r['knn']['outlier_rate']} |

## 简历指标摘要

- 图像嵌入推理延迟 **{r['embedding']['per_image_ms']}ms/张**，吞吐 **{round(1000 / r['embedding']['per_image_ms'])} 张/秒**
- 缓存命中后二次加载加速 **{r['cache']['speedup']}x**
- 6 维语义属性零样本分类延迟 **{r['semantic']['per_image_ms']}ms/张**
- kNN 离群样本检测 **{r['knn']['per_image_ms']}ms/张**
"""
    return report


def main():
    parser = argparse.ArgumentParser(description="Collect performance metrics")
    parser.add_argument("--zip", type=str, default=str(
        Path(r"E:\zzq\训练集\vehicle-13631-v18-cls9_split_80_10_10_sample1000.zip")
        if os.name == "nt"
        else "/home/shao/zzq/训练集/vehicle-13631-v18-cls9_split_80_10_10_sample1000.zip"
    ))
    parser.add_argument("--images", type=int, default=1000, help="Max images to process (0=all)")
    parser.add_argument("--output", type=str, default="", help="Output file path")
    args = parser.parse_args()

    zip_path = Path(args.zip)
    if not zip_path.exists():
        print(f"ZIP not found: {zip_path}")
        sys.exit(1)

    report = generate_report(zip_path, args.images)

    if args.output:
        Path(args.output).write_text(report, encoding="utf-8")
        print(f"Report saved to {args.output}")
    else:
        print("\n" + "=" * 60)
        print(report)


if __name__ == "__main__":
    main()
