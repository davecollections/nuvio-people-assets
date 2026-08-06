#!/usr/bin/env python3
"""Render a deterministic local-image T2 People hero.

Adapted from Prism Wallpapers by bramst0ne:
https://github.com/bramst0ne/prism-wallpapers

The project author granted direct permission on 2026-08-06 to use, copy,
modify, and publicly include the relevant compositor code for this workflow.

This renderer intentionally contains no networking or credential handling. It
accepts a local JSON plan whose source paths must resolve beside that plan.
"""

from __future__ import annotations

import argparse
import json
import math
import platform
import random
from pathlib import Path

import numpy as np
import PIL
from PIL import Image, ImageDraw, ImageFilter


BACKGROUND = (10, 12, 16, 255)
FOCUS_X = 0.75
FOCUS_Y = 0.25
FOCUS_RADIUS = 0.30
FADE_LEFT = 0.30
FADE_RIGHT = 1.0
WARP_STRENGTH = 0.37
POV_X = 1.0
POV_Y = -1.0
DOF_BLUR_MAX = 10.0
DOF_FALLOFF = 1.5
CARD_RADIUS = 8
GAP = 8
COL_STAGGER = 0.35
RANDOM_ASPECT_CHANCE = 0.35


def fail(message: str) -> None:
    raise ValueError(message)


def contained_path(root: Path, value: str) -> Path:
    candidate = (root / value).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError(f"Source path escapes the plan directory: {value}") from error
    if not candidate.is_file():
        fail(f"Source file does not exist: {value}")
    return candidate


def load_plan(plan_path: Path) -> dict:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if plan.get("schemaVersion") != 1:
        fail("Unsupported compositor plan schema")
    if plan.get("mode") not in {"filmography", "profile-only"}:
        fail("Plan mode must be filmography or profile-only")
    if not isinstance(plan.get("seed"), int) or plan["seed"] <= 0:
        fail("Plan seed must be a positive integer")
    sources = plan.get("sources")
    if not isinstance(sources, list) or not sources:
        fail("Plan must contain source records")

    root = plan_path.parent.resolve()
    normalized = []
    seen_ids = set()
    seen_paths = set()
    for source in sources:
        source_id = str(source.get("id", "")).strip()
        if not source_id or source_id in seen_ids:
            fail(f"Source IDs must be non-empty and unique: {source_id}")
        seen_ids.add(source_id)
        record = {"id": source_id}
        for kind in ("portrait", "landscape"):
            value = source.get(kind)
            if value is None:
                continue
            absolute = contained_path(root, value)
            key = str(absolute).casefold()
            if key in seen_paths:
                fail(f"Artwork paths must be unique: {value}")
            seen_paths.add(key)
            record[kind] = absolute
        if "portrait" not in record and "landscape" not in record:
            fail(f"Source has no usable local artwork: {source_id}")
        normalized.append(record)

    accent = plan.get("accent", [20, 60, 80])
    if not (isinstance(accent, list) and len(accent) == 3 and all(isinstance(v, int) and 0 <= v <= 255 for v in accent)):
        fail("Accent must contain three byte values")
    return {**plan, "accent": tuple(accent), "sources": normalized}


def open_rgba(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGBA")


def rounded_mask(width: int, height: int, radius: int) -> Image.Image:
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=radius, fill=255)
    return mask


def make_tile(image: Image.Image, width: int, height: int, opacity: float) -> Image.Image:
    image_width, image_height = image.size
    target_ratio = width / height
    source_ratio = image_width / image_height
    if source_ratio > target_ratio:
        crop_width = int(image_height * target_ratio)
        left = (image_width - crop_width) // 2
        image = image.crop((left, 0, left + crop_width, image_height))
    else:
        crop_height = int(image_width / target_ratio)
        top = (image_height - crop_height) // 2
        image = image.crop((0, top, image_width, top + crop_height))
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    radius = max(2, int(CARD_RADIUS * width / 300))
    tile = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    tile.paste(image, mask=rounded_mask(width, height, radius))
    if opacity < 1:
        red, green, blue, alpha = tile.split()
        alpha = alpha.point(lambda value: int(value * opacity))
        tile = Image.merge("RGBA", (red, green, blue, alpha))
    return tile


