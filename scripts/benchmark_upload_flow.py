"""Benchmark the upload flow to find time bottlenecks."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ZIP_PATH = Path(r"E:\zzq\训练集\vehicle-13631-v18-cls9_split_80_10_10_sample1000.zip")


def main():
    import backend.dataset_service as ds
    from backend.milvus_store import MilvusStore
    import tempfile

    # Use temp Milvus to avoid polluting production
    db = tempfile.mktemp(suffix=".db")
    store = MilvusStore(db)
    ds.set_milvus_store_override(store)

    import shutil
    tmpdir = Path(tempfile.mkdtemp())
    service = ds.DatasetService(store_root=tmpdir, enable_bge=True, milvus_store=store)

    content = ZIP_PATH.read_bytes()
    print(f"ZIP size: {len(content) / 1024 / 1024:.1f} MB")
    print(f"Images: 1000\n")

    # Step 1: Save upload
    t0 = time.perf_counter()
    upload_path = tmpdir / "_incoming" / "test.zip"
    upload_path.parent.mkdir(parents=True, exist_ok=True)
    upload_path.write_bytes(content)
    t_save = time.perf_counter() - t0
    print(f"[1] Save ZIP to disk:    {t_save:.2f}s")

    # Step 2: Extract ZIP
    t0 = time.perf_counter()
    extract_dir = tmpdir / "test" / "extracted"
    extract_dir.mkdir(parents=True, exist_ok=True)
    service._safe_extract_zip(upload_path, extract_dir)
    t_extract = time.perf_counter() - t0
    print(f"[2] Extract ZIP:         {t_extract:.2f}s")

    # Step 3: Parse dataset (images, annotations, labels)
    t0 = time.perf_counter()
    data_root = ds.find_dataset_root(extract_dir)
    payload = service.analyze_dataset_directory(
        data_root,
        dataset_id="bench",
        display_name="bench",
        include_embedding=False,
    )
    t_parse = time.perf_counter() - t0
    print(f"[3] Parse dataset:       {t_parse:.2f}s  ({len(payload['images'])} images)")

    # Step 4: Write to Milvus (metadata)
    t0 = time.perf_counter()
    service._write_dataset("bench", payload)
    t_write_milvus = time.perf_counter() - t0
    print(f"[4] Write Milvus meta:   {t_write_milvus:.2f}s")

    # Step 5: Generate embeddings
    images = ds.add_absolute_paths(payload["images"], data_root)
    t0 = time.perf_counter()
    embeddings = ds.get_cached_or_encode_image_embeddings(images, tmpdir)
    t_embed = time.perf_counter() - t0
    stats = ds.BGE_IMAGE_INFERENCE_STATS or {}
    print(f"[5] Generate embeddings: {t_embed:.2f}s  "
          f"(encoded={stats.get('encodedImages', 0)}, "
          f"cache_hits={stats.get('cacheHits', 0)}, "
          f"avg_ms={stats.get('averageInferenceMsPerImage', 0):.1f}ms/img)")

    # Step 6: Persist embeddings to Milvus
    t0 = time.perf_counter()
    ds.persist_dataset_embeddings(tmpdir, "bench", images, embeddings)
    t_persist = time.perf_counter() - t0
    print(f"[6] Persist embeddings:  {t_persist:.2f}s")

    # Step 7: Semantic classification
    t0 = time.perf_counter()
    ds.apply_semantic_classification(images, embeddings)
    t_semantic = time.perf_counter() - t0
    print(f"[7] Semantic classify:   {t_semantic:.2f}s")

    # Step 8: PCA projection
    t0 = time.perf_counter()
    projected = ds.project_to_2d(embeddings)
    t_pca = time.perf_counter() - t0
    print(f"[8] PCA 2D projection:   {t_pca:.2f}s")

    # Step 9: Text embedding (for semantic)
    t0 = time.perf_counter()
    ds.get_semantic_text_embeddings()
    t_text = time.perf_counter() - t0
    print(f"[9] Text embeddings:     {t_text:.2f}s  (one-time)")

    # Summary
    total = t_save + t_extract + t_parse + t_write_milvus + t_embed + t_persist + t_semantic + t_pca + t_text
    print(f"\n{'='*50}")
    print(f"Total: {total:.2f}s\n")

    steps = [
        ("Save ZIP", t_save),
        ("Extract ZIP", t_extract),
        ("Parse dataset", t_parse),
        ("Write Milvus meta", t_write_milvus),
        ("Generate embeddings", t_embed),
        ("Persist embeddings", t_persist),
        ("Semantic classify", t_semantic),
        ("PCA projection", t_pca),
        ("Text embeddings", t_text),
    ]
    steps.sort(key=lambda x: x[1], reverse=True)
    print("Bottleneck ranking:")
    for name, t in steps:
        pct = t / total * 100
        bar = "█" * int(pct / 2)
        print(f"  {name:<20} {t:>6.2f}s  {pct:>5.1f}%  {bar}")

    # Cleanup
    ds.set_milvus_store_override(None)
    store.close()
    shutil.rmtree(tmpdir, ignore_errors=True)
    for suffix in ("", "-shm", "-wal"):
        try:
            os.remove(db + suffix)
        except OSError:
            pass


if __name__ == "__main__":
    main()
