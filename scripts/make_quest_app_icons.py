"""Quest 앱 아이콘 생성기. quest-app/public/icons/ 에 PNG를 만든다.

사용: python scripts/make_quest_app_icons.py
Pillow가 필요하다(pip install pillow). 결과 PNG는 저장소에 커밋되어 있으므로 아이콘을 바꿀 때만 실행한다.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "quest-app" / "public" / "icons"

BG_TOP = (23, 34, 44)
BG_BOTTOM = (11, 16, 20)
ACCENT = (79, 179, 255)
WARM = (255, 140, 96)
GREEN = (61, 220, 132)


def gradient_background(size: int) -> Image.Image:
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3))
        for x in range(size):
            pixels[x, y] = color
    return image


def blob(size: int, cx: float, cy: float, rx: float, ry: float, angle: float, color: tuple[int, int, int], alpha: int) -> Image.Image:
    """가우시안처럼 가장자리가 부드러운 타원 한 점(splat)."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    points = []
    for step in range(72):
        theta = step / 72 * math.tau
        px = rx * math.cos(theta)
        py = ry * math.sin(theta)
        points.append((cx + px * math.cos(angle) - py * math.sin(angle), cy + px * math.sin(angle) + py * math.cos(angle)))
    draw.polygon(points, fill=alpha)
    mask = mask.filter(ImageFilter.GaussianBlur(max(rx, ry) * 0.22))
    layer.paste(Image.new("RGBA", (size, size), color + (255,)), (0, 0), mask)
    return layer


def render(size: int, safe: float) -> Image.Image:
    """safe: 내용이 차지하는 비율(maskable은 0.7 안쪽에 둔다)."""
    scale = 4  # 안티앨리어싱용 슈퍼샘플
    big = size * scale
    image = gradient_background(big).convert("RGBA")
    rng = random.Random(7)
    center = big / 2
    radius = big * safe / 2

    # splat 구름
    palette = [ACCENT, ACCENT, WARM, GREEN, (190, 150, 255)]
    for _ in range(34):
        r = radius * (rng.random() ** 0.6) * 0.95
        theta = rng.random() * math.tau
        cx = center + r * math.cos(theta)
        cy = center + r * math.sin(theta) * 0.62 - big * 0.07
        rx = radius * rng.uniform(0.1, 0.22)
        ry = rx * rng.uniform(0.45, 0.9)
        color = rng.choice(palette)
        image.alpha_composite(blob(big, cx, cy, rx, ry, rng.random() * math.pi, color, rng.randint(215, 255)))

    # 헤드셋 실루엣(VR 앱 표시): 아래쪽 둥근 직사각형 띠
    draw = ImageDraw.Draw(image)
    bw, bh = radius * 1.5, radius * 0.5
    top = center + radius * 0.52
    draw.rounded_rectangle((center - bw / 2, top, center + bw / 2, top + bh), radius=bh * 0.45, outline=(232, 238, 242, 255), width=max(2, int(big * 0.012)))
    for sign in (-1, 1):
        draw.ellipse((center + sign * bw * 0.22 - bh * 0.2, top + bh * 0.3, center + sign * bw * 0.22 + bh * 0.2, top + bh * 0.7), outline=(232, 238, 242, 255), width=max(2, int(big * 0.01)))

    return image.convert("RGB").resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    targets = {
        "icon-192.png": (192, 0.86),
        "icon-512.png": (512, 0.86),
        "icon-maskable-512.png": (512, 0.64),
        "apple-touch-icon.png": (180, 0.8),
    }
    for name, (size, safe) in targets.items():
        render(size, safe).save(OUT / name, optimize=True)
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
