"""
Generate Atlas × RMP Chrome extension icons.
Uses Pillow only (no cairosvg).
Atlas mark drawn programmatically from SVG geometry.
Star from star-cleaned.png with alpha preserved, pixels forced to solid black.
"""

import math
import os
from PIL import Image, ImageDraw, ImageFilter

ICONS_DIR = os.path.dirname(os.path.abspath(__file__))
STAR_PATH = os.path.join(ICONS_DIR, "star-cleaned.png")

# Atlas blue
ATLAS_BLUE = (60, 109, 234)   # #3C6DEA
BG_COLOR   = (255, 255, 255)  # white background

# ------------------------------------------------------------------
# 1. Build solid-black star from star-cleaned.png
# ------------------------------------------------------------------

def make_black_star(size_px: int) -> Image.Image:
    """Return a square RGBA image (size_px × size_px) with a solid black star."""
    raw = Image.open(STAR_PATH).convert("RGBA")
    # Force every non-transparent pixel to solid black at full opacity before resize
    data = raw.load()
    w, h = raw.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = data[x, y]
            if a > 0:
                data[x, y] = (0, 0, 0, 255)
            else:
                data[x, y] = (0, 0, 0, 0)

    # Resize to target keeping aspect (star source is ~square 120×119)
    star = raw.resize((size_px, size_px), Image.LANCZOS)

    # After downscaling, threshold alpha so small icons don't go gray/blurry
    if size_px <= 32:
        d2 = star.load()
        sw, sh = star.size
        for y in range(sh):
            for x in range(sw):
                r2, g2, b2, a2 = d2[x, y]
                # Any alpha ≥ 64 becomes fully opaque black; below that transparent
                if a2 >= 64:
                    d2[x, y] = (0, 0, 0, 255)
                else:
                    d2[x, y] = (0, 0, 0, 0)

    return star


# ------------------------------------------------------------------
# 2. Draw Atlas mark programmatically
#    SVG viewBox: 161.06 × 41.11
#    The mark is a circle (cx=20.56, cy=20.56, r=20.56) with 3 inner paths.
#    We only need the blue circle + white accent paths for recognizability.
# ------------------------------------------------------------------

