#!/usr/bin/env python3
"""Rasterise the Kandy tray marks into the PNGs shipped in src-tauri/resources.

The two SVGs next to this script are the source of truth for the menu-bar /
tray artwork. They are authored directly in the shipping 64x64 canvas, in flat
black on transparent, because macOS treats the tray icon as a *template image*
(see `set_icon_with_as_template` in src-tauri/src/tray.rs): only the alpha
channel is used and the system recolours the silhouette for the current menu
bar. The colours applied below only matter on Windows (light/dark taskbar) and
Linux (the "Colored" theme in `get_icon_path`).

Requirements: resvg-py and Pillow. No system packages needed.

Usage:  uv run --with resvg-py --with pillow python3 src-tauri/icons/tray/render.py
"""

from __future__ import annotations

import io
from pathlib import Path

import resvg_py
from PIL import Image

HERE = Path(__file__).resolve().parent
RESOURCES = HERE.parent.parent / "resources"

SIZE = 64

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
# Linux "Colored" theme pink, matching the untouched recording.png /
# transcribing.png state icons.
PINK = (250, 162, 202)

# source svg -> [(output png, rgb)]
TARGETS = {
    "kandy-mark.svg": [
        ("tray_idle.png", WHITE),  # dark menu bar / taskbar
        ("tray_idle_dark.png", BLACK),  # light menu bar / taskbar
        ("handy.png", PINK),  # Linux colored theme
    ],
    # No PINK variant here: the Linux "Colored" theme has no warning icon.
    # Secure Input is macOS-only, so `get_icon_path` falls back to handy.png
    # for (Colored, warning) and would never load one.
    "kandy-mark-warning.svg": [
        ("tray_idle_warning.png", WHITE),
        ("tray_idle_warning_dark.png", BLACK),
    ],
}


def rasterise(svg: Path) -> Image.Image:
    png = resvg_py.svg_to_bytes(svg_string=svg.read_text(), width=SIZE, height=SIZE)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main() -> int:
    for svg_name, outputs in TARGETS.items():
        base = rasterise(HERE / svg_name)
        alpha = base.getchannel("A")
        print(f"{svg_name} ink bbox {alpha.getbbox()}")
        for png_name, rgb in outputs:
            tinted = Image.new("RGBA", base.size, rgb + (0,))
            tinted.putalpha(alpha)
            target = RESOURCES / png_name
            tinted.save(target)
            print(f"{target.relative_to(RESOURCES.parent.parent)}  {tinted.size}  {rgb}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
