#!/usr/bin/env python3
"""Draws the sample cards into web/samples/samples.js.

    python3 scripts/samples.py            # writes web/samples/samples.js
    python3 scripts/samples.py --preview DIR   # and a PNG of each

Every picture here is drawn by this script (or, for web/samples/*.png,
supplied by the project's author for this purpose): no one else's art.
They differ on purpose — size 16 to 64, own or built-in palette, empty
cells or not, still or animated, frame shade — so the app is tried on all
of it. A picture is rows of characters: '.' an empty cell, otherwise an
index into its colours ('0'-'9', then 'a'-'v').
"""

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIGITS = '0123456789abcdefghijklmnopqrstuv'
EMPTY = None


class Pic:
    def __init__(self, size, fill=EMPTY):
        self.n = size
        self.px = [[fill] * size for _ in range(size)]

    def set(self, x, y, c):
        if 0 <= x < self.n and 0 <= y < self.n:
            self.px[y][x] = c

    def get(self, x, y):
        return self.px[y][x] if 0 <= x < self.n and 0 <= y < self.n else EMPTY

    def rect(self, x, y, w, h, c):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.set(i, j, c)

    def disc(self, cx, cy, r, c):
        for j in range(self.n):
            for i in range(self.n):
                if (i - cx) ** 2 + (j - cy) ** 2 <= r * r:
                    self.set(i, j, c)

    def outline(self, c, inside=None):
        """Draws c around every cell that is not empty (and, with `inside`, only those of that colour)."""
        add = []
        for j in range(self.n):
            for i in range(self.n):
                if self.px[j][i] is not EMPTY:
                    continue
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    v = self.get(i + di, j + dj)
                    if v is not EMPTY and v != c and (inside is None or v in inside):
                        add.append((i, j))
                        break
        for i, j in add:
            self.set(i, j, c)

    def copy(self):
        p = Pic(self.n)
        p.px = [row[:] for row in self.px]
        return p

    def rows(self):
        return [''.join('.' if v is EMPTY else DIGITS[v] for v in row) for row in self.px]


def bayer(x, y):
    """4×4 ordered dither threshold, 0..15."""
    m = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    return m[y % 4][x % 4]


def band(colors, t, x, y):
    """A colour from an ordered list by t in 0..1, dithered between neighbours."""
    t = min(max(t, 0), 0.9999) * (len(colors) - 1)
    k, f = int(t), t - int(t)
    return colors[k + 1] if f * 16 > bayer(x, y) + 0.5 else colors[k]


def svg_rects(d):
    """'M5 1h6v1h-6z…' (as drawn in the editor mock-up) → cells."""
    out = []
    for part in d.split('z'):
        part = part.strip()
        if not part:
            continue
        m, rest = part[1:].split('h', 1)
        x, y = map(int, m.split())
        w = int(rest.split('v')[0])
        out += [(x + i, y) for i in range(w)]
    return out


# ------------------------------------------------------------- pictures --