def build_slots(width: int, height: int, mode: str, seed: int, source_count: int) -> tuple[list[dict], int, int, int, int, dict]:
    if source_count < 1:
        fail("At least one source is required to build T2 slots")

    scale = height / 1080
    gap = max(1, int(GAP * scale))
    if source_count <= 18:
        column_count = 5
    elif source_count <= 24:
        column_count = 6
    elif source_count <= 30:
        column_count = 7
    else:
        column_count = 8
    column_count = min(column_count, source_count)

    base_rows, extra_rows = divmod(source_count, column_count)
    row_counts = [base_rows + (1 if index < extra_rows else 0) for index in range(column_count)]
    rng = random.Random(seed)
    vertical_span = height * 1.16
    columns = []

    for column_index, row_count in enumerate(row_counts):
        if mode == "profile-only":
            tile_types = ["P"] * row_count
        else:
            base_type = "P" if column_index % 2 == 0 else "L"
            tile_types = []
            for _ in range(row_count):
                flip = rng.random() < RANDOM_ASPECT_CHANCE
                tile_types.append(("L" if base_type == "P" else "P") if flip else base_type)
            if row_count > 1 and len(set(tile_types)) == 1:
                tile_types[-1] = "L" if tile_types[-1] == "P" else "P"

        height_factor = sum(1.5 if tile_type == "P" else 9 / 16 for tile_type in tile_types)
        column_width = int((vertical_span - gap * (row_count - 1)) / height_factor)
        minimum_width = int(height / 6)
        maximum_width = int(height * 0.48)
        column_width = max(minimum_width, min(maximum_width, column_width))
        column_height = sum(int(column_width * (1.5 if tile_type == "P" else 9 / 16)) for tile_type in tile_types) + gap * (row_count - 1)
        columns.append({
            "width": column_width,
            "height": column_height,
            "tileTypes": tile_types,
        })

    total_grid_width = sum(column["width"] for column in columns) + gap * (column_count - 1)
    grid_right = int(width * 1.08)
    grid_left = grid_right - total_grid_width
    bleed_x = max(int(width * 0.20), -grid_left + gap, grid_right - width + gap)
    bleed_y = int(height * 0.24)
    oversized_width = width + bleed_x * 2
    oversized_height = height + bleed_y * 2

    slots = []
    source_x = grid_left
    for column_index, column in enumerate(columns):
        overflow = max(0, column["height"] - height)
        source_y = -overflow * (0.30 if column_index % 2 == 0 else 0.70)
        screen_x = source_x + column["width"] / 2
        norm_x = screen_x / width
        opacity = FADE_LEFT + (FADE_RIGHT - FADE_LEFT) * max(0, min(1, norm_x))

        for tile_type in column["tileTypes"]:
            tile_height = max(4, int(column["width"] * (1.5 if tile_type == "P" else 9 / 16)))
            norm_y = (source_y + tile_height / 2) / height
            slots.append({
                "x": int(source_x + bleed_x),
                "y": int(source_y + bleed_y),
                "width": column["width"],
                "height": tile_height,
                "type": tile_type,
                "onScreen": source_x < width and source_x + column["width"] > 0 and source_y < height and source_y + tile_height > 0,
                "focal": math.hypot(norm_x - FOCUS_X, norm_y - FOCUS_Y) <= FOCUS_RADIUS,
                "opacity": opacity,
            })
            source_y += tile_height + gap
        source_x += column["width"] + gap

    slots.sort(key=lambda slot: (not slot["focal"], -slot["x"], slot["y"]))
    layout = {
        "strategy": "adaptive-unique-source-masonry-v1",
        "sourceCount": source_count,
        "columnCount": column_count,
        "rowCounts": row_counts,
        "slotCount": len(slots),
        "gridLeft": grid_left,
        "gridRight": grid_right,
    }
    return slots, oversized_width, oversized_height, bleed_x, bleed_y, layout


def assign_sources(plan: dict, slots: list[dict]) -> tuple[list[dict], list[str]]:
    rng = random.Random(plan["seed"])
    sources = list(plan["sources"])
    priority_count = max(1, int(len(sources) * 0.35))
    priority = sources[:priority_count]
    remainder = sources[priority_count:]
    rng.shuffle(remainder)
    ordered = priority + remainder
    used = set()
    placements = []

    for slot in slots:
        selected = None
        required_kind = "portrait" if slot["type"] == "P" else "landscape"
        for source in ordered:
            if source["id"] not in used and required_kind in source:
                selected = source
                break
        if selected is None and plan["mode"] == "filmography":
            fallback_kind = "landscape" if required_kind == "portrait" else "portrait"
            for source in ordered:
                if source["id"] not in used and fallback_kind in source:
                    selected = source
                    break
            if selected is not None:
                required_kind = fallback_kind
        if selected is None:
            continue
        used.add(selected["id"])
        placements.append({**slot, "sourceId": selected["id"], "sourcePath": selected[required_kind]})

    return placements, sorted(used)


def perspective_warp(image: Image.Image, offset_x: int, offset_y: int, width: int, height: int) -> Image.Image:
    inset_y = height * WARP_STRENGTH / 2
    inset_x = width * WARP_STRENGTH / 2
    source = [(offset_x, offset_y), (offset_x + width, offset_y), (offset_x + width, offset_y + height), (offset_x, offset_y + height)]
    # Match Prism T2: the right edge stays full-height while the left edge
    # tapers vertically and the bottom edge tapers toward the left viewpoint.
    destination = [(0, inset_y), (width, 0), (width - inset_x, height), (inset_x, height - inset_y)]
    matrix = []
    values = []
    for (source_x, source_y), (dest_x, dest_y) in zip(source, destination):
        matrix.append([dest_x, dest_y, 1, 0, 0, 0, -source_x * dest_x, -source_x * dest_y])
        values.append(source_x)
        matrix.append([0, 0, 0, dest_x, dest_y, 1, -source_y * dest_x, -source_y * dest_y])
        values.append(source_y)
    coefficients = np.linalg.solve(np.array(matrix, dtype=np.float64), np.array(values, dtype=np.float64))
    return image.transform((width, height), Image.Transform.PERSPECTIVE, tuple(coefficients), resample=Image.Resampling.BICUBIC)


