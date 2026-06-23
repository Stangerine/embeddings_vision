#!/usr/bin/env python3
"""Sample a split image dataset and rebuild its package.

Expected input layout:
  dataset/
    train|val|test/
      images/<sample>.<image_ext>
      labels/<sample>.txt
      xml/<sample>.xml
    train.txt
    val.txt
    test.txt
    split_manifest.json
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLITS = ("train", "val", "test")


@dataclass(frozen=True)
class Sample:
    stem: str
    source_split: str
    image: Path
    label: Path
    xml: Path


def parse_ratio(value: str) -> tuple[float, float, float]:
    parts = value.split(":")
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("ratio must use train:val:test format")
    try:
        ratio = tuple(float(part) for part in parts)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("ratio values must be numeric") from exc
    if any(part < 0 for part in ratio) or sum(ratio) <= 0:
        raise argparse.ArgumentTypeError("ratio values must be non-negative and not all zero")
    total = sum(ratio)
    return (ratio[0] / total, ratio[1] / total, ratio[2] / total)


def image_files(directory: Path) -> Iterable[Path]:
    for path in sorted(directory.iterdir()):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            yield path


def collect_complete_samples(source: Path) -> list[Sample]:
    samples: list[Sample] = []
    seen: set[str] = set()

    for split in SPLITS:
        images_dir = source / split / "images"
        labels_dir = source / split / "labels"
        xml_dir = source / split / "xml"
        if not images_dir.is_dir():
            raise FileNotFoundError(f"missing images directory: {images_dir}")

        for image in image_files(images_dir):
            stem = image.stem
            label = labels_dir / f"{stem}.txt"
            xml = xml_dir / f"{stem}.xml"
            if not label.is_file() or not xml.is_file():
                continue
            if stem in seen:
                raise ValueError(f"duplicate sample stem across splits: {stem}")
            seen.add(stem)
            samples.append(Sample(stem=stem, source_split=split, image=image, label=label, xml=xml))

    return samples


def split_counts(total: int, ratio: tuple[float, float, float]) -> dict[str, int]:
    train = int(total * ratio[0])
    val = int(total * ratio[1])
    test = total - train - val
    return {"train": train, "val": val, "test": test}


def prepare_output(output: Path, force: bool) -> None:
    if output.exists():
        if not force:
            raise FileExistsError(f"output already exists, use --force to replace: {output}")
        shutil.rmtree(output)

    for split in SPLITS:
        for child in ("images", "labels", "xml"):
            (output / split / child).mkdir(parents=True, exist_ok=True)


def copy_split(samples: list[Sample], split: str, output: Path) -> list[str]:
    stems: list[str] = []
    for sample in samples:
        stems.append(sample.stem)
        shutil.copy2(sample.image, output / split / "images" / sample.image.name)
        shutil.copy2(sample.label, output / split / "labels" / sample.label.name)
        shutil.copy2(sample.xml, output / split / "xml" / sample.xml.name)
    return stems


def write_zip(output: Path, zip_path: Path, force: bool) -> None:
    if zip_path.exists():
        if not force:
            raise FileExistsError(f"zip already exists, use --force to replace: {zip_path}")
        zip_path.unlink()

    root = output.parent
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(output.rglob("*")):
            archive.write(path, path.relative_to(root))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--count", type=int, default=5000)
    parser.add_argument("--ratio", type=parse_ratio, default=parse_ratio("80:10:10"))
    parser.add_argument("--seed", type=int, default=20260623)
    parser.add_argument("--zip-path", type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    if args.count <= 0:
        raise ValueError("--count must be positive")
    if not source.is_dir():
        raise FileNotFoundError(f"source directory not found: {source}")
    if source == output:
        raise ValueError("source and output must be different directories")

    complete_samples = collect_complete_samples(source)
    if len(complete_samples) < args.count:
        raise ValueError(f"only {len(complete_samples)} complete samples available, need {args.count}")

    rng = random.Random(args.seed)
    selected = rng.sample(complete_samples, args.count)
    counts = split_counts(args.count, args.ratio)
    train_end = counts["train"]
    val_end = train_end + counts["val"]
    split_samples = {
        "train": selected[:train_end],
        "val": selected[train_end:val_end],
        "test": selected[val_end:],
    }

    prepare_output(output, args.force)
    split_stems = {split: copy_split(samples, split, output) for split, samples in split_samples.items()}

    for split, stems in split_stems.items():
        (output / f"{split}.txt").write_text("\n".join(stems) + "\n", encoding="utf-8")

    manifest = {
        "source": str(source),
        "output": str(output),
        "seed": args.seed,
        "ratio": {"train": args.ratio[0], "val": args.ratio[1], "test": args.ratio[2]},
        "requested_samples": args.count,
        "complete_samples_available": len(complete_samples),
        "counts": counts,
        "splits": split_stems,
        "note": "Sampled from complete image/label/xml triples and rebuilt as a smaller package.",
    }
    (output / "split_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    zip_path = args.zip_path.resolve() if args.zip_path else output.with_suffix(".zip")
    write_zip(output, zip_path, args.force)

    print(f"source={source}")
    print(f"output={output}")
    print(f"zip={zip_path}")
    print(f"available={len(complete_samples)}")
    print(f"counts={counts}")


if __name__ == "__main__":
    main()
