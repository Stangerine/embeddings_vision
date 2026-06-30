# Milvus 数据库结构

> 使用 Milvus Lite（嵌入式），数据文件：`.milvus-data.db`
> Embedding 维度：768（BGE-VL-large）

## Collection 总览

| Collection | 用途 | 主键 | 向量字段 |
|-----------|------|------|----------|
| `datasets` | 数据集级元数据 | `dataset_id` | `placeholder_vector` (2维) |
| `images` | 图片信息 + embedding | `id` | `embedding` (768维) + `embedding_2d` (2维) |
| `embedding_cache` | 跨数据集 embedding 缓存 | `file_hash` | `embedding` (768维) |

## 1. `datasets` Collection

数据集级元数据，每个数据集一行。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `dataset_id` | VARCHAR(200) | **PK** | 数据集 ID，如 `uploaded-1719312000-sample` |
| `name` | VARCHAR(500) | | 显示名称 |
| `description` | VARCHAR(2000) | | 数据集描述 |
| `source_archive` | VARCHAR(1000) | | 原始 ZIP 路径 |
| `source_root` | VARCHAR(1000) | | 解压后的根目录 |
| `semantic_schema_version` | VARCHAR(200) | | 语义标签版本号 |
| `semantic_provider` | VARCHAR(100) | | 语义分类提供者（`bge` / `gpt-vision`） |
| `embedding_model` | VARCHAR(200) | | 使用的 embedding 模型名 |
| `embedding_status` | VARCHAR(50) | | `pending` / `ready` / `fallback` |
| `embedding_method` | VARCHAR(500) | | embedding 方法描述 |
| `embedding_dimensions` | INT64 | | embedding 维度（768） |
| `embedding_generated_at` | VARCHAR(100) | | 生成时间（ISO 8601） |
| `embedding_message` | VARCHAR(2000) | | 状态消息 |
| `embedding_performance` | VARCHAR(5000) | | 性能统计（JSON） |
| `category_counts` | VARCHAR(10000) | | 类别计数（JSON dict） |
| `split_counts` | VARCHAR(1000) | | 数据划分计数（JSON dict） |
| `categories` | VARCHAR(10000) | | 类别列表（JSON list） |
| `created_at` | INT64 | | 创建时间戳 |
| `placeholder_vector` | FLOAT_VECTOR(2) | | 占位向量（Milvus 要求至少一个向量字段） |

## 2. `images` Collection

每张图片一行，包含元数据和 embedding 向量。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | VARCHAR(300) | **PK** | `{dataset_id}::{image_id}`，如 `uploaded-xxx::train-00029` |
| `dataset_id` | VARCHAR(200) | | 所属数据集 ID |
| `file_hash` | VARCHAR(100) | nullable | 图片文件 SHA-256 哈希 |
| `filename` | VARCHAR(500) | nullable | 文件名，如 `00029.jpg` |
| `filepath` | VARCHAR(2000) | nullable | 前端访问 URL，如 `/api/dataset/image?id=...&path=...` |
| `width` | INT64 | nullable | 图片宽度（像素） |
| `height` | INT64 | nullable | 图片高度（像素） |
| `split` | VARCHAR(50) | nullable | 数据划分：`train` / `validation` / `test` |
| `primary_label` | VARCHAR(200) | nullable | 主检测类别 |
| `detections` | VARCHAR(50000) | nullable | 检测标注（JSON list） |
| `metadata_json` | VARCHAR(20000) | nullable | 元数据（JSON，含 semantics、tags 等） |
| `embedding` | FLOAT_VECTOR(768) | | BGE-VL-large 图像 embedding |
| `embedding_2d` | FLOAT_VECTOR(2) | | PCA 降维后的 2D 坐标 |

### 索引

| 字段 | 索引类型 | 度量方式 |
|------|----------|----------|
| `embedding` | FLAT | L2 |

### detections JSON 结构

```json
[
  {
    "id": "00029-0",
    "label": "wajueji",
    "confidence": 1.0,
    "bbox": [0.12, 0.34, 0.25, 0.45],
    "isGroundTruth": true
  }
]
```

### metadata_json JSON 结构

```json
{
  "source": "vehicle-13631-v18-cls9",
  "captureDate": "2025-04-01",
  "tags": ["train", "wajueji", "construction-site", "day"],
  "semantics": {
    "lighting": "bright",
    "viewpoint": "side",
    "blur": "sharp",
    "weather": "clear",
    "timeOfDay": "day",
    "environment": "construction-site"
  },
  "semanticMeta": {
    "lighting": {"source": "bge-zero-shot", "confidence": 0.85},
    "environment": {"source": "bge-zero-shot", "confidence": 0.72}
  }
}
```

## 3. `embedding_cache` Collection

跨数据集的 embedding 缓存，按文件哈希去重。同一张图片出现在不同数据集时只推理一次。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `file_hash` | VARCHAR(100) | **PK** | 图片文件 SHA-256 哈希 |
| `embedding` | FLOAT_VECTOR(768) | | BGE-VL-large 图像 embedding |

## 数据流

```
上传 ZIP
  → 解压、解析图片/标注
  → 写入 datasets + images（不含 embedding）
  → 计算 embedding：
      查 embedding_cache → 命中则跳过推理
      未命中 → BGE 推理 → 写入 embedding_cache
  → 更新 images 的 embedding 字段
  → PCA 降维 → 更新 images 的 embedding_2d 字段
  → 语义分类 → 更新 images 的 metadata_json

读取数据集
  → datasets 查元数据
  → images 查图片列表
  → 拼装返回前端
```

## 文件路径

| 路径 | 说明 |
|------|------|
| `.milvus-data.db` | Milvus Lite 数据库文件（项目根目录） |
| `.dataset-store/{id}/extracted/` | 图片文件（前端通过 API 读取） |
