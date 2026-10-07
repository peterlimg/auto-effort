#!/usr/bin/env python3
"""Paints the site's watercolor illustrations into site/art/ with OpenCV.

  site/paint.py

Each picture is drawn as flat shapes, then every shape goes through the same wash:
its edge is wobbled with low-frequency noise (cv2.remap), pigment pools at the rim
(distance transform), granulates on a paper texture, and is multiplied onto the paper
like a transparent glaze. Ink lines get a jittered, slightly bled pen stroke.
The data pictures (the token stacks, the cache shelf) are drawn to the benchmark's numbers.
"""
import math
from pathlib import Path

import cv2
import numpy as np

ART = Path(__file__).resolve().parent / 'art'
PAPER = np.array([255, 253, 249], np.float32) / 255  # RGB; near white, the page multiplies it onto its own paper
# One pigment per effort level, low -> max; the page's CSS uses the same colors.
LEVEL = {
    'low': (122, 158, 126),     # sap green
    'medium': (214, 168, 74),   # yellow ochre
    'high': (205, 110, 72),     # burnt sienna
    'xhigh': (176, 58, 66),     # alizarin
    'max': (110, 72, 128),      # dioxazine violet
}
INK = (52, 46, 44)
INDIGO = (62, 84, 122)
SLATE = (122, 136, 150)


