"""Milvus-backed storage for dataset images and embeddings.

Replaces JSON file storage and .npy embedding cache with a unified
Milvus Lite vector database.  Two collections:

- ``datasets`` — dataset-level metadata (one row per dataset)
- ``images``   — per-image info + embedding vector
- ``embedding_cache`` — cross-dataset embedding cache keyed by file hash
"""
from __future__ import annotations

import json
import logging
import threading
from typing import Any

from pymilvus import (
    Collection,
    CollectionSchema,
    DataType,
    FieldSchema,
    MilvusClient,
)
from pymilvus.milvus_client.index import IndexParams

LOGGER = logging.getLogger(__name__)

# Suppress known milvus-lite gRPC noise (AllocTimestamp not implemented)
logging.getLogger("grpc._server").setLevel(logging.CRITICAL)

# Embedding dimension for BGE-VL-large
EMBEDDING_DIM = 768


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _json_loads(text: str | None) -> Any:
    if not text:
        return None
    return json.loads(text)


def _pad_vector(vec: list[float], dim: int = EMBEDDING_DIM) -> list[float]:
    """Pad or truncate a vector to the target dimension."""
    if len(vec) >= dim:
        return [float(v) for v in vec[:dim]]
    return [float(v) for v in vec] + [0.0] * (dim - len(vec))


