# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 16 + React 19 dataset visualization app with a Python FastAPI backend for uploading, parsing, caching, and embedding computer-vision datasets. The UI is a detection-gallery/data-analysis console: upload a ZIP dataset, inspect image grids and annotation boxes, filter by split/category/semantic attributes, view 2D embedding scatter plots, and surface simple cleaning signals.

The project is created from the Coze coding template, but the active product logic is specific to embeddings/dataset analysis.

## Development Commands

Use **pnpm only** for JavaScript dependencies. `package.json` enforces this through `preinstall`.

```bash
pnpm install                    # install JS dependencies
pnpm dev                        # run custom dev server (Next app + Python API proxy), default port 3000
pnpm build                      # next build, bundle src/server.ts, copy backend/ into dist/
pnpm start                      # run built dist/server.js, default deploy port 5000
pnpm lint                       # ESLint all files
pnpm lint:build                 # quiet ESLint used by validate
pnpm ts-check                   # TypeScript check
pnpm validate                   # run ts-check and lint:build in parallel
```

Windows batch equivalents are in `scripts/dev.bat`, `scripts/build.bat`, `scripts/start.bat`.

The custom server reads `PORT`, `DEPLOY_RUN_PORT`, `PYTHON_API_PORT`, and `PYTHON_API_HOST`. In dev, `PORT=3000` unless `DEPLOY_RUN_PORT` is provided; the Python API defaults to `PORT + 1`.

Python environment: **conda `zzq` env** at `C:\ProgramData\miniconda3\envs\zzq\python.exe`. Use `python` (not `python3`) on Windows. Python dependencies are in `requirements.txt`.

```bash
# Backend standalone (use conda zzq env)
python -m uvicorn backend.app:app --host 127.0.0.1 --port 5001
BGE_VL_ENABLE=0 python -m uvicorn backend.app:app --host 127.0.0.1 --port 5001

# Python tests
python -m unittest discover -s test
python -m unittest test.test_api.DatasetApiTest.test_current_dataset_returns_404_until_dataset_is_uploaded

# TypeScript tests
pnpm tsx --test src/lib/store.test.ts
```

## Runtime Configuration

Backend behavior is controlled by environment variables defined in `config/dataset_settings.py`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `BGE_VL_MODEL_PATH` | `E:\zzq\model\BGE-VL-large` (Win) / `/home/shao/zzq/model/BGE-VL-large` (Linux) | Path to BGE-VL-large model weights |
| `BGE_VL_ENABLE` | `True` | Set `0` to skip BGE embedding (faster dev/test) |
| `BGE_BATCH_SIZE` | `16` | BGE inference batch size |
| `BGE_DEVICE` | auto (CUDA or CPU) | PyTorch device |
| `DATASET_STORE_ROOT` | `.dataset-store` | Upload/cache/embedding storage |
| `SEMANTIC_PROVIDER` | `bge` | `bge` or `gpt-vision` |
| `SEMANTIC_CONFIG_PATH` | `backend/semantic_config.local.json` | Local semantic config override |
| `SAMPLE_ZIP_PATH` | platform-dependent | Test fixture ZIP path |

`backend/semantic_config.local.json` is gitignored; use `backend/semantic_config.example.json` as the shareable template.

## Architecture

### Server Flow

`src/server.ts` is the real app entrypoint for both dev and production. It starts a Next.js app and spawns `python -m uvicorn backend.app:app` as a child process (auto-detects `python` vs `python3` by platform). Requests whose URL starts with `/api/dataset/` are proxied to the Python API; everything else is handled by Next.

Frontend code must call dataset endpoints with relative paths like `/api/dataset/current`. Do not bypass the proxy from browser code.

### Frontend Data Model

`src/lib/types.ts` defines the shared frontend payload shape: `DatasetPayload`, `DatasetImage`, detections, split/category counts, embedding metadata, and semantic attributes. Keep this synchronized with the JSON emitted by `DatasetService`.

`src/lib/store.ts` is the central Zustand store. It owns dataset loading/uploading/job polling state, filters (categories, splits, semantic attributes, search), selected image and scatter selection state, view mode (`grid`/`scatter`), color-by mode, and computed selectors like `getFilteredImages()`.

`src/lib/dataset-api.ts` is the browser client wrapper around `/api/dataset/current`, `/api/dataset/upload`, and `/api/dataset/jobs/{jobId}`.

### Frontend UI Composition

`src/app/page.tsx` is a client page that loads the current dataset once on mount, then composes the main console:

- `topbar.tsx` — ZIP upload, search, view switching, upload progress
- `sidebar.tsx` — split/category/semantic filters and count summaries
- `grid-view.tsx` — lazy image cards with normalized detection bounding boxes
- `scatter-view.tsx` — embedding canvas, color modes, rectangle/polygon/lasso selections, cleaning overlays
- `detail-panel.tsx` — selected-image details or aggregate filtered distribution summaries

`src/components/ui/` contains shadcn/ui primitives. Prefer composing those for new reusable UI.

### Backend Dataset Pipeline

`backend/app.py` exposes the FastAPI surface: `GET /health`, `GET /api/dataset/current`, `POST /api/dataset/upload`, `GET /api/dataset/jobs/{job_id}`, `GET /api/dataset/image`.

`backend/dataset_service.py` (1300+ lines) contains most backend logic: ZIP extraction, dataset root discovery, Pascal VOC + YOLO label parsing, BGE-VL-large image/text embedding (sentence-transformers), per-image embedding cache (SHA-256 keyed .npy files), PCA 2D projection (sklearn), semantic classification (BGE zero-shot or GPT vision), and a threaded job queue.

### Data Cleaning

`src/lib/cleaning/` contains frontend-only cleaning detectors operating on 2D embedding coordinates: outliers via average k-nearest-neighbor distance, near-duplicates via pairwise distance threshold. These are candidate signals for UI review, not authoritative labels.

## Style Guidelines

- **Python**: 79 char line length, 4 spaces indent, stdlib → third-party → project-local import order
- **TypeScript**: `strict: true`, `@/*` mapped to `src/*`, shadcn/ui components for UI primitives
- **Package manager**: pnpm only (enforced by preinstall hook)

## Project-Specific Notes

- Python tests reference a sample ZIP via `SAMPLE_ZIP_PATH` env var; if absent, tests will fail even if code is correct.
- `backend/semantic_config.local.json`, `.dataset-store/`, `.model-cache/`, build outputs, and local logs are gitignored.
- ESLint forbids direct JSX `<head>` usage; use Next metadata APIs instead.
- ESLint forbids hard-coded absolute `root`/`outputFileTracingRoot` in `next.config.ts`; build paths dynamically.
- VS Code is configured to use conda `zzq` env as the Python environment.
- Model weights at `E:\zzq\model\BGE-VL-large` (mapped from Linux `/home/shao/zzq/model/BGE-VL-large`).

### Karpathy Guidelines

- Read key code paths before changing them; understand intent, boundary conditions, failure modes.
- Minimal viable loop first: smallest surface area, run type-check/test/verify, then expand.
- Prefer simple, direct, explainable implementations over premature abstraction.
- Trust but verify AI-generated code: check types, undeclared identifiers, dead code, exception paths, hydration risks.
- Small commits with clear diffs; every change should answer "why needed, what affected, how verified."
