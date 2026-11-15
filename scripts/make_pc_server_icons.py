"""PC 서버 앱 아이콘 생성기. pc-server/assets/ 에 app.ico, app-256.png, app-32.png를 만든다.

도안: 남색 둥근 사각형 바탕 + 모니터(PC) + 화면 속 splat 점 + 오른쪽 위로 나가는 전송 화살표(Quest로 보냄).
16~24px에서는 점과 받침을 빼고 모니터와 화살표만 남긴 단순 도안을 쓴다.
사용: python scripts/make_pc_server_icons.py   (Pillow 필요, 같은 입력이면 같은 결과)
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "pc-server" / "assets"

BG_TOP = (28, 42, 56)
BG_BOTTOM = (11, 16, 20)
ACCENT = (79, 179, 255)
WARM = (255, 140, 96)
GREEN = (61, 220, 132)
LIGHT = (232, 238, 242)
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
SS = 8  # 슈퍼샘플 배율


def background(big: int) -> Image.Image:
    grad = Image.new("RGBA", (big, big))
    px = grad.load()
    for y in range(big):
        t = y / (big - 1)
        c = tuple(round(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3)) + (255,)
        for x in range(big):
            px[x, y] = c
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.22), fill=255)
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def blob(big: int, cx: float, cy: float, rx: float, ry: float, ang: float, color, alpha: int) -> Image.Image:
    mask = Image.new("L", (big, big), 0)
    pts = []
    for s in range(48):
        th = s / 48 * math.tau
        px, py = rx * math.cos(th), ry * math.sin(th)
        pts.append((cx + px * math.cos(ang) - py * math.sin(ang), cy + px * math.sin(ang) + py * math.cos(ang)))
    ImageDraw.Draw(mask).polygon(pts, fill=alpha)
    mask = mask.filter(ImageFilter.GaussianBlur(max(rx, ry) * 0.2))
    layer = Image.new("RGBA", (big, big), color + (255,))
    layer.putalpha(mask)
    return layer


def render(size: int, simple: bool) -> Image.Image:
    big = size * SS
    img = background(big)
    d = ImageDraw.Draw(img)
    u = big / 100  # 100 단위 좌표계

    # 모니터: 왼쪽 아래에 치우쳐 두고 오른쪽 위에 화살표 자리를 비운다.
    lw = (10 if simple else 4.2) * u
    x0, y0, x1, y1 = (8 * u, 20 * u, 68 * u, 68 * u) if simple else (12 * u, 22 * u, 70 * u, 64 * u)
    d.rounded_rectangle((x0, y0, x1, y1), radius=5 * u, outline=LIGHT, width=round(lw))
    if not simple:
        # 화면 속 splat 구름
        rng = random.Random(11)
        palette = [ACCENT, ACCENT, WARM, GREEN, (190, 150, 255)]
        for _ in range(11):
            cx = rng.uniform(x0 + 10 * u, x1 - 10 * u)
            cy = rng.uniform(y0 + 9 * u, y1 - 9 * u)
            rx = rng.uniform(4, 7.5) * u
            img.alpha_composite(blob(big, cx, cy, rx, rx * rng.uniform(0.5, 0.9), rng.random() * math.pi, rng.choice(palette), rng.randint(215, 255)))
        d = ImageDraw.Draw(img)
        # 받침
        d.rectangle((37 * u, 64 * u, 45 * u, 73 * u), fill=LIGHT)
        d.rounded_rectangle((26 * u, 72 * u, 56 * u, 78 * u), radius=3 * u, fill=LIGHT)

    # 전송 화살표: 오른쪽 위로 향하는 굵은 화살표(주황-초록 대비 대신 밝은 초록).
    ax, ay = (62 * u, 70 * u) if simple else (66 * u, 64 * u)   # 꼬리
    bx, by = (90 * u, 36 * u) if simple else (88 * u, 40 * u)   # 머리 끝
    w = (13 if simple else 6.5) * u
    d.line((ax, ay, bx - 5 * u, by + 5 * u), fill=GREEN, width=round(w))
    ang = math.atan2(by - ay, bx - ax)
    hl, hw = (26 * u, 26 * u) if simple else (17 * u, 15 * u)
    tip = (bx + 4 * u, by - 4 * u)
    base = (tip[0] - hl * math.cos(ang), tip[1] - hl * math.sin(ang))
    nx, ny = -math.sin(ang), math.cos(ang)
    d.polygon([tip, (base[0] + nx * hw / 2, base[1] + ny * hw / 2), (base[0] - nx * hw / 2, base[1] - ny * hw / 2)], fill=GREEN)
    d.ellipse((ax - w / 2, ay - w / 2, ax + w / 2, ay + w / 2), fill=GREEN)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    frames = {s: render(s, simple=s <= 24) for s in ICO_SIZES}
    render(256, False).save(OUT / "app-256.png", optimize=True)
    render(32, False).save(OUT / "app-32.png", optimize=True)
    frames[256].save(OUT / "app.ico", format="ICO", sizes=[(s, s) for s in ICO_SIZES], append_images=[frames[s] for s in ICO_SIZES if s != 256])
    print("saved", OUT)


if __name__ == "__main__":
    main()