def mushroom():
    """The red cap from the editor mock-up; the cap nods while the stem stays."""
    colors = ['#2a1d1b', '#c4392f', '#f6f3eb', '#8c2a25', '#efe7d6', '#b9ad98']
    cap = [
        (0, 'M5 1h6v1h-6zM3 2h2v1h-2zM11 2h2v1h-2zM2 3h1v1h-1zM13 3h1v1h-1zM1 4h1v1h-1zM14 4h1v1h-1zM1 5h1v1h-1zM14 5h1v1h-1zM0 6h1v1h-1zM15 6h1v1h-1zM0 7h1v1h-1zM15 7h1v1h-1zM1 8h1v1h-1zM14 8h1v1h-1z'),
        (1, 'M5 2h6v1h-6zM3 3h2v1h-2zM7 3h6v1h-6zM2 4h2v1h-2zM7 4h4v1h-4zM13 4h1v1h-1zM2 5h3v1h-3zM6 5h5v1h-5zM13 5h1v1h-1zM1 6h7v1h-7zM9 6h6v1h-6zM1 7h1v1h-1zM4 7h11v1h-11z'),
        (2, 'M5 3h2v1h-2zM4 4h3v1h-3zM11 4h2v1h-2zM5 5h1v1h-1zM11 5h2v1h-2zM8 6h1v1h-1zM2 7h2v1h-2z'),
        (3, 'M2 8h12v1h-12z'),
    ]
    stem = [
        (0, 'M2 9h4v1h-4zM10 9h4v1h-4zM5 10h1v1h-1zM10 10h1v1h-1zM4 11h1v1h-1zM11 11h1v1h-1zM4 12h1v1h-1zM11 12h1v1h-1zM4 13h1v1h-1zM11 13h1v1h-1zM5 14h6v1h-6z'),
        (4, 'M6 9h4v1h-4zM6 10h4v1h-4zM5 11h4v1h-4zM5 12h4v1h-4zM5 13h3v1h-3z'),
        (5, 'M9 11h2v1h-2zM9 12h2v1h-2zM8 13h3v1h-3z'),
    ]
    frames = []
    for dy in (0, 1):  # a nod: the cap sinks onto the stem and comes back
        p = Pic(16)
        for c, d in stem:
            for x, y in svg_rects(d):
                p.set(x, y, c)
        for c, d in cap:
            for x, y in svg_rects(d):
                p.set(x, y + dy, c)
        frames.append(p)
    return colors, frames


def moon():
    """A night sea: a dithered sky, the moon and its broken path on the water."""
    colors = ['#0d1022', '#1b2142', '#2e3a6b', '#4a5d96', '#f3e9c6', '#c9bd94', '#0a1a2c', '#163450', '#2a5b78', '#e7dcb0']
    sky, sea = [0, 1, 2, 3], [6, 7, 8]
    p = Pic(32)
    horizon = 21
    for y in range(32):
        for x in range(32):
            if y < horizon:
                p.set(x, y, band(sky, (y / horizon) ** 1.3, x, y))
            else:
                p.set(x, y, band(sea, (y - horizon) / (31 - horizon), x, y))
    for x, y in ((3, 3), (9, 6), (14, 2), (27, 15), (5, 12), (17, 9), (29, 3)):
        p.set(x, y, 9 if (x + y) % 3 else 4)
    p.disc(22, 8, 4.6, 4)
    for x, y in ((20, 7), (21, 7), (23, 10), (24, 9), (21, 10)):
        p.set(x, y, 5)
    for k, y in enumerate(range(horizon + 1, 32, 2)):
        w = 2 + k
        x0 = 22 - w // 2 + (k % 2)
        for x in range(x0, x0 + w):
            if (x * 7 + y) % 5:
                p.set(x, y, 9 if k < 2 else 5)
    return colors, [p]


def ridge(x, base, amp, seed):
    return base - amp * (0.55 * math.sin(x / 7.3 + seed) + 0.3 * math.sin(x / 3.1 + seed * 2.3) + 0.15 * math.sin(x / 1.7 + seed * 5.1))


def mountains():
    """Three ridges at dawn, the farthest with snow; the sun behind them."""
    colors = ['#2b1d3a', '#5a2f55', '#a14d63', '#e3825c', '#f6c27a', '#fff1c9',
              '#453a63', '#2f2b4c', '#1d1b31', '#f2eef5', '#8c86ad']
    sky = [0, 1, 2, 3, 4]
    p = Pic(48)
    for y in range(48):
        for x in range(48):
            p.set(x, y, band(sky, (y / 34) ** 0.9, x, y))
    p.disc(30, 21, 6.5, 4)
    p.disc(30, 21, 5, 5)
    for x in range(48):
        top = int(ridge(x, 27, 9, 1.2))
        for y in range(top, 48):
            # the highest of the far ridge holds snow; a lit edge elsewhere
            p.set(x, y, 9 if top < 23 and y < top + 2 + (x % 2) else 10 if y == top else 6)
        top = int(ridge(x, 35, 6, 4.0))
        for y in range(top, 48):
            p.set(x, y, 7)
        top = int(ridge(x, 42, 4, 7.7))
        for y in range(top, 48):
            p.set(x, y, 8)
    return colors, [p]


