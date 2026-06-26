from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.dataset_service import DatasetService, preload_bge_model

STREAM_CHUNK_SIZE = 1024 * 1024  # 1 MiB


app = FastAPI(title="Embeddings Vision Dataset API")
service = DatasetService()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def preload_models() -> None:
    preload_bge_model()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/dataset/current")
def current_dataset() -> dict:
    try:
        return service.current_dataset()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/dataset/upload")
async def upload_dataset(request: Request) -> dict:
    try:
        filename = unquote(request.headers.get("x-filename", "dataset.zip"))
        hasher = hashlib.sha256()
        tmp = tempfile.NamedTemporaryFile(
            suffix=".zip", delete=False,
        )
        try:
            async for chunk in request.stream():
                tmp.write(chunk)
                hasher.update(chunk)
            tmp.close()
            content_hash = hasher.hexdigest()
            return service.start_upload_job(
                filename, Path(tmp.name), content_hash,
            )
        except BaseException:
            tmp.close()
            Path(tmp.name).unlink(missing_ok=True)
            raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/dataset/jobs/{job_id}")
def upload_job(job_id: str) -> dict:
    try:
        return service.get_upload_job(job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/dataset/image")
def dataset_image(id: str, path: str) -> FileResponse:
    try:
        image_path = service.resolve_image_path(id, path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FileResponse(
        Path(image_path),
        media_type=guess_media_type(Path(image_path)),
        headers={"Cache-Control": "public, max-age=3600"},
    )


def guess_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".bmp":
        return "image/bmp"
    return "application/octet-stream"
