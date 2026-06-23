from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config.dataset_settings import BGE_SETTINGS


class BGEImageEmbeddingWrapper(torch.nn.Module):
    def __init__(self, clip_model: torch.nn.Module) -> None:
        super().__init__()
        self.clip_model = clip_model

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        embeddings = self.clip_model.get_image_features(pixel_values=pixel_values)
        return torch.nn.functional.normalize(embeddings, dim=-1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export BGE-VL-large image embedding branch to ONNX.")
    parser.add_argument("--model-path", type=Path, default=BGE_SETTINGS.model_path)
    parser.add_argument("--output", type=Path, default=Path(".model-cache/bge-vl-large-image/model.onnx"))
    parser.add_argument("--device", default=BGE_SETTINGS.device or "cuda:0")
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--batch-size", type=int, default=BGE_SETTINGS.batch_size)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    from transformers import AutoModel

    model = AutoModel.from_pretrained(str(args.model_path), trust_remote_code=True)
    model.set_processor(str(args.model_path))
    model.to(args.device)
    model.eval()

    wrapper = BGEImageEmbeddingWrapper(model).to(args.device)
    dummy_pixel_values = torch.randn(args.batch_size, 3, 224, 224, device=args.device, dtype=torch.float32)

    with torch.no_grad():
        sample_output = wrapper(dummy_pixel_values[:1])
    print(f"sampleOutputShape={tuple(sample_output.shape)}", flush=True)
    print(f"exporting={args.output.resolve()}", flush=True)

    torch.onnx.export(
        wrapper,
        (dummy_pixel_values,),
        str(args.output),
        input_names=["pixel_values"],
        output_names=["image_embeds"],
        dynamic_axes={
            "pixel_values": {0: "batch"},
            "image_embeds": {0: "batch"},
        },
        opset_version=args.opset,
        do_constant_folding=True,
    )
    print(f"done={args.output.resolve()}", flush=True)


if __name__ == "__main__":
    main()
