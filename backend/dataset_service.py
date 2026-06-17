from __future__ import annotations

import hashlib
import json
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
from xml.etree import ElementTree

import numpy as np
from PIL import Image

try:
    from sklearn.decomposition import PCA
except Exception:  # pragma: no cover - sklearn is present in the target env
    PCA = None


STORE_ROOT = Path(os.environ.get("DATASET_STORE_ROOT", ".dataset-store")).resolve()
BGE_MODEL_PATH = Path(os.environ.get("BGE_VL_MODEL_PATH", "/home/shao/zzq/model/BGE-VL-large"))
BGE_BATCH_SIZE = int(os.environ.get("BGE_BATCH_SIZE", "8"))
BGE_DEVICE = os.environ.get("BGE_DEVICE")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
BGE_MODEL = None
BGE_MODEL_LOCK = threading.Lock()

SPLIT_NAMES = ("train", "val", "validation", "test")
SEMANTIC_OPTIONS: dict[str, list[str]] = {
    "lighting": ["bright", "dim", "backlit", "low-light", "mixed"],
    "viewpoint": ["front", "side", "rear", "top-down", "aerial", "wide", "close-up"],
    "blur": ["sharp", "slight-blur", "motion-blur", "out-of-focus"],
    "weather": ["clear", "cloudy", "rain", "snow", "fog", "indoor"],
    "timeOfDay": ["day", "dusk", "night"],
    "environment": ["indoor", "outdoor", "urban", "rural", "road", "aerial"],
}


@dataclass(frozen=True)
class SplitRoot:
    split: str
    path: Path


class DatasetService:
    def __init__(self, store_root: Path = STORE_ROOT, enable_bge: bool | None = None) -> None:
        self.store_root = store_root
        self.enable_bge = os.environ.get("BGE_VL_ENABLE", "1") != "0" if enable_bge is None else enable_bge
        self.embedding_delay_seconds = 0.0
        self._job_lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self.store_root.mkdir(parents=True, exist_ok=True)

    def current_dataset(self) -> dict[str, Any]:
        payload = self._read_dataset("current")
        if payload is not None:
            return payload
        raise FileNotFoundError("No dataset is loaded. Upload a zip dataset first.")

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
        def progress(stage: str, value: int, message: str) -> None:
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
        return json.loads(metadata_path.read_text(encoding="utf-8"))

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
        return json.loads(metadata_path.read_text(encoding="utf-8"))

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
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    if enable_bge and BGE_MODEL_PATH.exists() and images:
        try:
            embeddings = get_cached_or_encode_image_embeddings(images, store_root)
            if dataset_id is not None:
                persist_dataset_embeddings(store_root, dataset_id, images, embeddings)
            projected = project_to_2d(embeddings)
            for image, point in zip(images, projected):
                image["embedding2d"] = [round(point[0], 4), round(point[1], 4)]
            return images, {
                "status": "ready",
                "method": "BGE-VL-large image embeddings + PCA",
                "message": "已使用 /home/shao/zzq/model/BGE-VL-large 生成图像 embedding，复用单图缓存后通过 PCA 降到二维用于向量分布展示。",
                "dimensions": str(len(embeddings[0]) if embeddings else 0),
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
    model = get_bge_model()
    image_paths = [image["_absolutePath"] for image in images]
    encoded = model.encode(image_paths, batch_size=BGE_BATCH_SIZE, show_progress_bar=False)
    return encoded.tolist() if hasattr(encoded, "tolist") else list(encoded)


def get_cached_or_encode_image_embeddings(
    images: list[dict[str, Any]],
    store_root: Path,
) -> list[list[float]]:
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

    if missing_images:
        encoded = encode_images_with_bge(missing_images)
        for index, digest, vector in zip(missing_indices, missing_hashes, encoded):
            normalized = [float(value) for value in vector]
            vectors[index] = normalized
            write_cached_image_embedding(cache_dir, digest, normalized)

    if any(vector is None for vector in vectors):
        raise RuntimeError("Image embedding cache produced an incomplete vector list.")
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
        return BGE_MODEL


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
        return "road" if unit < 0.35 else "outdoor"
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
