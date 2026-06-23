from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


@dataclass(frozen=True)
class BgeSettings:
    model_path: Path = Path(os.environ.get("BGE_VL_MODEL_PATH", "/home/shao/zzq/model/BGE-VL-large"))
    batch_size: int = int(os.environ.get("BGE_BATCH_SIZE", "16"))
    embedding_chunk_size: int = int(os.environ.get("BGE_EMBEDDING_CHUNK_SIZE", "256"))
    device: str | None = os.environ.get("BGE_DEVICE")
    enabled: bool = env_bool("BGE_VL_ENABLE", True)
    preload_on_startup: bool = env_bool("BGE_PRELOAD_ON_STARTUP", True)


@dataclass(frozen=True)
class DatasetSettings:
    store_root: Path = Path(os.environ.get("DATASET_STORE_ROOT", ".dataset-store")).resolve()
    image_extensions: frozenset[str] = frozenset({".jpg", ".jpeg", ".png", ".webp", ".bmp"})
    split_names: tuple[str, ...] = ("train", "val", "validation", "test")


@dataclass(frozen=True)
class GptVisionSettings:
    base_url: str = os.environ.get("GPT_VISION_API_URL", "http://127.0.0.1:3001/v1")
    api_key: str = os.environ.get("GPT_VISION_API_KEY", "")
    model: str = os.environ.get("GPT_VISION_MODEL", "gpt-5.5")
    timeout_seconds: int = int(os.environ.get("GPT_VISION_TIMEOUT_SECONDS", "60"))
    max_image_size: int = int(os.environ.get("GPT_VISION_MAX_IMAGE_SIZE", "768"))


@dataclass(frozen=True)
class SemanticRuntimeSettings:
    provider: str = os.environ.get("SEMANTIC_PROVIDER", "bge")
    config_path: Path = Path(os.environ.get("SEMANTIC_CONFIG_PATH", "backend/semantic_config.local.json"))
    schema_version: str = "semantic-labels-2026-06-22-3"
    gpt_vision: GptVisionSettings = GptVisionSettings()


BGE_SETTINGS = BgeSettings()
DATASET_SETTINGS = DatasetSettings()
SEMANTIC_RUNTIME_SETTINGS = SemanticRuntimeSettings()

SEMANTIC_OPTIONS: dict[str, list[str]] = {
    "lighting": ["bright", "moderate", "dim"],
    "viewpoint": ["front", "side", "rear", "overhead"],
    "blur": ["sharp", "motion-blur", "out-of-focus"],
    "weather": ["clear", "cloudy", "rain", "snow", "fog"],
    "timeOfDay": ["day", "dusk", "night"],
    "environment": ["indoor", "urban-street", "construction-site", "rural-field", "aerial-scene"],
}

SEMANTIC_PROMPTS: dict[str, dict[str, str]] = {
    "lighting": {
        "bright": "a bright well lit image with strong overall illumination and clearly visible details",
        "moderate": "an image with normal balanced daylight or indoor lighting, neither very bright nor very dark",
        "dim": "a dark low light image with weak illumination, night lighting, or heavy shadows",
    },
    "viewpoint": {
        "front": "a vehicle or construction machine seen from the front",
        "side": "a vehicle or construction machine seen from the left or right side",
        "rear": "a vehicle or construction machine seen from behind",
        "overhead": "a vehicle or construction machine seen from above or from an aerial top view",
    },
    "blur": {
        "sharp": "a sharp image with clear object edges and readable details",
        "motion-blur": "an image with directional motion blur caused by movement",
        "out-of-focus": "an image where the object is soft and out of focus",
    },
    "weather": {
        "clear": "an outdoor image in clear sunny weather with good visibility",
        "cloudy": "an outdoor image in cloudy or overcast weather with gray clouds",
        "rain": "an outdoor image in rainy wet weather with water, rain streaks, or wet road",
        "snow": "an outdoor image with snow or icy ground",
        "fog": "an outdoor image with fog, mist, haze, or low visibility",
    },
    "timeOfDay": {
        "day": "a daytime image",
        "dusk": "an image captured at dusk",
        "night": "a nighttime image",
    },
    "environment": {
        "indoor": "an indoor warehouse garage factory or workshop environment",
        "urban-street": "an urban street or city road environment with buildings or traffic",
        "construction-site": "a construction site or work zone with machinery dirt materials or barriers",
        "rural-field": "a rural field farm open land or countryside environment",
        "aerial-scene": "an aerial drone scene or high altitude overhead environment",
    },
}