def mountains_night(colors):
    return ['#070a17', '#0e1430', '#172152', '#22306e', '#2d3d82', '#e8eefc',
            '#202a4f', '#151c38', '#0b0f22', '#c7d3f2', '#5d6ea8']


def aurora():
    """Ribbons of light over a pine ridge and snow."""
    colors = ['#05070f', '#0b1424', '#13253a', '#1d8a6b', '#43d39a', '#a8f5c8', '#6e4fb3',
              '#e9f1f7', '#b9c7d6', '#163c2d', '#24594a', '#ffffff']
    p = Pic(64)
    for y in range(64):
        for x in range(64):
            p.set(x, y, band([0, 1, 2], y / 46, x, y))
    for x, y in ((4, 5), (12, 14), (20, 3), (33, 9), (41, 2), (50, 12), (58, 6), (7, 26), (61, 22), (27, 18)):
        p.set(x, y, 11 if x % 2 else 8)
    for k, (base, amp, ph) in enumerate(((16, 6, 0.0), (24, 5, 2.1))):
        for x in range(64):
            c = base + amp * math.sin(x / 9 + ph) + 2 * math.sin(x / 3.7 + ph * 3)
            for d in range(-7, 3):
                y = int(c + d)
                t = (d + 7) / 9
                col = 5 if t > 0.8 else 4 if t > 0.5 else 3 if t > 0.2 else (6 if k else 3)
                if t < 0.2 and bayer(x, y) > 9:
                    continue
                p.set(x, y, col)
    # snow and a line of pines
    for x in range(64):
        top = int(52 + 2 * math.sin(x / 11))
        for y in range(top, 64):
            p.set(x, y, 7 if y < top + 2 or bayer(x, y) < 12 else 8)
    for cx, h in ((5, 14), (13, 10), (20, 16), (29, 11), (37, 15), (46, 9), (52, 13), (60, 11)):
        base = int(52 + 2 * math.sin(cx / 11))
        for j in range(h):
            w = (j * 3) // 5 + 1
            y = base - h + j
            for x in range(cx - w // 2, cx + w // 2 + 1):
                p.set(x, y, 10 if (x + j) % 4 else 9)
        p.set(cx, base, 9)
    return colors, [p]


def cactus():
    """A cactus in a clay pot, in PICO-8's colours (built-in palette 16)."""
    # PICO-8: 0 black, 1 navy, 2 plum, 3 green, 4 brown, 5 grey, 6 light grey, 7 white,
    # 8 red, 9 orange, 10 yellow, 11 lime, 12 blue, 13 lavender, 14 pink, 15 peach
    p = Pic(24)
    body = [(9, 4, 6, 14)]
    for x, y, w, h in body:
        p.rect(x, y, w, h, 3)
    p.rect(10, 3, 4, 1, 3)
    p.rect(4, 9, 3, 6, 3)
    p.rect(4, 14, 5, 2, 3)
    p.rect(16, 7, 3, 5, 3)
    p.rect(15, 11, 4, 2, 3)
    for y in range(4, 18):
        p.set(11, y, 11)
    for x, y in ((10, 6), (13, 8), (10, 11), (13, 13), (5, 11), (17, 9), (12, 15)):
        p.set(x, y, 7)
    p.disc(11.5, 2.5, 1.6, 14)
    p.set(11, 2, 10)
    p.outline(0, inside={3, 11, 7, 14, 10})
    p.rect(6, 18, 12, 2, 9)
    p.rect(7, 20, 10, 3, 4)
    p.rect(7, 20, 10, 1, 2)
    p.outline(0, inside={9, 4, 2})
    return 16, [p]


def heart():
    """A heart that beats: two frames, small and big."""
    colors = ['#3a0f1e', '#d6304f', '#ff7a8a', '#ffd3d8']
    small = ['................', '................', '................', '................',
             '....11....11....', '...1221..1111...', '...1231111111...', '...1211111111...',
             '....11111111....', '.....111111.....', '......1111......', '.......11.......',
             '................', '................', '................', '................']
    big = ['................', '................', '...111....111...', '..12221..11111..',
           '..12331111111111', '..12311111111111', '..12111111111111', '...111111111111.',
           '....1111111111..', '.....11111111...', '......111111....', '.......1111.....',
           '........11......', '................', '................', '................']
    frames = []
    for rows in (small, big, big, small):
        p = Pic(16)
        for y, r in enumerate(rows):
            for x, ch in enumerate(r):
                if ch != '.':
                    p.set(x, y, int(ch))
        p.outline(0)
        frames.append(p)
    return colors, frames


def heart_gameboy(frames):
    """The same heart on Game Boy green: built-in palette 21, every cell filled."""
    out = []
    for f in frames:
        p = Pic(16, 0)
        for y in range(16):
            for x in range(16):
                v = f.get(x, y)
                p.set(x, y, 0 if v is EMPTY else {0: 3, 1: 2, 2: 1, 3: 0}[v])
        out.append(p)
    return 21, out


def key():
    """A brass key, for the app that keeps one."""
    colors = ['#2c1b0e', '#b07a2a', '#e3b04b', '#fbe3a1']
    p = Pic(24)
    p.disc(7, 8, 5.2, 1)
    p.disc(7, 8, 2.2, EMPTY)
    p.rect(11, 7, 10, 3, 1)
    p.rect(17, 10, 2, 3, 1)
    p.rect(20, 10, 1, 4, 1)
    for x in range(12, 21):
        p.set(x, 7, 2)
    for x, y in ((4, 5), (5, 4), (6, 4), (3, 6), (3, 7)):
        p.set(x, y, 3)
    for x, y in ((8, 4), (9, 4), (10, 5), (4, 11), (10, 11)):
        p.set(x, y, 2)
    p.set(13, 7, 3)
    p.outline(0)
    return colors, [p]


def boat():
    """A paper boat on a small sea; the waves move, the boat rocks."""
    colors = ['#e8f1f4', '#bfe0ea', '#8cc6d8', '#2f7ea0', '#1d5b7a', '#14405a', '#f7f4ec', '#d5cfc1', '#a39b8b', '#ef6b4f']
    frames = []
    for k in range(3):
        p = Pic(32)
        for y in range(32):
            for x in range(32):
                p.set(x, y, band([0, 1, 2], y / 19, x, y))
        for y in range(19, 32):
            for x in range(32):
                p.set(x, y, band([3, 4, 5], (y - 19) / 12, x, y))
        for y in (20, 24, 28):
            for x in range(32):
                if (x + k * 2 + y) % 8 < 3:
                    p.set(x, y, 2)
        bob = (0, -1, 0)[k]
        hull = ['....................', '..6666666666666666..', '...66666666666666...', '....777777777777....', '.....8888888888.....']
        sail = ['.........6.........', '........66.........', '.......676.........', '......6676.........', '.....66776.........', '....666776.........', '...6667776.........']
        for y, r in enumerate(sail):
            for x, ch in enumerate(r):
                if ch != '.':
                    p.set(6 + x, 9 + y + bob, int(ch))
        for y, r in enumerate(hull):
            for x, ch in enumerate(r):
                if ch != '.':
                    p.set(6 + x, 15 + y + bob, int(ch))
        p.set(15, 8 + bob, 9)
        p.set(16, 8 + bob, 9)
        frames.append(p)
    return colors, frames


# ------------------------------------------------------------- the list --

def drawn(title, colors_or_builtin, frames, *, shade=0, delay=0, mine=False):
    builtin = colors_or_builtin if isinstance(colors_or_builtin, int) else None
    return {
        'title': title, 'mine': mine, 'size': frames[0].n,
        **({'builtin': builtin} if builtin is not None else {'colors': colors_or_builtin}),
        'shade': shade, 'delay': delay, 'frames': [f.rows() for f in frames],
    }


def samples():
    mc, mf = mushroom()
    hc, hf = heart()
    mo = mountains()
    out = [
        drawn('Грибок', mc, mf, shade=0, delay=420, mine=True),
        drawn('Сумеречный гриб', ['#14122b', '#5b4bb5', '#d8d1ff', '#352b7a', '#c6c9e8', '#8b8fb8'], mf, shade=6, delay=420),
        drawn('Лунная дорожка', *moon(), shade=7, mine=True),
        drawn('Горный рассвет', *mo, shade=1),
        drawn('Горная ночь', mountains_night(mo[0]), mo[1], shade=6),
        drawn('Северное сияние', *aurora(), shade=7),
        drawn('Кактус', *cactus(), shade=4),
        drawn('Сердечко', hc, hf, shade=3, delay=160),
        drawn('Сердечко · Game Boy', *heart_gameboy(hf), shade=0, delay=160),
        drawn('Ключик', *key(), shade=5, mine=True),
        drawn('Кораблик', *boat(), shade=2, delay=320, mine=True),
    ]
    # Pictures from files, imported through the app's own import: as they are
    # (their colours fitted), and some again in a built-in palette.
    files = [
        {'title': 'Прибой', 'file': 'surf.png', 'fit': 24, 'shade': 2, 'mine': True},
        {'title': 'Прибой · PICO-8', 'file': 'surf.png', 'palette': 16, 'shade': 0},
        {'title': 'Разряд', 'file': 'spark.png', 'fit': 16, 'shade': 7},
        {'title': 'Мармелад', 'file': 'ribbons.png', 'fit': 12, 'shade': 3},
        {'title': 'Мармелад · Sweetie', 'file': 'ribbons.png', 'palette': 17, 'shade': 5},
        {'title': 'Старый терминал', 'file': 'terminal.png', 'fit': 16, 'shade': 6},
        {'title': 'Терминал · CGA', 'file': 'terminal.png', 'palette': 22, 'shade': 6},
    ]
    return out, files


def main():
    drawn_list, files = samples()
    for s in drawn_list:
        assert len(s['frames'][0]) == s['size'], s['title']
    for s in drawn_list + files:
        assert len(s['title'].encode()) <= 32, f"{s['title']}: a title is at most 32 bytes (pips-format MAX_TITLE)"
    body = (
        '// Sample cards for developer mode (Profile → for developers), generated by\n'
        '// scripts/samples.py — edit that, not this. DRAWN: rows of\n'
        "// characters, '.' empty, else an index into `colors` (or into the built-in\n"
        '// palette `builtin`). FILES: pictures beside this file, through the import.\n'
        '// `mine`: signed with the person\'s own key; the rest come from made-up artists.\n'
        f'export const DRAWN = {json.dumps(drawn_list, ensure_ascii=False)};\n'
        f'export const FILES = {json.dumps(files, ensure_ascii=False)};\n'
    )
    (ROOT / 'web/samples/samples.js').write_text(body, encoding='utf-8')
    if '--preview' in sys.argv:
        preview(drawn_list, Path(sys.argv[sys.argv.index('--preview') + 1]))
    print(f'web/samples/samples.js: {len(drawn_list)} drawn, {len(files)} from files')


def preview(items, out):
    """Each picture's frames side by side, 8× — for looking, not shipping."""
    from PIL import Image
    pal_src = (ROOT / 'web/dev/palettes.js').read_text()
    out.mkdir(parents=True, exist_ok=True)
    builtins = {}
    for m in __import__('re').finditer(r'"id":\s*(\d+),\s*"slug":\s*"[^"]+",\s*"colors":\s*(\[\[.*?\]\])', pal_src):
        builtins[int(m.group(1))] = json.loads(m.group(2))
    for s in items:
        cols = [tuple(c) for c in builtins[s['builtin']]] if 'builtin' in s else [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in s['colors']]
        n, fr = s['size'], s['frames']
        im = Image.new('RGB', (n * len(fr), n), (60, 60, 64))
        for k, rows in enumerate(fr):
            for y, r in enumerate(rows):
                for x, ch in enumerate(r):
                    if ch != '.':
                        im.putpixel((k * n + x, y), cols[DIGITS.index(ch)])
        im.resize((im.width * 8, im.height * 8), Image.NEAREST).save(out / f"{s['title'].replace(' ', '_').replace('·', '')}.png")


if __name__ == '__main__':
    main()
