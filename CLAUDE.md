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
bash scripts/validate.sh        # wrapper around pnpm validate
```

The custom server reads `PORT`, `DEPLOY_RUN_PORT`, `PYTHON_API_PORT`, and `PYTHON_API_HOST`. In dev, `scripts/dev.sh` sets `PORT=3000` unless `DEPLOY_RUN_PORT` is provided; the Python API defaults to `PORT + 1`.

Python backend commands:

```bash
python3 -m uvicorn backend.app:app --host 127.0.0.1 --port 5001
BGE_VL_ENABLE=0 python3 -m uvicorn backend.app:app --host 127.0.0.1 --port 5001
python3 -m unittest discover -s test
python3 -m unittest test.test_api.DatasetApiTest.test_current_dataset_returns_404_until_dataset_is_uploaded
python3 -m unittest test.test_dataset_service.DatasetServiceTest.test_loads_sample_zip_into_gallery_payload
```

TypeScript tests are plain `node:test` tests in TypeScript files, with no package script currently defined:

```bash
pnpm tsx --test src/lib/store.test.ts
```

## Runtime Configuration

Backend dataset and embedding behavior is controlled by environment variables in `backend/dataset_service.py`:

- `DATASET_STORE_ROOT` defaults to `.dataset-store`; stores uploaded archives, extracted datasets, cached payloads, embedding `.npy` files, and current dataset state.
- `BGE_VL_ENABLE` defaults to enabled; set `BGE_VL_ENABLE=0` for faster local development/tests without real BGE inference.
- `BGE_VL_MODEL_PATH` defaults to `/home/shao/zzq/model/BGE-VL-large`.
- `BGE_BATCH_SIZE` defaults to `8`.
- `BGE_DEVICE` lets the embedding code choose a device explicitly.
- `SEMANTIC_CONFIG_PATH` defaults to `backend/semantic_config.local.json`; keep local config out of commits and use `backend/semantic_config.example.json` as the shareable template.

## Architecture

### Server Flow

`src/server.ts` is the real app entrypoint for both dev and production. It starts a Next.js app and spawns `python3 -m uvicorn backend.app:app` as a child process. Requests whose URL starts with `/api/dataset/` are proxied to the Python API; everything else is handled by Next.

Because of this, frontend code should call dataset endpoints with relative paths like `/api/dataset/current`. Do not bypass the proxy from browser code unless there is a deliberate deployment change.

### Frontend Data Model

`src/lib/types.ts` defines the shared frontend payload shape: `DatasetPayload`, `DatasetImage`, detections, split/category counts, embedding metadata, and semantic attributes. Keep this synchronized with the JSON emitted by `DatasetService`.

`src/lib/store.ts` is the central Zustand store. It owns:

- dataset loading/uploading/job polling state
- filters for categories, splits, semantic attributes, and search
- selected image and scatter selection state
- view mode (`grid` or `scatter`) and color-by mode
- computed selectors such as `getFilteredImages()` and `getVisibleFilteredImages()`

`src/lib/dataset-api.ts` is the browser client wrapper around `/api/dataset/current`, `/api/dataset/upload`, and `/api/dataset/jobs/{jobId}`.

### Frontend UI Composition

`src/app/page.tsx` is a client page that loads the current dataset once on mount, then composes the main console:

- `src/components/topbar.tsx` handles ZIP upload, search, view switching, and upload progress/status.
- `src/components/sidebar.tsx` renders split/category/semantic filters and count summaries.
- `src/components/grid-view.tsx` renders lazy image cards and normalized detection bounding boxes.
- `src/components/scatter-view.tsx` renders the embedding canvas, color modes, rectangle/polygon/lasso selections, and optional cleaning overlays.
- `src/components/detail-panel.tsx` shows selected-image details or aggregate filtered distribution summaries.

`src/components/ui/` contains shadcn/ui primitives. Prefer composing those primitives for new reusable UI rather than inventing new base controls.

### Backend Dataset Pipeline

`backend/app.py` exposes the FastAPI surface:

- `GET /health`
- `GET /api/dataset/current`
- `POST /api/dataset/upload`
- `GET /api/dataset/jobs/{job_id}`
- `GET /api/dataset/image?id=...&path=...`

`backend/dataset_service.py` contains most backend logic. It accepts only ZIP uploads, safely extracts them, discovers the dataset root, parses images/annotations/splits, computes dataset summaries, writes cached JSON payloads, resolves image paths, and runs upload jobs in background threads.

Embeddings are generated with BGE-VL when enabled. The service persists image embedding arrays and IDs under the dataset cache, projects embeddings to 2D for the frontend, and falls back when embedding generation is unavailable. Semantic attributes are either inferred through BGE zero-shot text/image similarity or configured providers from the semantic config.

### Data Cleaning

`src/lib/cleaning/` contains lightweight frontend-only cleaning detectors. Current detectors operate on 2D embedding coordinates:

- outliers via average k-nearest-neighbor distance
- near-duplicates via pairwise 2D distance threshold

These are candidate signals for UI review, not authoritative dataset labels.

## Project-Specific Notes

- The Python tests reference `/home/shao/zzq/误报/2025-04-01/sample_split_80_10_10.zip`; if that fixture is absent, those tests will fail even if the code is correct.
- `backend/semantic_config.local.json`, `.dataset-store/`, build outputs, and local logs are ignored and should stay local.
- ESLint forbids direct JSX `<head>` usage; use Next metadata APIs instead.
- ESLint also forbids hard-coded absolute `root`/`outputFileTracingRoot` values in `next.config.ts`; build paths dynamically if enabling those settings.
- TypeScript is configured with `strict: true` and `@/*` mapped to `src/*`.
- VS Code is configured to use conda as the Python environment/package manager.
