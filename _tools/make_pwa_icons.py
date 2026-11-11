"""Génère les icônes PWA et les écrans de démarrage iOS de StakeMe."""
import os
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "/tmp/Pacifico.ttf"
OUT = "assets/pwa"
WORD = "stakeme"

BG = (15, 23, 42)          # #0f172a
G1 = (182, 255, 60)        # #b6ff3c
G2 = (0, 155, 58)          # #009b3a
ACCENT = (0, 231, 1)


def gradient(size):
    w, h = size
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(G1[i] + (G2[i] - G1[i]) * t) for i in range(3)))
    return img


def backdrop(size):
    """Fond sombre + halo vert radial."""
    w, h = size
    base = Image.new("RGB", (w, h), BG)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    cx, cy = w / 2, h / 2
    radius = min(w, h) * 0.62
    steps = 48
    for i in range(steps, 0, -1):
        r = radius * i / steps
        alpha = round(2.2 * (1 - i / steps) ** 1.6 * 10)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT + (alpha,))
    return Image.alpha_composite(base.convert("RGBA"), glow)


def wordmask(target_w, max_size=900):
    size = max_size
    while size > 10:
        font = ImageFont.truetype(FONT_PATH, size)
        probe = Image.new("L", (size * 4, size * 2), 0)
        ImageDraw.Draw(probe).text((size // 2, size // 2), WORD, font=font, fill=255)
        box = probe.getbbox()
        width = box[2] - box[0]
        if width <= target_w:
            return probe.crop(box)
        size -= 4
    raise SystemExit("font too small")


def put_logo(canvas, ratio, dy=0):
    w = canvas.width
    mask = wordmask(int(w * ratio))
    grad = gradient(mask.size)
    layer = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    layer.paste(grad, (0, 0), mask)
    x = (canvas.width - mask.width) // 2
    y = (canvas.height - mask.height) // 2 + dy
    canvas.alpha_composite(layer, (x, y))
    return canvas


def icon(px, ratio, path):
    canvas = put_logo(backdrop((px, px)), ratio)
    canvas.convert("RGB").save(path, optimize=True)
    print(path, canvas.size)


def splash(w, h, path):
    canvas = put_logo(backdrop((w, h)), 0.60, dy=-int(h * 0.06))
    canvas.convert("RGB").save(path, optimize=True)
    print(path, canvas.size)


os.makedirs(OUT, exist_ok=True)
icon(512, 0.72, f"{OUT}/icon-512.png")
icon(192, 0.78, f"{OUT}/icon-192.png")
icon(512, 0.58, f"{OUT}/icon-maskable-512.png")
icon(180, 0.80, f"{OUT}/apple-touch-icon-180.png")
splash(1170, 2532, f"{OUT}/splash-1170x2532.png")
splash(1284, 2778, f"{OUT}/splash-1284x2778.png")
splash(1125, 2436, f"{OUT}/splash-1125x2436.png")
