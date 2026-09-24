"""Draw the brand mark that heads every email, as a PNG.

    python tools/email_mark.py

Email clients will not show SVG, so the sidebar's mark (web/src/patient/
PatientShell.tsx: a 42 pixel tile, 15 pixel corners, the primary gradient at
140 degrees, and the Pulse icon at 21 pixels) is drawn here at three times its
size into web/public/email/atria-mark.png, which the hosted site serves and
atria.core.mail links to. Standard library only, so it runs anywhere the repo
does; the edges are smoothed by sampling each pixel sixteen times.
"""

from __future__ import annotations

import math
import pathlib
import struct
import zlib

SCALE = 3
SIZE = 42 * SCALE
RADIUS = 15 * SCALE
START, END = (0x4A, 0x83, 0xF0), (0x21, 0x59, 0xD2)
ANGLE = math.radians(140)

# The Pulse icon, web/src/components/icons.tsx: M2 12h4.5l2.5-5 4 10 2.5-5H22
PULSE = [(2, 12), (6.5, 12), (9, 7), (13, 17), (15.5, 12), (22, 12)]
STROKE = 2.2
ICON = 21 / 24 * SCALE  # icon units to pixels
OFFSET = (42 - 21) / 2 * SCALE

OUT = pathlib.Path(__file__).resolve().parents[1] / "web" / "public" / "email" / "atria-mark.png"


def inside_tile(x: float, y: float) -> bool:
    cx = min(max(x, RADIUS), SIZE - RADIUS)
    cy = min(max(y, RADIUS), SIZE - RADIUS)
    return 0 <= x <= SIZE and 0 <= y <= SIZE and (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS**2


def gradient(x: float, y: float) -> tuple[float, float, float]:
    dx, dy = math.sin(ANGLE), -math.cos(ANGLE)
    length = SIZE * (abs(dx) + abs(dy))
    t = min(max(((x - SIZE / 2) * dx + (y - SIZE / 2) * dy) / length + 0.5, 0.0), 1.0)
    colour = [a + (b - a) * t for a, b in zip(START, END, strict=True)]
    # The inset highlight along the top edge: white at 0.45, gone by 6 pixels.
    glow = max(0.0, 1 - y / (2 * SCALE)) * 0.45
    return (
        colour[0] + (255 - colour[0]) * glow,
        colour[1] + (255 - colour[1]) * glow,
        colour[2] + (255 - colour[2]) * glow,
    )


def on_pulse(x: float, y: float) -> bool:
    u, v = (x - OFFSET) / ICON, (y - OFFSET) / ICON
    for (ax, ay), (bx, by) in zip(PULSE, PULSE[1:], strict=False):
        vx, vy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((u - ax) * vx + (v - ay) * vy) / (vx * vx + vy * vy)))
        if (u - ax - t * vx) ** 2 + (v - ay - t * vy) ** 2 <= (STROKE / 2) ** 2:
            return True
    return False


def pixel(px: int, py: int) -> bytes:
    samples = 4
    red = green = blue = alpha = 0.0
    for sy in range(samples):
        for sx in range(samples):
            x, y = px + (sx + 0.5) / samples, py + (sy + 0.5) / samples
            if not inside_tile(x, y):
                continue
            colour = (255.0, 255.0, 255.0) if on_pulse(x, y) else gradient(x, y)
            red, green, blue, alpha = (
                red + colour[0],
                green + colour[1],
                blue + colour[2],
                alpha + 1,
            )
    if not alpha:
        return b"\x00\x00\x00\x00"
    return bytes(
        (
            round(red / alpha),
            round(green / alpha),
            round(blue / alpha),
            round(255 * alpha / samples**2),
        )
    )


def png(width: int, height: int, rows: list[bytes]) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    raw = b"".join(b"\x00" + row for row in rows)
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    rows = [b"".join(pixel(x, y) for x in range(SIZE)) for y in range(SIZE)]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(png(SIZE, SIZE, rows))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
