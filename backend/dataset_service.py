from __future__ import annotations

import asyncio
import hashlib
import base64
import io
import json
import logging
import math
import os
import re
import shutil
import sys
import threading
import time
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request as UrlRequest, urlopen
from xml.etree import ElementTree

import numpy as np
from PIL import Image

from config.dataset_settings import (
    BGE_SETTINGS,
    DATASET_SETTINGS,
    SEMANTIC_OPTIONS,
    SEMANTIC_PROMPTS,
    SEMANTIC_RUNTIME_SETTINGS,
)

try:
    from sklearn.decomposition import PCA
except Exception:  # pragma: no cover - sklearn is present in the target env
    PCA = None


LOGGER = logging.getLogger(__name__)
STORE_ROOT = DATASET_SETTINGS.store_root
BGE_MODEL_PATH = BGE_SETTINGS.model_path
BGE_BATCH_SIZE = BGE_SETTINGS.batch_size
BGE_EMBEDDING_CHUNK_SIZE = BGE_SETTINGS.embedding_chunk_size
BGE_DEVICE = BGE_SETTINGS.device
BGE_PRELOAD_ON_STARTUP = BGE_SETTINGS.preload_on_startup
SEMANTIC_CONFIG_PATH = SEMANTIC_RUNTIME_SETTINGS.config_path
IMAGE_EXTENSIONS = DATASET_SETTINGS.image_extensions
BGE_MODEL = None
BGE_MODEL_LOCK = threading.Lock()
INFINITY_ENGINE = None
INFINITY_ENGINE_LOOP = None
INFINITY_ENGINE_LOCK = threading.Lock()
SEMANTIC_TEXT_EMBEDDINGS = None
SEMANTIC_TEXT_EMBEDDINGS_LOCK = threading.Lock()
SEMANTIC_CONFIG = None
SEMANTIC_CONFIG_LOCK = threading.Lock()
BGE_IMAGE_INFERENCE_STATS: dict[str, Any] | None = None

SPLIT_NAMES = DATASET_SETTINGS.split_names
SEMANTIC_SCHEMA_VERSION = SEMANTIC_RUNTIME_SETTINGS.schema_version


@dataclass(frozen=True)
class SplitRoot:
    split: str
    path: Path