def apply_depth_of_field(image: Image.Image, scale: float) -> Image.Image:
    width, height = image.size
    x_values = np.linspace(0, width - 1, width, dtype=np.float32)
    y_values = np.linspace(0, height - 1, height, dtype=np.float32)
    x_grid, y_grid = np.meshgrid(x_values, y_values)
    distance = np.sqrt((x_grid - FOCUS_X * width) ** 2 + (y_grid - FOCUS_Y * height) ** 2) / math.hypot(width, height)
    blur_map = np.clip(distance ** DOF_FALLOFF, 0, 1)
    layer_count = 5
    layers = [image if index == 0 else image.filter(ImageFilter.GaussianBlur((index / layer_count) * DOF_BLUR_MAX * scale)) for index in range(layer_count + 1)]
    arrays = [np.array(layer, dtype=np.float32) for layer in layers]
    output = np.zeros_like(arrays[0])
    for index in range(layer_count):
        low = index / layer_count
        high = (index + 1) / layer_count
        mask = (blur_map >= low) & (blur_map < high)
        blend = ((blur_map - low) / (high - low + 1e-9))[mask]
        output[mask] = arrays[index][mask] * (1 - blend[:, None]) + arrays[index + 1][mask] * blend[:, None]
    output[blur_map >= (layer_count - 1) / layer_count] = arrays[layer_count][blur_map >= (layer_count - 1) / layer_count]
    return Image.fromarray(output.clip(0, 255).astype(np.uint8), image.mode)


def apply_gradient(image: Image.Image, accent: tuple[int, int, int]) -> Image.Image:
    width, height = image.size
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pixels = overlay.load()
    for x in range(int(width * 0.65)):
        alpha = int(240 * ((1 - x / (width * 0.65)) ** 1.4))
        for y in range(height):
            pixels[x, y] = (6, 8, 12, alpha)
    result = Image.alpha_composite(image, overlay)
    bottom = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    bottom_pixels = bottom.load()
    for y in range(int(height * 0.55), height):
        fraction = (y - height * 0.55) / (height * 0.45)
        fraction = max(0.0, min(1.0, fraction))
        alpha = int(215 * fraction ** 1.3)
        for x in range(width):
            bottom_pixels[x, y] = (6, 8, 12, alpha)
    result = Image.alpha_composite(result, bottom)
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    for index in range(18):
        fraction = index / 18
        radius = int(math.hypot(width, height) * (0.05 + 0.38 * fraction))
        alpha = int(14 * (1 - fraction) ** 2.2)
        draw.ellipse((width - radius, -radius, width + radius, radius), fill=(*accent, alpha))
    return Image.alpha_composite(result, glow)


def render(plan: dict, output_path: Path) -> dict:
    width = int(plan.get("width", 2560))
    height = int(plan.get("height", 1440))
    if (width, height) != (2560, 1440):
        fail("The v2 compositor output must be exactly 2560x1440")
    slots, oversized_width, oversized_height, offset_x, offset_y, layout = build_slots(width, height, plan["mode"], plan["seed"], len(plan["sources"]))
    placements, used_ids = assign_sources(plan, slots)
    canvas = Image.new("RGBA", (oversized_width, oversized_height), BACKGROUND)
    for placement in placements:
        tile = make_tile(open_rgba(placement["sourcePath"]), placement["width"], placement["height"], placement["opacity"])
        canvas.paste(tile, (int(placement["x"]), int(placement["y"])), tile)
    warped = perspective_warp(canvas, offset_x, offset_y, width, height)
    blurred = apply_depth_of_field(warped, height / 1080)
    final = apply_gradient(blurred, plan["accent"]).convert("RGB")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    final.save(output_path, "PNG", optimize=True)
    visible_placements = sum(1 for placement in placements if placement["onScreen"])
    visible_slots = sum(1 for slot in slots if slot["onScreen"])
    return {
        "mode": plan["mode"],
        "runtime": {
            "python": platform.python_version(),
            "pillow": PIL.__version__,
            "numpy": np.__version__,
        },
        "sourceCount": len(plan["sources"]),
        "usedSourceCount": len(used_ids),
        "layout": layout,
        "visibleSlots": visible_slots,
        "visiblePlacements": visible_placements,
        "visibleEmptySlots": max(0, visible_slots - visible_placements),
        "placements": [
            {key: value for key, value in placement.items() if key != "sourcePath"}
            for placement in placements
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Render one local-image Nuvio People T2 hero")
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    plan_path = args.plan.resolve()
    output_path = args.output.resolve()
    report_path = args.report.resolve()
    plan = load_plan(plan_path)
    report = render(plan, output_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