def noise(h, w, scale, rng):
    """Smooth noise in [-1, 1]: random values on a coarse grid, upscaled and blurred."""
    small = rng.standard_normal((max(2, h // scale), max(2, w // scale))).astype(np.float32)
    big = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    big = cv2.GaussianBlur(big, (0, 0), scale / 3)
    return big / (np.abs(big).max() + 1e-6)


class Sheet:
    def __init__(self, w, h, seed):
        self.w, self.h = w, h
        self.rng = np.random.default_rng(seed)
        fibre = noise(h, w, 3, self.rng) * 0.5 + noise(h, w, 24, self.rng) * 0.5
        self.tooth = (fibre * 0.5 + 0.5).astype(np.float32)  # paper grain, 0..1
        self.img = np.ones((h, w, 3), np.float32) * PAPER
        self.img *= (1 - 0.035 * self.tooth)[..., None]
        vignette = noise(h, w, max(w, h) // 3, self.rng)
        self.img *= (1 - 0.02 * vignette)[..., None]
        self.blank = self.img.reshape(-1, 3).mean(0)  # the bare paper's average tone

    def mask(self):
        return np.zeros((self.h, self.w), np.uint8)

    def wash(self, mask, color, strength=0.75, wobble=6, rim=0.55, bloom=True):
        """Glaze one flat shape onto the sheet as a watercolor wash."""
        h, w = self.h, self.w
        m = mask.astype(np.float32) / 255
        if m.max() == 0:
            return
        # wobble the edge: displace the shape with smooth noise
        dx, dy = noise(h, w, 40, self.rng) * wobble, noise(h, w, 40, self.rng) * wobble
        gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
        m = cv2.remap(m, gx + dx, gy + dy, cv2.INTER_LINEAR)
        # a soft, irregular edge: blur then cut with a noisy threshold
        soft = cv2.GaussianBlur(m, (0, 0), 2.2)
        cut = 0.5 + 0.18 * noise(h, w, 9, self.rng)
        body = np.clip((soft - cut) * 6 + 0.5, 0, 1) * 0.85 + soft * 0.15
        # pigment pools at the rim where the wash dried last
        inside = (body > 0.5).astype(np.uint8)
        dist = cv2.distanceTransform(inside, cv2.DIST_L2, 5)
        edge = np.exp(-dist / 5.0) * inside
        # uneven density across the wash, granulation in the paper's tooth
        flow = 0.78 + 0.22 * noise(h, w, 70, self.rng)
        gran = 0.82 + 0.36 * self.tooth
        density = body * flow * gran * (1 + rim * edge) * strength
        if bloom:  # a backrun or two: a pale blossom with a dark fringe
            for _ in range(self.rng.integers(0, 2)):
                ys, xs = np.nonzero(inside)
                if len(xs) < 50:
                    break
                i = self.rng.integers(len(xs))
                r = int(self.rng.uniform(0.04, 0.09) * min(h, w))
                blob = np.zeros((h, w), np.float32)
                cv2.circle(blob, (int(xs[i]), int(ys[i])), r, 1, -1)
                bx, by = noise(h, w, 25, self.rng) * r * 0.45, noise(h, w, 25, self.rng) * r * 0.45
                blob = cv2.remap(blob, gx + bx, gy + by, cv2.INTER_LINEAR)
                blob = cv2.GaussianBlur(blob, (0, 0), 3)
                fringe = np.clip(blob * (1 - blob) * 4, 0, 1)
                density *= 1 - 0.22 * blob + 0.3 * fringe
        density = np.clip(density, 0, 0.97)[..., None]
        c = np.array(color, np.float32) / 255
        self.img *= 1 - density * (1 - c)  # subtractive glaze

    def fill(self, draw, color, **kw):
        m = self.mask()
        draw(m)
        self.wash(m, color, **kw)

    def ink(self, pts, width=2.0, color=INK, alpha=0.8, jitter=1.2, closed=False):
        """A pen line along pts with hand jitter and a little bleed."""
        pts = np.asarray(pts, np.float32)
        if closed:
            pts = np.vstack([pts, pts[:1]])
        dense = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            n = max(2, int(np.linalg.norm(b - a) / 6))
            for t in np.linspace(0, 1, n)[1:]:
                dense.append(a + (b - a) * t)
        dense = np.array(dense)
        # a hand's wander: smooth offsets through a few control points, not a random walk
        length = np.r_[0, np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))]
        knots = np.linspace(0, length[-1], max(3, int(length[-1] / 90)))
        wob = np.stack([np.interp(length, knots, self.rng.normal(0, jitter, len(knots))) for _ in range(2)], 1)
        wob += self.rng.normal(0, jitter * 0.15, wob.shape)
        line = self.mask()
        cv2.polylines(line, [(dense + wob).astype(np.int32)], False, 255, max(1, int(round(width))), cv2.LINE_AA)
        a = cv2.GaussianBlur(line.astype(np.float32) / 255, (0, 0), 0.7)
        a = np.clip(a * (0.75 + 0.35 * self.tooth), 0, 1) * alpha
        c = np.array(color, np.float32) / 255
        self.img = self.img * (1 - a[..., None]) + c * a[..., None]

    def save(self, name, width=None):
        # bare paper becomes white, give or take its grain, so the page can multiply the picture onto its own paper
        out = np.clip(self.img / self.blank * 255, 0, 255).astype(np.uint8)
        out = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
        if width:
            out = cv2.resize(out, (width, int(self.h * width / self.w)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(ART / name), out, [cv2.IMWRITE_JPEG_QUALITY, 88])
        print('art/' + name)


def arc_pts(cx, cy, r, a0, a1, n=80, ry=None):
    ry = r if ry is None else ry
    return [(cx + r * math.cos(a), cy - ry * math.sin(a)) for a in np.linspace(a0, a1, n)]


def dial():
    """The hero: a five-band effort dial, needle swinging down from high."""
    s = Sheet(2000, 1100, 7)
    cx, cy, r0, r1 = 1000, 900, 430, 700
    names = list(LEVEL)
    for i, name in enumerate(names):
        a0 = math.pi - i * math.pi / 5 - 0.012
        a1 = math.pi - (i + 1) * math.pi / 5 + 0.012
        poly = arc_pts(cx, cy, r1, a0, a1) + arc_pts(cx, cy, r0, a1, a0)
        s.fill(lambda m: cv2.fillPoly(m, [np.int32(poly)], 255), LEVEL[name], strength=0.8, wobble=9)
    # the hub and the faint old needle position (high), then the needle at medium
    s.fill(lambda m: cv2.circle(m, (cx, cy), 70, 255, -1), INDIGO, strength=0.85)
    ghost = math.pi - 2.5 * math.pi / 5
    s.ink([(cx, cy), (cx + 600 * math.cos(ghost), cy - 600 * math.sin(ghost))], 3, SLATE, alpha=0.35, jitter=2)
    ang = math.pi - 1.5 * math.pi / 5
    tip = (cx + 640 * math.cos(ang), cy - 640 * math.sin(ang))
    perp = (math.sin(ang) * 26, math.cos(ang) * 26)
    needle = [(cx + perp[0], cy + perp[1]), tip, (cx - perp[0], cy - perp[1])]
    s.fill(lambda m: cv2.fillPoly(m, [np.int32(needle)], 255), INK, strength=0.9, wobble=3, bloom=False)
    # a swing mark from the ghost to the needle
    s.ink(arc_pts(cx, cy, 760, ghost - 0.04, ang + 0.06, 40), 2.4, INK, alpha=0.6, jitter=2.5)
    for i in range(11):
        a = math.pi - i * math.pi / 10
        s.ink([(cx + 715 * math.cos(a), cy - 715 * math.sin(a)), (cx + 745 * math.cos(a), cy - 745 * math.sin(a))], 2.5)
    s.ink(arc_pts(cx, cy, r1 + 8, math.pi, 0, 160), 2, alpha=0.55, jitter=3)
    s.ink(arc_pts(cx, cy, r0 - 8, math.pi, 0, 120), 1.6, alpha=0.45, jitter=3)
    s.ink([(150, cy + 2), (1850, cy - 4)], 2, alpha=0.5, jitter=4)
    s.save('dial.jpg', 1600)


def scale():
    """The judge: a balance weighing a one-word note against a tall stack of pages."""
    s = Sheet(1600, 1100, 11)
    cx, top = 800, 230
    tilt = -0.17  # the heavy side (right) sits low
    half = 520
    lx, ly = cx - half * math.cos(tilt), top + half * math.sin(tilt)
    rx, ry = cx + half * math.cos(tilt), top - half * math.sin(tilt)
    s.fill(lambda m: cv2.fillPoly(m, [np.int32([(cx - 26, top), (cx + 26, top), (cx + 40, 960), (cx - 40, 960)])], 255), (150, 120, 92), strength=0.7)
    s.fill(lambda m: cv2.ellipse(m, (cx, 975), (230, 42), 0, 0, 360, 255, -1), (120, 96, 76), strength=0.75)
    s.fill(lambda m: cv2.line(m, (int(lx), int(ly)), (int(rx), int(ry)), 255, 22), (110, 86, 66), strength=0.8, bloom=False)
    s.fill(lambda m: cv2.circle(m, (cx, top), 30, 255, -1), INDIGO)
    pans = []
    for px, py in ((lx, ly), (rx, ry)):
        bottom = py + 380
        for dxs in (-185, 185):
            s.ink([(px, py), (px + dxs, bottom)], 1.8, alpha=0.6)
        s.fill(lambda m: cv2.ellipse(m, (int(px), int(bottom)), (190, 60), 0, 0, 180, 255, -1), INDIGO, strength=0.7)
        s.ink(arc_pts(px, bottom, 190, math.pi, 2 * math.pi, 60, ry=60), 1.5, alpha=0.45)
        pans.append((px, bottom))
    # the light side: a small slip of paper
    (px, py), (qx, qy) = pans
    slip = [(px - 60, py - 8), (px + 50, py - 14), (px + 56, py - 70), (px - 52, py - 62)]
    s.fill(lambda m: cv2.fillPoly(m, [np.int32(slip)], 255), LEVEL['low'], strength=0.55)
    s.ink(slip, 1.6, closed=True, alpha=0.6)
    s.ink([(px - 30, py - 40), (px + 20, py - 44)], 2.2, alpha=0.7, jitter=0.6)
    # the heavy side: a leaning stack of pages
    for i in range(12):
        y = qy - 12 - i * 26
        off = math.sin(i * 1.7) * 14
        page = [(qx - 140 + off, y), (qx + 140 + off, y - 4), (qx + 138 + off, y - 24), (qx - 142 + off, y - 20)]
        color = LEVEL['high'] if i % 3 else LEVEL['xhigh']
        s.fill(lambda m: cv2.fillPoly(m, [np.int32(page)], 255), color, strength=0.45, wobble=3, bloom=False)
        s.ink(page[:2], 1.2, alpha=0.45)
    s.save('scale.jpg', 1400)


def stacks(off_tokens, on_tokens):
    """Thinking tokens in the high-effort run, as two stacks of coins drawn to scale."""
    s = Sheet(1600, 1300, 23)
    per_coin = 400  # tokens per coin; app.js places the labels with the same numbers
    base, coin_h = 1200, 30
    for x, tokens, color in ((520, off_tokens, LEVEL['high']), (1080, on_tokens, LEVEL['medium'])):
        n = round(tokens / per_coin)
        for i in range(n):
            y = base - i * coin_h
            jx = int(math.sin(i * 0.9 + x) * 5)
            side = [(x + jx - 150, y), (x + jx + 150, y), (x + jx + 150, y - coin_h), (x + jx - 150, y - coin_h)]
            s.fill(lambda m: (cv2.fillPoly(m, [np.int32(side)], 255), cv2.ellipse(m, (x + jx, y), (150, 30), 0, 0, 180, 255, -1)),
                   color, strength=0.5, wobble=1.5, rim=0.6, bloom=False)
            s.ink(arc_pts(x + jx, y, 150, math.pi, 2 * math.pi, 40, ry=30), 1.0, alpha=0.3, jitter=0.5)
        top = base - n * coin_h
        s.fill(lambda m: cv2.ellipse(m, (x, top), (150, 30), 0, 0, 360, 255, -1), color, strength=0.35, wobble=1.5, bloom=False)
        s.ink(arc_pts(x, top, 150, 0, 2 * math.pi, 80, ry=30), 1.3, alpha=0.5, jitter=0.6)
        s.ink([(x - 230, base + 40), (x + 230, base + 40)], 2, alpha=0.5, jitter=2)
    s.save('stacks.jpg', 1400)


def shelf(cached=0.984):
    """The prompt cache: a shelf of books read back as-is, and the sliver that was new."""
    s = Sheet(1800, 900, 31)
    x, base = 120, 760
    total_w = 1560
    rng = np.random.default_rng(3)
    widths = []
    while sum(widths) < total_w * cached:
        widths.append(int(rng.uniform(34, 70)))
    for i, w in enumerate(widths):
        h = int(rng.uniform(330, 520))
        lean = 0 if i % 9 else 18
        book = [(x, base), (x + w - 4, base), (x + w - 4 + lean, base - h), (x + lean, base - h)]
        tint = INDIGO if i % 4 else SLATE
        s.fill(lambda m: cv2.fillPoly(m, [np.int32(book)], 255), tint, strength=0.42 + 0.2 * rng.random(), wobble=3, bloom=False)
        s.ink([(x + 8 + lean * 0.8, base - h * 0.8), (x + w - 12 + lean * 0.8, base - h * 0.8)], 1.2, alpha=0.35)
        x += w
    new = [(x + 6, base), (x + 30, base), (x + 30, base - 470), (x + 6, base - 470)]
    s.fill(lambda m: cv2.fillPoly(m, [np.int32(new)], 255), LEVEL['xhigh'], strength=0.85, wobble=2, bloom=False)
    s.fill(lambda m: cv2.rectangle(m, (80, base), (1720, base + 34), 255, -1), (128, 98, 74), strength=0.75)
    s.ink([(80, base), (1720, base)], 2, alpha=0.6, jitter=2)
    s.save('shelf.jpg', 1600)


def swatches():
    """One loose brush swatch per effort level, for legends and the band."""
    for i, (name, color) in enumerate(LEVEL.items()):
        s = Sheet(360, 160, 100 + i)
        rng = np.random.default_rng(i)
        # bleeds off the right and left so the page can crop it to any bar length
        pts = [(-40, 22 + rng.uniform(-6, 6)), (400, 18 + rng.uniform(-6, 6)), (400, 142), (-40, 138 + rng.uniform(-6, 6))]
        s.fill(lambda m: cv2.fillPoly(m, [np.int32(pts)], 255), color, strength=0.85, wobble=10)
        s.save(f'swatch-{name}.jpg')


def main():
    import json
    ART.mkdir(exist_ok=True)
    data = json.loads((ART.parent / 'data.js').read_text().split('=', 1)[1].rstrip().rstrip(';'))
    high = data['runs']['high']
    thinking = {a: sum(r['thinking_tokens'] for r in high if r['arm'] == a) for a in ('off', 'on')}
    dial()
    scale()
    stacks(thinking['off'], thinking['on'])
    shelf()
    swatches()


if __name__ == '__main__':
    main()