def draw_atlas_mark(size_px: int) -> Image.Image:
    """
    Render the Atlas circular mark (blue circle + simplified white triangle paths)
    onto a transparent RGBA canvas of size_px × size_px.

    SVG mark occupies viewBox region roughly 0..41.11 × 0..41.11.
    """
    img = Image.new("RGBA", (size_px, size_px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    scale = size_px / 41.11
    cx = 20.56 * scale
    cy = 20.56 * scale
    r  = 20.56 * scale

    # Blue circle
    draw.ellipse(
        [cx - r, cy - r, cx + r, cy + r],
        fill=ATLAS_BLUE
    )

    # White paths — simplified representation of the three SVG paths inside the circle.
    # The SVG has:
    #   Path 2606 (opacity 0.75): a diagonal stripe from (18.87,5.94) going to lower-right
    #   A semi-transparent horizontal bar at y≈25..30.5
    #   A fully white left-leaning path
    #
    # For small icons we draw two white triangular/wedge shapes that echo the Atlas "A"
    # lightning-bolt design.

    def s(v):
        return v * scale

    # Main white wedge (right side stroke, cls-4 / fully white)
    # Approximates the right diagonal line of the "A" in the mark
    # Points derived from SVG: starts top-center ~(21.86, 5.83), goes to bottom ~(12, 29),
    # then out to (23, 10) — forms a thin triangle
    white_wedge = [
        (s(21.86), s(5.83)),
        (s(23.5),  s(10.0)),
        (s(13.5),  s(29.5)),
        (s(12.0),  s(29.0)),
        (s(21.86), s(5.83)),
    ]
    draw.polygon(white_wedge, fill=(255, 255, 255, 230))

    # Right diagonal stroke (cls-2 opacity 0.75 white)
    # From (18.87,5.94) going toward (33,26) region
    right_stroke = [
        (s(19.5),  s(5.94)),
        (s(22.5),  s(5.5)),
        (s(34.0),  s(25.5)),
        (s(31.5),  s(26.8)),
    ]
    draw.polygon(right_stroke, fill=(255, 255, 255, 180))

    # Horizontal white bar near bottom (cls-3 opacity 0.5)
    bar_y_top = s(25.0)
    bar_y_bot = s(30.56)
    bar_x_left  = s(9.74)
    bar_x_right = s(34.79)
    draw.rectangle(
        [bar_x_left, bar_y_top, bar_x_right, bar_y_bot],
        fill=(255, 255, 255, 128)
    )

    # Small circle at left of bar (dot in the SVG)
    dot_cx = s(9.33)
    dot_cy = s(27.5)
    dot_r  = s(1.5)
    draw.ellipse(
        [dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r],
        fill=(255, 255, 255, 255)
    )

    return img


# ------------------------------------------------------------------
# 3. Composite: Atlas mark (left) + star (right) on white background
# ------------------------------------------------------------------

def make_icon(canvas_px: int, mark_frac: float, star_frac: float,
              gap_frac: float, pad_frac: float) -> Image.Image:
    """
    Compose icon on a white square canvas.

    mark_frac : fraction of canvas height for the Atlas mark diameter
    star_frac : fraction of canvas height for the star size
    gap_frac  : fraction of canvas width for the gap between elements
    pad_frac  : fraction of canvas size for outer padding
    """
    canvas = Image.new("RGBA", (canvas_px, canvas_px), BG_COLOR + (255,))

    pad   = int(canvas_px * pad_frac)
    usable_w = canvas_px - 2 * pad
    usable_h = canvas_px - 2 * pad

    mark_size = int(canvas_px * mark_frac)
    star_size = int(canvas_px * star_frac)
    gap       = int(canvas_px * gap_frac)

    # Total content width
    content_w = mark_size + gap + star_size
    # Center the content block horizontally
    start_x = pad + (usable_w - content_w) // 2

    # Center vertically
    mark_y = pad + (usable_h - mark_size) // 2
    star_y = pad + (usable_h - star_size) // 2

    mark_img = draw_atlas_mark(mark_size)
    star_img = make_black_star(star_size)

    canvas.paste(mark_img, (start_x, mark_y), mark_img)
    star_x = start_x + mark_size + gap
    canvas.paste(star_img, (star_x, star_y), star_img)

    # Convert to RGB (Chrome icons don't need alpha; white BG already set)
    final = Image.new("RGB", (canvas_px, canvas_px), BG_COLOR)
    final.paste(canvas.convert("RGB"), (0, 0))
    return final


# ------------------------------------------------------------------
# 4. Per-size configurations
#    Hybrid approach:
#      512, 256, 128 — mark + star (plenty of space)
#      48            — mark + star, tighter proportions
#      16            — mark + star, maximized sizes, minimal gap
# ------------------------------------------------------------------

CONFIGS = {
    512: dict(mark_frac=0.60, star_frac=0.32, gap_frac=0.06, pad_frac=0.04),
    256: dict(mark_frac=0.60, star_frac=0.32, gap_frac=0.06, pad_frac=0.04),
    128: dict(mark_frac=0.60, star_frac=0.30, gap_frac=0.05, pad_frac=0.05),
     48: dict(mark_frac=0.58, star_frac=0.28, gap_frac=0.06, pad_frac=0.05),
     16: dict(mark_frac=0.55, star_frac=0.30, gap_frac=0.05, pad_frac=0.03),
}


def main():
    for size, cfg in CONFIGS.items():
        out_path = os.path.join(ICONS_DIR, f"icon{size}.png")
        icon = make_icon(size, **cfg)
        icon.save(out_path, "PNG", optimize=True)
        saved = Image.open(out_path)
        print(f"icon{size}.png  {saved.size}  {os.path.getsize(out_path):,} bytes  mode={saved.mode}")


if __name__ == "__main__":
    main()