class MilvusStore:
    """Thread-safe Milvus Lite store for dataset images and embeddings."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._client: MilvusClient | None = None
        self._lock = threading.Lock()
        self._ensure_collections()

    # ------------------------------------------------------------------
    # Client lifecycle
    # ------------------------------------------------------------------

    def _get_client(self) -> MilvusClient:
        if self._client is None:
            with self._lock:
                if self._client is None:
                    self._client = MilvusClient(uri=self._db_path)
                    LOGGER.info("Milvus Lite connected: %s", self._db_path)
        return self._client

    def _ensure_collections(self) -> None:
        client = self._get_client()
        existing = client.list_collections()

        if "datasets" not in existing:
            schema = CollectionSchema(fields=[
                FieldSchema("dataset_id", DataType.VARCHAR, is_primary=True, max_length=200),
                FieldSchema("name", DataType.VARCHAR, max_length=500),
                FieldSchema("description", DataType.VARCHAR, max_length=2000),
                FieldSchema("source_archive", DataType.VARCHAR, max_length=1000),
                FieldSchema("source_root", DataType.VARCHAR, max_length=1000),
                FieldSchema("semantic_schema_version", DataType.VARCHAR, max_length=200),
                FieldSchema("semantic_provider", DataType.VARCHAR, max_length=100),
                FieldSchema("embedding_model", DataType.VARCHAR, max_length=200),
                FieldSchema("embedding_status", DataType.VARCHAR, max_length=50),
                FieldSchema("embedding_method", DataType.VARCHAR, max_length=500),
                FieldSchema("embedding_dimensions", DataType.INT64),
                FieldSchema("embedding_generated_at", DataType.VARCHAR, max_length=100),
                FieldSchema("embedding_message", DataType.VARCHAR, max_length=2000),
                FieldSchema("embedding_performance", DataType.VARCHAR, max_length=5000),
                FieldSchema("category_counts", DataType.VARCHAR, max_length=10000),
                FieldSchema("split_counts", DataType.VARCHAR, max_length=1000),
                FieldSchema("categories", DataType.VARCHAR, max_length=10000),
                FieldSchema("created_at", DataType.INT64),
                FieldSchema("placeholder_vector", DataType.FLOAT_VECTOR, dim=2),
            ], description="Dataset-level metadata")
            client.create_collection(collection_name="datasets", schema=schema)
            LOGGER.info("Created Milvus collection: datasets")

        if "images" not in existing:
            schema = CollectionSchema(fields=[
                FieldSchema("id", DataType.VARCHAR, is_primary=True, max_length=300),
                FieldSchema("dataset_id", DataType.VARCHAR, max_length=200),
                FieldSchema("file_hash", DataType.VARCHAR, max_length=100, nullable=True),
                FieldSchema("filename", DataType.VARCHAR, max_length=500, nullable=True),
                FieldSchema("filepath", DataType.VARCHAR, max_length=2000, nullable=True),
                FieldSchema("width", DataType.INT64, nullable=True),
                FieldSchema("height", DataType.INT64, nullable=True),
                FieldSchema("split", DataType.VARCHAR, max_length=50, nullable=True),
                FieldSchema("primary_label", DataType.VARCHAR, max_length=200, nullable=True),
                FieldSchema("detections", DataType.VARCHAR, max_length=50000, nullable=True),
                FieldSchema("metadata_json", DataType.VARCHAR, max_length=20000, nullable=True),
                FieldSchema("embedding", DataType.FLOAT_VECTOR, dim=EMBEDDING_DIM),
                FieldSchema("embedding_2d", DataType.FLOAT_VECTOR, dim=2),
            ], description="Per-image info with embedding")
            client.create_collection(collection_name="images", schema=schema)
            # Create vector index for similarity search
            index_params = IndexParams()
            index_params.add_index("embedding", index_type="FLAT", metric_type="L2")
            client.create_index("images", index_params)
            LOGGER.info("Created Milvus collection: images")

        if "embedding_cache" not in existing:
            schema = CollectionSchema(fields=[
                FieldSchema("file_hash", DataType.VARCHAR, is_primary=True, max_length=100),
                FieldSchema("embedding", DataType.FLOAT_VECTOR, dim=EMBEDDING_DIM),
            ], description="Cross-dataset embedding cache keyed by file hash")
            client.create_collection(collection_name="embedding_cache", schema=schema)
            LOGGER.info("Created Milvus collection: embedding_cache")

        # Load all collections into memory for querying
        for name in ("datasets", "images", "embedding_cache"):
            try:
                client.load_collection(name)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Dataset operations
    # ------------------------------------------------------------------

    def save_dataset(self, dataset_id: str, payload: dict[str, Any]) -> None:
        """Save a full dataset payload (info + source + embedding meta)."""
        client = self._get_client()
        info = payload.get("info", {})
        source = payload.get("source", {})
        emb = payload.get("embedding", {})

        row = {
            "dataset_id": dataset_id,
            "name": info.get("name", ""),
            "description": info.get("description", ""),
            "source_archive": str(source.get("archive") or ""),
            "source_root": str(source.get("root") or ""),
            "semantic_schema_version": source.get("semanticSchemaVersion", ""),
            "semantic_provider": source.get("semanticProvider", ""),
            "embedding_model": emb.get("model", ""),
            "embedding_status": emb.get("status", "pending"),
            "embedding_method": emb.get("method", ""),
            "embedding_dimensions": int(emb.get("dimensions", 0)),
            "embedding_generated_at": emb.get("generatedAt", ""),
            "embedding_message": emb.get("message", ""),
            "embedding_performance": _json_dumps(emb.get("performance", {})),
            "category_counts": _json_dumps(payload.get("categoryCounts", {})),
            "split_counts": _json_dumps(info.get("splits", {})),
            "categories": _json_dumps(payload.get("categories", [])),
            "created_at": int(__import__("time").time()),
            "placeholder_vector": [0.0, 0.0],
        }
        # Upsert: delete then insert
        client.delete("datasets", ids=[dataset_id])
        client.insert("datasets", [row])
        client.load_collection("datasets")
        LOGGER.debug("Saved dataset %s to Milvus", dataset_id)

    def load_dataset(self, dataset_id: str) -> dict[str, Any] | None:
        """Load a dataset payload. Returns None if not found."""
        client = self._get_client()
        results = client.get("datasets", ids=[dataset_id])
        if not results:
            return None
        row = results[0]

        # Reconstruct the payload dict matching the old JSON structure
        payload: dict[str, Any] = {
            "info": {
                "id": dataset_id,
                "name": row.get("name", ""),
                "description": row.get("description", ""),
                "imageCount": 0,  # filled below
                "annotationCount": 0,  # filled below
                "categories": _json_loads(row.get("categories")) or [],
                "splits": _json_loads(row.get("split_counts")) or {},
            },
            "images": [],  # loaded separately
            "categories": _json_loads(row.get("categories")) or [],
            "categoryCounts": _json_loads(row.get("category_counts")) or {},
            "embedding": {
                "model": row.get("embedding_model", ""),
                "modelPath": "",
                "status": row.get("embedding_status", "pending"),
                "method": row.get("embedding_method", ""),
                "dimensions": row.get("embedding_dimensions", 0),
                "generatedAt": row.get("embedding_generated_at", ""),
                "message": row.get("embedding_message", ""),
                "performance": _json_loads(row.get("embedding_performance")) or {},
            },
            "source": {
                "archive": row.get("source_archive") or None,
                "root": row.get("source_root") or "",
                "semanticSchemaVersion": row.get("semantic_schema_version", ""),
                "semanticProvider": row.get("semantic_provider", ""),
            },
        }
        return payload

    def delete_dataset(self, dataset_id: str) -> None:
        """Delete a dataset and all its images."""
        client = self._get_client()
        # Delete images for this dataset
        client.delete("images", filter=f'dataset_id == "{dataset_id}"')
        # Delete dataset record
        client.delete("datasets", ids=[dataset_id])
        LOGGER.info("Deleted dataset %s from Milvus", dataset_id)

    # ------------------------------------------------------------------
    # Image operations
    # ------------------------------------------------------------------

    def save_images(
        self,
        dataset_id: str,
        images: list[dict[str, Any]],
        embeddings: list[list[float]] | None = None,
        embeddings_2d: list[list[float]] | None = None,
        file_hashes: dict[str, str] | None = None,
    ) -> None:
        """Save images for a dataset. Optionally include embeddings."""
        client = self._get_client()
        rows = []
        for i, img in enumerate(images):
            img_id = img.get("id", "")
            row: dict[str, Any] = {
                "id": f"{dataset_id}::{img_id}",
                "dataset_id": dataset_id,
                "file_hash": (file_hashes or {}).get(img_id, ""),
                "filename": img.get("filename", ""),
                "filepath": img.get("filepath", ""),
                "width": int(img.get("width", 0)),
                "height": int(img.get("height", 0)),
                "split": img.get("split", ""),
                "primary_label": _get_primary_label(img),
                "detections": _json_dumps(img.get("detections", [])),
                "metadata_json": _json_dumps(img.get("metadata", {})),
                "embedding": _pad_vector(embeddings[i]) if embeddings and i < len(embeddings)
                             else [0.0] * EMBEDDING_DIM,
                "embedding_2d": (embeddings_2d[i] if embeddings_2d and i < len(embeddings_2d)
                                 else img.get("embedding2d", [0.0, 0.0])),
            }
            rows.append(row)
        if rows:
            # Delete existing images for this dataset first
            client.delete("images", filter=f'dataset_id == "{dataset_id}"')
            client.insert("images", rows)
            client.load_collection("images")
            LOGGER.debug("Saved %d images for dataset %s", len(rows), dataset_id)

    def load_images(self, dataset_id: str) -> list[dict[str, Any]]:
        """Load all images for a dataset, returning frontend-compatible dicts."""
        client = self._get_client()
        results = client.query(
            "images",
            filter=f'dataset_id == "{dataset_id}"',
            output_fields=["id", "filename", "filepath", "width", "height",
                           "split", "primary_label", "detections", "metadata_json",
                           "embedding_2d"],
        )
        images = []
        for row in results:
            img: dict[str, Any] = {
                "id": row["id"].split("::", 1)[1] if "::" in row["id"] else row["id"],
                "filepath": row.get("filepath", ""),
                "filename": row.get("filename", ""),
                "width": row.get("width", 0),
                "height": row.get("height", 0),
                "split": row.get("split", ""),
                "detections": _json_loads(row.get("detections")) or [],
                "embedding2d": list(row.get("embedding_2d", [0.0, 0.0])),
                "metadata": _json_loads(row.get("metadata_json")) or {},
            }
            images.append(img)
        return images

    def update_embeddings(
        self,
        dataset_id: str,
        image_ids: list[str],
        embeddings: list[list[float]],
        embeddings_2d: list[list[float]],
    ) -> None:
        """Update embedding vectors for specific images."""
        client = self._get_client()
        for img_id, emb, emb2d in zip(image_ids, embeddings, embeddings_2d):
            full_id = f"{dataset_id}::{img_id}"
            client.upsert("images", [{
                "id": full_id,
                "dataset_id": dataset_id,
                "embedding": _pad_vector(emb),
                "embedding_2d": [float(v) for v in emb2d],
            }])
        client.load_collection("images")
        LOGGER.debug("Updated embeddings for %d images in %s", len(image_ids), dataset_id)

    # ------------------------------------------------------------------
    # Embedding cache (cross-dataset, keyed by file hash)
    # ------------------------------------------------------------------

    def get_cached_embedding(self, file_hash: str) -> list[float] | None:
        client = self._get_client()
        results = client.get("embedding_cache", ids=[file_hash])
        if not results:
            return None
        return list(results[0].get("embedding", []))

    def cache_embedding(self, file_hash: str, embedding: list[float]) -> None:
        client = self._get_client()
        client.upsert("embedding_cache", [{
            "file_hash": file_hash,
            "embedding": _pad_vector(embedding),
        }])
        client.load_collection("embedding_cache")

    def batch_get_cached_embeddings(self, file_hashes: list[str]) -> dict[str, list[float]]:
        """Batch lookup embeddings by file hash. Returns {hash: vector}."""
        if not file_hashes:
            return {}
        client = self._get_client()
        results = client.query(
            "embedding_cache",
            filter=f"file_hash in {file_hashes}",
            output_fields=["file_hash", "embedding"],
        )
        return {row["file_hash"]: list(row["embedding"]) for row in results}

    def batch_cache_embeddings(self, items: dict[str, list[float]]) -> None:
        """Batch save embeddings to cache. {hash: vector}."""
        if not items:
            return
        client = self._get_client()
        rows = [{"file_hash": h, "embedding": _pad_vector(emb)} for h, emb in items.items()]
        client.upsert("embedding_cache", rows)
        client.load_collection("embedding_cache")

    # ------------------------------------------------------------------
    # Vector search (new capability)
    # ------------------------------------------------------------------

    def search_similar(
        self,
        dataset_id: str,
        query_vector: list[float],
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Search for similar images by embedding vector."""
        client = self._get_client()
        results = client.search(
            "images",
            data=[query_vector],
            filter=f'dataset_id == "{dataset_id}"',
            limit=top_k,
            output_fields=["id", "filename", "filepath", "split", "primary_label",
                           "detections", "metadata_json", "embedding_2d"],
        )
        hits = []
        for hit in results[0]:
            row = hit.get("entity", {})
            img_id = row.get("id", "")
            hits.append({
                "id": img_id.split("::", 1)[1] if "::" in img_id else img_id,
                "distance": hit.get("distance", 0.0),
                "filepath": row.get("filepath", ""),
                "filename": row.get("filename", ""),
                "split": row.get("split", ""),
                "primary_label": row.get("primary_label", ""),
                "embedding2d": list(row.get("embedding_2d", [0.0, 0.0])),
                "metadata": _json_loads(row.get("metadata_json")) or {},
            })
        return hits

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None


def _get_primary_label(image: dict[str, Any]) -> str:
    detections = image.get("detections", [])
    return detections[0]["label"] if detections else "unknown"