class DatasetService:
    def __init__(self, store_root: Path = STORE_ROOT, enable_bge: bool | None = None) -> None:
        self.store_root = store_root
        self.enable_bge = BGE_SETTINGS.enabled if enable_bge is None else enable_bge
        self.embedding_delay_seconds = 0.0
        self._job_lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self.store_root.mkdir(parents=True, exist_ok=True)

    def current_dataset(self) -> dict[str, Any]:
        payload = self._read_dataset("current")
        if payload is not None:
            return payload
        payload = self._read_latest_cached_dataset()
        if payload is not None:
            self._write_dataset("current", payload)
            return payload
        raise FileNotFoundError("未加载任何数据集")

    def create_dataset_from_zip(
        self,
        zip_path: Path,
        *,
        dataset_id: str | None = None,
        display_name: str | None = None,
        make_current: bool = True,
        content_hash: str | None = None,
        progress: Any = None,
    ) -> dict[str, Any]:
        if not zip_path.exists():
            raise FileNotFoundError(str(zip_path))
        if content_hash:
            cached = self._read_cached_hash(content_hash)
            if cached is not None:
                if make_current:
                    self._write_dataset("current", cached)
                return cached

        dataset_id = sanitize_id(dataset_id or f"dataset-{int(datetime.now().timestamp())}")
        dataset_root = self.store_root / dataset_id
        archive_dir = dataset_root / "archive"
        extract_dir = dataset_root / "extracted"

        shutil.rmtree(dataset_root, ignore_errors=True)
        archive_dir.mkdir(parents=True, exist_ok=True)
        extract_dir.mkdir(parents=True, exist_ok=True)

        archive_path = archive_dir / "dataset.zip"
        shutil.copy2(zip_path, archive_path)
        if progress:
            progress("extracting", 20, "正在解压 ZIP 数据集")
        self._safe_extract_zip(archive_path, extract_dir)

        if progress:
            progress("parsing", 45, "正在解析图片、标注和类别信息")
        data_root = find_dataset_root(extract_dir)
        payload = self.analyze_dataset_directory(
            data_root,
            dataset_id=dataset_id,
            display_name=display_name or zip_path.stem,
            source_archive=archive_path,
            progress=progress,
        )
        if content_hash:
            payload["source"]["hash"] = content_hash
        self._write_dataset(dataset_id, payload)
        if make_current and dataset_id != "current":
            self._write_dataset("current", payload)
        if content_hash:
            self._write_cached_hash(content_hash, payload)
        return payload

    def save_upload(self, filename: str, content: bytes) -> dict[str, Any]:
        if not filename.lower().endswith(".zip"):
            raise ValueError("Only .zip datasets are supported.")
        content_hash = hashlib.sha256(content).hexdigest()
        cached = self._read_cached_hash(content_hash)
        if cached is not None:
            self._write_dataset("current", cached)
            return cached
        dataset_id = sanitize_id(f"uploaded-{int(datetime.now().timestamp())}-{Path(filename).stem}")
        incoming_dir = self.store_root / "_incoming" / dataset_id
        incoming_dir.mkdir(parents=True, exist_ok=True)
        upload_path = incoming_dir / "dataset.zip"
        upload_path.write_bytes(content)
        return self.create_dataset_from_zip(
            upload_path,
            dataset_id=dataset_id,
            display_name=Path(filename).stem,
            make_current=True,
            content_hash=content_hash,
        )

    def start_upload_job(self, filename: str, content: bytes) -> dict[str, Any]:
        if not filename.lower().endswith(".zip"):
            raise ValueError("Only .zip datasets are supported.")

        content_hash = hashlib.sha256(content).hexdigest()
        cached = self._read_cached_hash(content_hash)
        if cached is not None:
            self._write_dataset("current", cached)
            job_id = sanitize_id(f"job-{content_hash[:16]}")
            completed = {
                "jobId": job_id,
                "status": "completed",
                "stage": "cached",
                "progress": 100,
                "message": "命中 ZIP 内容缓存，已直接加载数据集。",
                "cached": True,
                "dataset": cached,
                "error": None,
            }
            self._set_job(job_id, completed)
            return completed

        job_id = sanitize_id(f"job-{int(datetime.now().timestamp() * 1000)}-{content_hash[:8]}")
        incoming_dir = self.store_root / "_incoming" / job_id
        incoming_dir.mkdir(parents=True, exist_ok=True)
        upload_path = incoming_dir / "dataset.zip"
        upload_path.write_bytes(content)
        job = {
            "jobId": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 5,
            "message": "ZIP 已上传，等待解析。",
            "cached": False,
            "dataset": None,
            "error": None,
        }
        self._set_job(job_id, job)

        worker = threading.Thread(
            target=self._run_upload_job,
            args=(job_id, upload_path, filename, content_hash),
            daemon=True,
        )
        worker.start()
        return self.get_upload_job(job_id)

    def get_upload_job(self, job_id: str) -> dict[str, Any]:
        with self._job_lock:
            job = self._jobs.get(sanitize_id(job_id))
            if job is None:
                raise FileNotFoundError(f"Upload job not found: {job_id}")
            return dict(job)

    def _run_upload_job(self, job_id: str, upload_path: Path, filename: str, content_hash: str) -> None:
        def progress(stage: str | dict[str, int], value: int | None = None, message: str | None = None) -> None:
            if isinstance(stage, dict):
                total = max(stage.get("missingImages", stage.get("totalImages", 0)), 1)
                encoded = stage.get("encodedImages", 0)
                percent = min(95, 75 + round((encoded / total) * 20))
                chunk_index = stage.get("chunkIndex", 0)
                chunks = stage.get("chunks", 0)
                self._update_job(
                    job_id,
                    stage="embedding",
                    progress=percent,
                    message=(
                        f"正在生成 BGE embedding：{encoded}/{total} 张"
                        f"（chunk {chunk_index}/{chunks}，缓存命中 {stage.get('cacheHits', 0)} 张）"
                    ),
                )
                return
            self._update_job(job_id, stage=stage, progress=value, message=message)

        try:
            self._update_job(
                job_id,
                status="running",
                stage="uploaded",
                progress=10,
                message="ZIP 已保存，开始解析数据集。",
            )
            dataset_id = sanitize_id(f"uploaded-{int(datetime.now().timestamp())}-{Path(filename).stem}")
            payload, dataset_root = self.create_dataset_without_embedding(
                upload_path,
                dataset_id=dataset_id,
                display_name=Path(filename).stem,
                make_current=True,
                content_hash=content_hash,
                progress=progress,
            )
            self._update_job(
                job_id,
                status="running",
                stage="embedding",
                progress=70,
                message="基础数据已展示，正在后台生成 BGE embedding。",
                dataset=payload,
            )
            if self.embedding_delay_seconds > 0:
                time.sleep(self.embedding_delay_seconds)
            payload = self.complete_dataset_embedding(
                payload,
                dataset_id=dataset_id,
                dataset_root=dataset_root,
                content_hash=content_hash,
                make_current=True,
                progress=progress,
            )
            self._update_job(
                job_id,
                status="completed",
                stage="completed",
                progress=100,
                message="数据集解析完成。",
                dataset=payload,
            )
        except Exception as exc:
            self._update_job(
                job_id,
                status="failed",
                stage="failed",
                progress=100,
                message="数据集解析失败。",
                error=str(exc),
            )

    def create_dataset_without_embedding(
        self,
        zip_path: Path,
        *,
        dataset_id: str,
        display_name: str,
        make_current: bool,
        content_hash: str,
        progress: Any = None,
    ) -> tuple[dict[str, Any], Path]:
        dataset_root = self.store_root / dataset_id
        archive_dir = dataset_root / "archive"
        extract_dir = dataset_root / "extracted"

        shutil.rmtree(dataset_root, ignore_errors=True)
        archive_dir.mkdir(parents=True, exist_ok=True)
        extract_dir.mkdir(parents=True, exist_ok=True)

        archive_path = archive_dir / "dataset.zip"
        shutil.copy2(zip_path, archive_path)
        if progress:
            progress("extracting", 20, "正在解压 ZIP 数据集")
        self._safe_extract_zip(archive_path, extract_dir)

        if progress:
            progress("parsing", 45, "正在解析图片、标注和类别信息")
        data_root = find_dataset_root(extract_dir)
        payload = self.analyze_dataset_directory(
            data_root,
            dataset_id=dataset_id,
            display_name=display_name,
            source_archive=archive_path,
            include_embedding=False,
        )
        payload["source"]["hash"] = content_hash
        self._write_dataset(dataset_id, payload)
        if make_current and dataset_id != "current":
            self._write_dataset("current", payload)
        return payload, data_root

    def complete_dataset_embedding(
        self,
        payload: dict[str, Any],
        *,
        dataset_id: str,
        dataset_root: Path,
        content_hash: str | None,
        make_current: bool,
        progress: Any = None,
    ) -> dict[str, Any]:
        if progress:
            progress("embedding", 75, "正在生成 BGE embedding 并计算二维向量分布")
        images = add_absolute_paths(payload["images"], dataset_root)
        images, embedding_meta = apply_embedding_projection(
            images,
            self.enable_bge,
            store_root=self.store_root,
            dataset_id=dataset_id,
            progress=progress,
        )
        for image in images:
            image.pop("_absolutePath", None)
        payload = {
            **payload,
            "images": images,
            "embedding": build_embedding_info(embedding_meta),
        }
        self._write_dataset(dataset_id, payload)
        if make_current and dataset_id != "current":
            self._write_dataset("current", payload)
        if content_hash:
            self._write_cached_hash(content_hash, payload)
        return payload

    def analyze_dataset_directory(
        self,
        dataset_dir: Path,
        *,
        dataset_id: str,
        display_name: str,
        source_archive: Path | None = None,
        progress: Any = None,
        include_embedding: bool = True,
    ) -> dict[str, Any]:
        dataset_dir = dataset_dir.resolve()
        split_roots = discover_split_roots(dataset_dir)
        images: list[dict[str, Any]] = []

        for split_root in split_roots:
            image_dir = split_root.path / "images"
            label_dir = split_root.path / "labels"
            xml_dir = split_root.path / "xml"
            for image_path in sorted(list_image_files(image_dir)):
                stem = image_path.stem
                width, height = read_image_size(image_path)
                xml_path = xml_dir / f"{stem}.xml"
                label_path = label_dir / f"{stem}.txt"
                detections = (
                    parse_pascal_voc(xml_path, width, height)
                    if xml_path.exists()
                    else parse_yolo_label(label_path)
                )
                primary_label = detections[0]["label"] if detections else "unknown"
                semantics = derive_placeholder_semantics(stem, primary_label, split_root.split)
                tags = sorted({split_root.split, primary_label, *semantics.values()})
                relative_path = image_path.relative_to(dataset_dir).as_posix()
                images.append(
                    {
                        "id": f"{split_root.split}-{stem}",
                        "_absolutePath": str(image_path),
                        "filepath": make_image_url(dataset_id, relative_path),
                        "filename": image_path.name,
                        "width": width,
                        "height": height,
                        "split": split_root.split,
                        "detections": detections,
                        "embedding2d": [0.0, 0.0],
                        "metadata": {
                            "source": display_name,
                            "captureDate": infer_capture_date(stem),
                            "tags": tags,
                            "semantics": semantics,
                        },
                    }
                )

        if include_embedding:
            if progress:
                progress("embedding", 70, "正在生成 BGE embedding 并计算二维向量分布")
            images, embedding_meta = apply_embedding_projection(
                images,
                self.enable_bge,
                store_root=self.store_root,
                dataset_id=dataset_id,
            )
            embedding_info = build_embedding_info(embedding_meta)
        else:
            images = apply_feature_projection(images)
            embedding_info = build_pending_embedding_info()
        for image in images:
            image.pop("_absolutePath", None)

        category_counts = count_categories(images)
        categories = sorted(category_counts)
        split_counts = count_splits(images)
        annotation_count = sum(len(image["detections"]) for image in images)

        return {
            "info": {
                "id": dataset_id,
                "name": display_name,
                "description": f"真实数据集：{dataset_dir.name}，包含 {len(images)} 张图片",
                "imageCount": len(images),
                "annotationCount": annotation_count,
                "categories": categories,
                "splits": split_counts,
            },
            "images": images,
            "categories": categories,
            "categoryCounts": category_counts,
            "embedding": embedding_info,
            "source": {
                "archive": str(source_archive) if source_archive else None,
                "root": str(dataset_dir),
                "semanticSchemaVersion": SEMANTIC_SCHEMA_VERSION,
                "semanticProvider": get_semantic_config()["provider"],
            },
        }

    def _set_job(self, job_id: str, job: dict[str, Any]) -> None:
        with self._job_lock:
            self._jobs[sanitize_id(job_id)] = dict(job)

    def _update_job(self, job_id: str, **updates: Any) -> None:
        with self._job_lock:
            current = self._jobs.get(sanitize_id(job_id), {"jobId": sanitize_id(job_id)})
            current.update(updates)
            self._jobs[sanitize_id(job_id)] = current

    def _read_cached_hash(self, content_hash: str) -> dict[str, Any] | None:
        metadata_path = self.store_root / "_cache" / sanitize_id(content_hash) / "dataset.json"
        if not metadata_path.exists():
            return None
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        return payload if is_semantic_cache_valid(payload) else None

    def _read_latest_cached_dataset(self) -> dict[str, Any] | None:
        cache_root = self.store_root / "_cache"
        if not cache_root.exists():
            return None
        metadata_paths = sorted(
            cache_root.glob("*/dataset.json"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for metadata_path in metadata_paths:
            try:
                payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if is_semantic_cache_valid(payload):
                return payload
        return None

    def _write_cached_hash(self, content_hash: str, payload: dict[str, Any]) -> None:
        cache_dir = self.store_root / "_cache" / sanitize_id(content_hash)
        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / "dataset.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def resolve_image_path(self, dataset_id: str, relative_path: str) -> Path:
        dataset_id = sanitize_id(dataset_id)
        extracted = self.store_root / dataset_id / "extracted"
        root = find_dataset_root(extracted).resolve()
        candidate = (root / relative_path.lstrip("/\\")).resolve()
        if root not in candidate.parents and candidate != root:
            raise ValueError("Invalid image path.")
        if not candidate.exists():
            raise FileNotFoundError(str(candidate))
        return candidate

    def _read_dataset(self, dataset_id: str) -> dict[str, Any] | None:
        metadata_path = self.store_root / sanitize_id(dataset_id) / "dataset.json"
        if not metadata_path.exists():
            return None
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        return payload if is_semantic_cache_valid(payload) else None

    def _write_dataset(self, dataset_id: str, payload: dict[str, Any]) -> None:
        metadata_dir = self.store_root / sanitize_id(dataset_id)
        metadata_dir.mkdir(parents=True, exist_ok=True)
        (metadata_dir / "dataset.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _safe_extract_zip(self, zip_path: Path, out_dir: Path) -> None:
        with zipfile.ZipFile(zip_path) as archive:
            for member in archive.infolist():
                target = (out_dir / member.filename).resolve()
                if out_dir.resolve() not in target.parents and target != out_dir.resolve():
                    raise ValueError(f"Unsafe zip member: {member.filename}")
            archive.extractall(out_dir)


def find_dataset_root(root: Path) -> Path:
    if has_dataset_shape(root):
        return root
    for child in root.iterdir():
        if child.is_dir() and has_dataset_shape(child):
            return child
    return root


def has_dataset_shape(root: Path) -> bool:
    if not root.exists():
        return False
    names = {child.name for child in root.iterdir()}
    return "images" in names or any(split in names for split in SPLIT_NAMES)


def discover_split_roots(root: Path) -> list[SplitRoot]:
    names = {child.name for child in root.iterdir()} if root.exists() else set()
    roots = [
        SplitRoot(normalize_split(split), root / split)
        for split in SPLIT_NAMES
        if split in names and (root / split).is_dir()
    ]
    if roots:
        return roots
    if (root / "images").is_dir():
        return [SplitRoot("train", root)]
    raise ValueError(f"No split directories found in {root}")


def normalize_split(split: str) -> str:
    if split in {"val", "validation"}:
        return "validation"
    if split == "test":
        return "test"
    return "train"


def list_image_files(image_dir: Path) -> list[Path]:
    if not image_dir.exists():
        return []
    return [
        path
        for path in image_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]


def read_image_size(image_path: Path) -> tuple[int, int]:
    with Image.open(image_path) as image:
        return image.size


def parse_pascal_voc(xml_path: Path, width: int, height: int) -> list[dict[str, Any]]:
    root = ElementTree.fromstring(xml_path.read_text(encoding="utf-8"))
    detections: list[dict[str, Any]] = []
    for index, obj in enumerate(root.findall("object")):
        label = text_or_default(obj.find("name"), "unknown")
        box = obj.find("bndbox")
        if box is None:
            continue
        xmin = float(text_or_default(box.find("xmin"), "0"))
        ymin = float(text_or_default(box.find("ymin"), "0"))
        xmax = float(text_or_default(box.find("xmax"), str(width)))
        ymax = float(text_or_default(box.find("ymax"), str(height)))
        detections.append(
            {
                "id": f"{xml_path.stem}-{index}",
                "label": label,
                "confidence": 1.0,
                "bbox": [
                    clamp(xmin / width, 0, 1),
                    clamp(ymin / height, 0, 1),
                    clamp((xmax - xmin) / width, 0, 1),
                    clamp((ymax - ymin) / height, 0, 1),
                ],
                "isGroundTruth": True,
                "attributes": {
                    "difficult": text_or_default(obj.find("difficult"), "0") == "1",
                    "truncated": text_or_default(obj.find("truncated"), "0") == "1",
                },
            }
        )
    return detections


def parse_yolo_label(label_path: Path) -> list[dict[str, Any]]:
    if not label_path.exists():
        return []
    detections: list[dict[str, Any]] = []
    for index, line in enumerate(label_path.read_text(encoding="utf-8").splitlines()):
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        class_id, cx, cy, width, height = parts[:5]
        confidence = float(parts[5]) if len(parts) > 5 else 1.0
        box_width = float(width)
        box_height = float(height)
        center_x = float(cx)
        center_y = float(cy)
        detections.append(
            {
                "id": f"{label_path.stem}-{index}",
                "label": f"class_{class_id}",
                "confidence": confidence,
                "bbox": [
                    clamp(center_x - box_width / 2, 0, 1),
                    clamp(center_y - box_height / 2, 0, 1),
                    clamp(box_width, 0, 1),
                    clamp(box_height, 0, 1),
                ],
                "isGroundTruth": True,
            }
        )
    return detections


def apply_embedding_projection(
    images: list[dict[str, Any]],
    enable_bge: bool,
    *,
    store_root: Path = STORE_ROOT,
    dataset_id: str | None = None,
    progress: Any = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    if enable_bge and BGE_MODEL_PATH.exists() and images:
        try:
            embeddings = get_cached_or_encode_image_embeddings(images, store_root, progress=progress)
            if dataset_id is not None:
                persist_dataset_embeddings(store_root, dataset_id, images, embeddings)
            apply_semantic_classification(images, embeddings)
            projected = project_to_2d(embeddings)
            for image, point in zip(images, projected):
                image["embedding2d"] = [round(point[0], 4), round(point[1], 4)]
            return images, {
                "status": "ready",
                "method": "BGE-VL-large image embeddings + PCA",
                "message": f"已使用 {BGE_SETTINGS.model_path} 生成图像 embedding，复用单图缓存后通过 PCA 降到二维用于向量分布展示。",
                "dimensions": str(len(embeddings[0]) if embeddings else 0),
                "performance": BGE_IMAGE_INFERENCE_STATS or {},
            }
        except Exception as exc:
            images = apply_feature_projection(images)
            return images, {
                "status": "fallback",
                "method": "deterministic feature projection",
                "message": f"BGE-VL-large 推理失败，已回退到图片尺寸、类别和标注几何特征投影：{exc}",
                "dimensions": "2",
            }

    images = apply_feature_projection(images)
    return images, {
        "status": "fallback",
        "method": "deterministic feature projection",
        "message": "未启用 BGE-VL-large 推理，二维可视化坐标使用图片尺寸、类别和标注几何特征生成。",
        "dimensions": "2",
    }


def build_embedding_info(embedding_meta: dict[str, str]) -> dict[str, Any]:
    return {
        "model": "bge-vl-large",
        "modelPath": str(BGE_MODEL_PATH),
        "status": embedding_meta["status"],
        "method": embedding_meta["method"],
        "dimensions": int(embedding_meta.get("dimensions", "2")),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "message": embedding_meta["message"],
        "performance": embedding_meta.get("performance", {}),
    }


def build_pending_embedding_info() -> dict[str, Any]:
    return {
        "model": "bge-vl-large",
        "modelPath": str(BGE_MODEL_PATH),
        "status": "pending",
        "method": "deterministic feature projection until BGE completes",
        "dimensions": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "message": "基础数据已就绪，BGE-VL-large embedding 正在后台生成；当前二维坐标为临时特征投影。",
    }


def add_absolute_paths(images: list[dict[str, Any]], dataset_root: Path) -> list[dict[str, Any]]:
    restored: list[dict[str, Any]] = []
    for image in images:
        params = parse_qs(urlparse(image["filepath"]).query)
        relative_path = params.get("path", [""])[0]
        absolute_path = (dataset_root / relative_path).resolve()
        restored.append({**image, "_absolutePath": str(absolute_path)})
    return restored


def encode_images_with_bge(images: list[dict[str, Any]]) -> list[list[float]]:
    if BGE_SETTINGS.use_infinity:
        return encode_images_with_infinity(images)
    model = get_bge_model()
    image_paths = [image["_absolutePath"] for image in images]
    encoded = model.encode(image_paths, batch_size=BGE_BATCH_SIZE, show_progress_bar=False)
    return encoded.tolist() if hasattr(encoded, "tolist") else list(encoded)


def encode_texts_with_bge(prompts: list[str]) -> list[list[float]]:
    if BGE_SETTINGS.use_infinity:
        return encode_texts_with_infinity(prompts)
    model = get_bge_model()
    encoded = model.encode(prompts, batch_size=BGE_BATCH_SIZE, show_progress_bar=False)
    return encoded.tolist() if hasattr(encoded, "tolist") else list(encoded)


def apply_bge_semantic_classification(
    images: list[dict[str, Any]],
    image_embeddings: list[list[float]],
) -> None:
    text_embeddings = get_semantic_text_embeddings()
    for image, image_embedding in zip(images, image_embeddings):
        semantics: dict[str, str] = {}
        semantic_meta: dict[str, dict[str, Any]] = {}
        for key, candidates in SEMANTIC_PROMPTS.items():
            labels = list(candidates)
            scores = [
                cosine_similarity(image_embedding, text_embeddings[key][label])
                for label in labels
            ]
            best_index = max(range(len(labels)), key=lambda index: scores[index])
            confidence = softmax_confidence(scores, best_index)
            semantics[key] = labels[best_index]
            semantic_meta[key] = {
                "source": "bge-zero-shot",
                "confidence": round(confidence, 4),
            }
        image["metadata"]["semantics"] = semantics
        image["metadata"]["semanticMeta"] = semantic_meta


def apply_semantic_classification(
    images: list[dict[str, Any]],
    image_embeddings: list[list[float]],
) -> None:
    config = get_semantic_config()
    if config["provider"] == "gpt-vision":
        try:
            apply_gpt_vision_semantic_classification(images, config["gptVision"])
            return
        except Exception as exc:
            for image in images:
                image.setdefault("metadata", {})["semanticProviderError"] = str(exc)
    apply_bge_semantic_classification(images, image_embeddings)


def get_semantic_config() -> dict[str, Any]:
    global SEMANTIC_CONFIG
    if SEMANTIC_CONFIG is not None:
        return SEMANTIC_CONFIG

    with SEMANTIC_CONFIG_LOCK:
        if SEMANTIC_CONFIG is None:
            config: dict[str, Any] = {
                "provider": SEMANTIC_RUNTIME_SETTINGS.provider,
                "gptVision": {
                    "baseUrl": SEMANTIC_RUNTIME_SETTINGS.gpt_vision.base_url,
                    "apiKey": SEMANTIC_RUNTIME_SETTINGS.gpt_vision.api_key,
                    "model": SEMANTIC_RUNTIME_SETTINGS.gpt_vision.model,
                    "timeoutSeconds": SEMANTIC_RUNTIME_SETTINGS.gpt_vision.timeout_seconds,
                    "maxImageSize": SEMANTIC_RUNTIME_SETTINGS.gpt_vision.max_image_size,
                },
            }
            if SEMANTIC_CONFIG_PATH.exists():
                local_config = json.loads(SEMANTIC_CONFIG_PATH.read_text(encoding="utf-8"))
                config = merge_dicts(config, local_config)
            config["provider"] = str(config.get("provider", "bge")).lower()
            SEMANTIC_CONFIG = config
        return SEMANTIC_CONFIG


def merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def apply_gpt_vision_semantic_classification(
    images: list[dict[str, Any]],
    config: dict[str, Any],
) -> None:
    for image in images:
        semantics = classify_image_semantics_with_gpt(image, config)
        image["metadata"]["semantics"] = semantics
        image["metadata"]["semanticMeta"] = {
            key: {"source": "gpt-vision", "confidence": 1.0}
            for key in SEMANTIC_OPTIONS
        }


def classify_image_semantics_with_gpt(image: dict[str, Any], config: dict[str, Any]) -> dict[str, str]:
    api_key = str(config.get("apiKey", ""))
    if not api_key:
        raise ValueError("GPT vision semantic provider requires apiKey.")
    base_url = str(config.get("baseUrl", "")).rstrip("/")
    if not base_url:
        raise ValueError("GPT vision semantic provider requires baseUrl.")

    image_url = image_to_data_url(Path(image["_absolutePath"]), int(config.get("maxImageSize", 768)))
    response = call_openai_compatible_chat(
        base_url=base_url,
        api_key=api_key,
        model=str(config.get("model", "gpt-5.5")),
        timeout_seconds=int(config.get("timeoutSeconds", 60)),
        image_url=image_url,
    )
    parsed = parse_semantic_json(response)
    return normalize_semantic_response(parsed)


def image_to_data_url(path: Path, max_size: int) -> str:
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        rgb.thumbnail((max_size, max_size))
        output = io.BytesIO()
        rgb.save(output, format="JPEG", quality=85)
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def call_openai_compatible_chat(
    *,
    base_url: str,
    api_key: str,
    model: str,
    timeout_seconds: int,
    image_url: str,
) -> str:
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "system",
                "content": "You classify construction or vehicle dataset images into fixed labels. Return only valid JSON.",
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": build_gpt_semantic_prompt(),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url},
                    },
                ],
            },
        ],
    }
    request = UrlRequest(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        body = json.loads(response.read().decode("utf-8"))
    choice = body.get("choices", [{}])[0]
    message = choice.get("message", {})
    content = message.get("content", "")
    if isinstance(content, list):
        text_parts = [part.get("text", "") for part in content if isinstance(part, dict)]
        return "\n".join(text_parts)
    return str(content)


def build_gpt_semantic_prompt() -> str:
    options = {
        key: [
            {
                "label": label,
                "description": SEMANTIC_PROMPTS[key][label],
            }
            for label in labels
        ]
        for key, labels in SEMANTIC_OPTIONS.items()
    }
    return (
        "Analyze the image and choose exactly one label id for each semantic field. "
        "Use only the label ids listed below. Each label has an English visual description; "
        "choose the closest visible match. Do not invent labels. "
        f"Semantic options: {json.dumps(options, ensure_ascii=False)}. "
        "Return JSON only, with no markdown, in this exact shape: "
        '{"lighting":"","viewpoint":"","blur":"","weather":"","timeOfDay":"","environment":""}'
    )


def parse_semantic_json(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    match = re.search(r"\{.*\}", stripped, flags=re.S)
    if not match:
        raise ValueError(f"GPT semantic response is not JSON: {text[:200]}")
    return json.loads(match.group(0))


def normalize_semantic_response(parsed: dict[str, Any]) -> dict[str, str]:
    semantics: dict[str, str] = {}
    for key, options in SEMANTIC_OPTIONS.items():
        value = parsed.get(key)
        if not isinstance(value, str) or value not in options:
            raise ValueError(f"Invalid semantic label for {key}: {value!r}")
        semantics[key] = value
    return semantics


def is_semantic_cache_valid(payload: dict[str, Any]) -> bool:
    source = payload.get("source")
    if not isinstance(source, dict):
        return False
    if source.get("semanticSchemaVersion") != SEMANTIC_SCHEMA_VERSION:
        return False
    if source.get("semanticProvider") != get_semantic_config()["provider"]:
        return False

    allowed = {key: set(values) for key, values in SEMANTIC_OPTIONS.items()}
    images = payload.get("images")
    if not isinstance(images, list):
        return False

    for image in images:
        metadata = image.get("metadata") if isinstance(image, dict) else None
        semantics = metadata.get("semantics") if isinstance(metadata, dict) else None
        if not isinstance(semantics, dict):
            return False
        for key, values in allowed.items():
            value = semantics.get(key)
            if not isinstance(value, str) or value not in values:
                return False
    return True


def get_semantic_text_embeddings() -> dict[str, dict[str, list[float]]]:
    global SEMANTIC_TEXT_EMBEDDINGS
    if SEMANTIC_TEXT_EMBEDDINGS is not None:
        return SEMANTIC_TEXT_EMBEDDINGS

    with SEMANTIC_TEXT_EMBEDDINGS_LOCK:
        if SEMANTIC_TEXT_EMBEDDINGS is None:
            prompts: list[str] = []
            prompt_keys: list[tuple[str, str]] = []
            for key, candidates in SEMANTIC_PROMPTS.items():
                for label, prompt in candidates.items():
                    prompt_keys.append((key, label))
                    prompts.append(prompt)

            encoded = encode_texts_with_bge(prompts)
            result: dict[str, dict[str, list[float]]] = {}
            for (key, label), vector in zip(prompt_keys, encoded):
                result.setdefault(key, {})[label] = [float(value) for value in vector]
            SEMANTIC_TEXT_EMBEDDINGS = result
        return SEMANTIC_TEXT_EMBEDDINGS


def cosine_similarity(a: list[float], b: list[float]) -> float:
    length = min(len(a), len(b))
    if length == 0:
        return 0.0
    dot = sum(a[index] * b[index] for index in range(length))
    norm_a = math.sqrt(sum(a[index] * a[index] for index in range(length)))
    norm_b = math.sqrt(sum(b[index] * b[index] for index in range(length)))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def softmax_confidence(scores: list[float], best_index: int) -> float:
    if not scores:
        return 0.0
    max_score = max(scores)
    exps = [math.exp(score - max_score) for score in scores]
    total = sum(exps)
    return exps[best_index] / total if total else 0.0


def get_cached_or_encode_image_embeddings(
    images: list[dict[str, Any]],
    store_root: Path,
    progress: Any = None,
) -> list[list[float]]:
    global BGE_IMAGE_INFERENCE_STATS
    cache_dir = store_root / "_image-embeddings"
    cache_dir.mkdir(parents=True, exist_ok=True)

    vectors: list[list[float] | None] = []
    missing_images: list[dict[str, Any]] = []
    missing_indices: list[int] = []
    missing_hashes: list[str] = []

    for index, image in enumerate(images):
        digest = hash_file(Path(image["_absolutePath"]))
        cached_vector = read_cached_image_embedding(cache_dir, digest)
        if cached_vector is None:
            vectors.append(None)
            missing_images.append(image)
            missing_indices.append(index)
            missing_hashes.append(digest)
        else:
            vectors.append(cached_vector)

    inference_seconds = 0.0
    encoded_so_far = 0
    chunk_size = max(int(BGE_EMBEDDING_CHUNK_SIZE), 1)
    chunks = math.ceil(len(missing_images) / chunk_size) if missing_images else 0
    concurrency = BGE_SETTINGS.infinity_concurrency if BGE_SETTINGS.use_infinity else 1

    # Build chunk specs
    chunk_specs: list[tuple[int, list, list[int], list[str]]] = []
    for chunk_index, start in enumerate(range(0, len(missing_images), chunk_size), start=1):
        end = min(start + chunk_size, len(missing_images))
        chunk_specs.append((
            chunk_index,
            missing_images[start:end],
            missing_indices[start:end],
            missing_hashes[start:end],
        ))

    def _process_chunk_result(indices: list[int], hashes: list[str], encoded: list[list[float]]) -> None:
        nonlocal encoded_so_far
        for idx, digest, vector in zip(indices, hashes, encoded):
            normalized = [float(value) for value in vector]
            vectors[idx] = normalized
            write_cached_image_embedding(cache_dir, digest, normalized)
        encoded_so_far += len(indices)

    def _report_progress(chunk_index: int) -> None:
        if progress:
            progress({
                "totalImages": len(images),
                "encodedImages": encoded_so_far,
                "cacheHits": len(images) - len(missing_images),
                "missingImages": len(missing_images),
                "chunkIndex": chunk_index,
                "chunks": chunks,
            })

    if concurrency > 1 and len(chunk_specs) > 1 and BGE_SETTINGS.use_infinity:
        # Parallel chunk processing via thread pool.
        # Each thread calls encode_images_with_bge (respecting test mocks)
        # which internally does loop.run_until_complete on its own thread.
        from concurrent.futures import ThreadPoolExecutor, as_completed

        max_workers = min(concurrency, len(chunk_specs))
        LOGGER.info("Parallel chunk encoding: %d chunks, concurrency=%d", len(chunk_specs), max_workers)

        def _encode_chunk(spec):
            chunk_index, chunk_imgs, indices, hashes = spec
            started = time.perf_counter()
            encoded = encode_images_with_bge(chunk_imgs)
            elapsed = time.perf_counter() - started
            return chunk_index, indices, hashes, encoded, elapsed

        started_at = time.perf_counter()
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(_encode_chunk, spec): spec[0] for spec in chunk_specs}
            for future in as_completed(futures):
                chunk_index, indices, hashes, encoded, _ = future.result()
                _process_chunk_result(indices, hashes, encoded)
                _report_progress(chunk_index)
        inference_seconds += time.perf_counter() - started_at
    else:
        # Sequential processing (sentence-transformers or concurrency=1)
        for chunk_index, chunk_images, chunk_indices, chunk_hashes in chunk_specs:
            started_at = time.perf_counter()
            encoded = encode_images_with_bge(chunk_images)
            inference_seconds += time.perf_counter() - started_at
            _process_chunk_result(chunk_indices, chunk_hashes, encoded)
            _report_progress(chunk_index)

    if any(vector is None for vector in vectors):
        raise RuntimeError("Image embedding cache produced an incomplete vector list.")
    encoded_count = len(missing_images)
    BGE_IMAGE_INFERENCE_STATS = {
        "totalImages": len(images),
        "encodedImages": encoded_count,
        "cacheHits": len(images) - encoded_count,
        "totalInferenceSeconds": round(inference_seconds, 6),
        "averageInferenceMsPerImage": round((inference_seconds / encoded_count) * 1000, 3)
        if encoded_count
        else 0.0,
        "batchSize": BGE_BATCH_SIZE,
        "chunkSize": chunk_size,
        "chunks": chunks,
        "device": resolve_bge_device(),
    }
    LOGGER.info(
        "BGE image inference: encoded=%s cache_hits=%s total_seconds=%.6f avg_ms_per_image=%.3f batch_size=%s device=%s",
        BGE_IMAGE_INFERENCE_STATS["encodedImages"],
        BGE_IMAGE_INFERENCE_STATS["cacheHits"],
        BGE_IMAGE_INFERENCE_STATS["totalInferenceSeconds"],
        BGE_IMAGE_INFERENCE_STATS["averageInferenceMsPerImage"],
        BGE_IMAGE_INFERENCE_STATS["batchSize"],
        BGE_IMAGE_INFERENCE_STATS["device"],
    )
    return [vector for vector in vectors if vector is not None]


def read_cached_image_embedding(cache_dir: Path, digest: str) -> list[float] | None:
    path = cache_dir / f"{digest}.npy"
    if not path.exists():
        return None
    array = np.load(path)
    return array.astype(np.float32).tolist()


def write_cached_image_embedding(cache_dir: Path, digest: str, vector: list[float]) -> None:
    np.save(cache_dir / f"{digest}.npy", np.asarray(vector, dtype=np.float32))


def persist_dataset_embeddings(
    store_root: Path,
    dataset_id: str,
    images: list[dict[str, Any]],
    embeddings: list[list[float]],
) -> None:
    embedding_dir = store_root / sanitize_id(dataset_id) / "embeddings"
    embedding_dir.mkdir(parents=True, exist_ok=True)
    np.save(embedding_dir / "image_embeddings.npy", np.asarray(embeddings, dtype=np.float32))
    (embedding_dir / "image_ids.json").write_text(
        json.dumps([image["id"] for image in images], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get_bge_model() -> Any:
    global BGE_MODEL
    if BGE_MODEL is not None:
        return BGE_MODEL

    with BGE_MODEL_LOCK:
        if BGE_MODEL is None:
            from sentence_transformers import SentenceTransformer

            model_path = str(BGE_MODEL_PATH)
            if model_path not in sys.path:
                sys.path.insert(0, model_path)
            BGE_MODEL = SentenceTransformer(
                str(BGE_MODEL_PATH),
                trust_remote_code=True,
                device=resolve_bge_device(),
            )
            configure_bge_sentence_transformer(BGE_MODEL)
        return BGE_MODEL


def get_infinity_engine() -> Any:
    global INFINITY_ENGINE, INFINITY_ENGINE_LOOP
    if INFINITY_ENGINE is not None:
        return INFINITY_ENGINE, INFINITY_ENGINE_LOOP

    with INFINITY_ENGINE_LOCK:
        if INFINITY_ENGINE is not None:
            return INFINITY_ENGINE, INFINITY_ENGINE_LOOP

        import asyncio
        from infinity_emb import AsyncEmbeddingEngine, EngineArgs

        loop = asyncio.new_event_loop()
        engine = AsyncEmbeddingEngine.from_args(
            EngineArgs(
                model_name_or_path=str(BGE_MODEL_PATH),
                engine="torch",
                device=resolve_bge_device(),
                bettertransformer=True,
                model_warmup=False,
                batch_size=BGE_SETTINGS.infinity_batch_size,
            )
        )
        loop.run_until_complete(engine.astart())

        # Run the event loop in a daemon thread so
        # run_coroutine_threadsafe() works from any thread.
        loop_thread = threading.Thread(target=loop.run_forever, daemon=True)
        loop_thread.start()

        INFINITY_ENGINE = engine
        INFINITY_ENGINE_LOOP = loop
        LOGGER.info(
            "Infinity engine started on %s from %s (batch_size=%d, concurrency=%d).",
            resolve_bge_device(), BGE_MODEL_PATH,
            BGE_SETTINGS.infinity_batch_size,
            BGE_SETTINGS.infinity_concurrency,
        )
        return INFINITY_ENGINE, INFINITY_ENGINE_LOOP


def _infinity_submit(loop: Any, coro: Any) -> Any:
    """Thread-safe coroutine submission to the shared Infinity event loop."""
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result()


def encode_images_with_infinity(images: list[dict[str, Any]]) -> list[list[float]]:
    engine, loop = get_infinity_engine()
    image_bytes_list = [Path(p["_absolutePath"]).read_bytes() for p in images]
    embeddings, _ = _infinity_submit(loop, engine.image_embed(images=image_bytes_list))
    return [list(vec) for vec in embeddings]


def encode_texts_with_infinity(prompts: list[str]) -> list[list[float]]:
    engine, loop = get_infinity_engine()
    embeddings, _ = _infinity_submit(loop, engine.embed(sentences=prompts))
    return [list(vec) for vec in embeddings]


def preload_bge_model() -> bool:
    if not BGE_PRELOAD_ON_STARTUP:
        LOGGER.info("BGE model preload is disabled by BGE_PRELOAD_ON_STARTUP=0.")
        return False
    if not BGE_MODEL_PATH.exists():
        LOGGER.warning("BGE model preload skipped because model path does not exist: %s", BGE_MODEL_PATH)
        return False
    try:
        if BGE_SETTINGS.use_infinity:
            engine, _ = get_infinity_engine()
            LOGGER.info("Infinity embedding engine preloaded on %s from %s.", resolve_bge_device(), BGE_MODEL_PATH)
        else:
            model = get_bge_model()
            LOGGER.info("BGE model preloaded on %s from %s.", getattr(model, "device", resolve_bge_device()), BGE_MODEL_PATH)
        return True
    except Exception:
        LOGGER.exception("BGE model preload failed.")
        return False


def configure_bge_sentence_transformer(model: Any) -> None:
    """Adapt BGE-VL CLIP modules for sentence-transformers versions that return tensors.

    The local BGE-VL-large config declares `pooler_output` for get_image_features and
    get_text_features, but those methods return the embedding tensor directly. Newer
    sentence-transformers versions therefore try to index a 2D tensor with the string
    `pooler_output`, raising `too many indices for tensor of dimension 2`.
    """
    modules = list(model) if hasattr(model, "__iter__") else []
    if not modules and hasattr(model, "_modules"):
        modules = list(getattr(model, "_modules").values())

    for module in modules:
        modality_config = getattr(module, "modality_config", None)
        if not isinstance(modality_config, dict):
            continue
        for params in modality_config.values():
            if not isinstance(params, dict):
                continue
            if params.get("method") in {"get_image_features", "get_text_features"}:
                if params.get("method_output_name") == "pooler_output":
                    params["method_output_name"] = None


def resolve_bge_device() -> str:
    if BGE_DEVICE:
        return BGE_DEVICE
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def apply_feature_projection(images: list[dict[str, Any]]) -> list[dict[str, Any]]:
    features = [build_feature_vector(image) for image in images]
    projected = project_to_2d(features)
    for image, point in zip(images, projected):
        image["embedding2d"] = [round(point[0], 4), round(point[1], 4)]
    return images


def project_to_2d(features: list[list[float]]) -> list[list[float]]:
    projected: list[list[float]]
    if PCA is not None and len(features) >= 2:
        projected_array = PCA(n_components=2, random_state=42).fit_transform(features)
        projected = projected_array.tolist()
    else:
        projected = [[row[0], row[1] if len(row) > 1 else 0.0] for row in features]

    return normalize_points(projected)


def build_feature_vector(image: dict[str, Any]) -> list[float]:
    detections = image["detections"]
    labels = sorted({det["label"] for det in detections})
    primary = detections[0]["label"] if detections else "unknown"
    digest = hash_units(f"{image['id']}:{primary}:{','.join(labels)}", 8)
    area_sum = sum(det["bbox"][2] * det["bbox"][3] for det in detections)
    center_x = sum(det["bbox"][0] + det["bbox"][2] / 2 for det in detections) / max(len(detections), 1)
    center_y = sum(det["bbox"][1] + det["bbox"][3] / 2 for det in detections) / max(len(detections), 1)
    aspect = image["width"] / max(image["height"], 1)
    return [
        aspect,
        len(detections),
        area_sum,
        center_x,
        center_y,
        *digest,
    ]


def normalize_points(points: list[list[float]]) -> list[list[float]]:
    if not points:
        return []
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    x_mid = (min(xs) + max(xs)) / 2
    y_mid = (min(ys) + max(ys)) / 2
    scale = max(max(xs) - min(xs), max(ys) - min(ys), 1e-6)
    return [[(point[0] - x_mid) / scale * 8, (point[1] - y_mid) / scale * 8] for point in points]


def derive_placeholder_semantics(stem: str, primary_label: str, split: str) -> dict[str, str]:
    units = hash_units(f"{stem}:{primary_label}:{split}", 8)
    return {
        "lighting": pick_option("lighting", units[0]),
        "viewpoint": pick_option("viewpoint", units[1]),
        "blur": pick_option("blur", units[2]),
        "weather": pick_option("weather", units[3]),
        "timeOfDay": pick_option("timeOfDay", units[4]),
        "environment": pick_environment(primary_label, units[5]),
    }


def pick_option(key: str, unit: float) -> str:
    values = SEMANTIC_OPTIONS[key]
    return values[min(len(values) - 1, math.floor(unit * len(values)))]


def pick_environment(label: str, unit: float) -> str:
    lower = label.lower()
    if any(token in lower for token in ("diaoche", "tuituji", "wajueji", "saturentuiche")):
        return "construction-site" if unit < 0.6 else "urban-street"
    return pick_option("environment", unit)


def count_categories(images: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for image in images:
        for detection in image["detections"]:
            label = detection["label"]
            counts[label] = counts.get(label, 0) + 1
    return counts


def count_splits(images: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "train": sum(1 for image in images if image["split"] == "train"),
        "validation": sum(1 for image in images if image["split"] == "validation"),
        "test": sum(1 for image in images if image["split"] == "test"),
    }


def make_image_url(dataset_id: str, relative_path: str) -> str:
    return f"/api/dataset/image?id={quote(dataset_id)}&path={quote(relative_path)}"


def infer_capture_date(stem: str) -> str:
    match = re.match(r"^(\d{4})(\d{2})(\d{2})", stem)
    if not match:
        return "未知"
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"


def hash_units(seed: str, count: int) -> list[float]:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return [int.from_bytes(digest[index * 4 : index * 4 + 4], "big") / 0xFFFFFFFF for index in range(count)]


def sanitize_id(value: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
    return sanitized[:80] or "dataset"


def text_or_default(element: ElementTree.Element | None, default: str) -> str:
    if element is None or element.text is None:
        return default
    return element.text.strip()


def clamp(value: float, lower: float, upper: float) -> float:
    return min(upper, max(lower, value))
