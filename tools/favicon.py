"""Draw the site's icons from the brand mark.

    python tools/favicon.py

The browser tab shows web/public/favicon.svg, the sidebar's mark (a 42 pixel
tile, 15 pixel corners, the primary gradient and the Pulse icon). Browsers
that will not take an SVG favicon get the 32 pixel PNG drawn here, and iOS
gets the 180 pixel home screen icon, square because iOS rounds the corners
itself. The drawing is tools/email_mark.py's, at other sizes.
"""

from __future__ import annotations

import pathlib

import email_mark as mark

PUBLIC = pathlib.Path(__file__).resolve().parents[1] / "web" / "public"


def draw(size: int, *, rounded: bool = True) -> bytes:
    scale = size / 42
    mark.SCALE = scale
    mark.SIZE = size
    mark.RADIUS = 15 * scale if rounded else 0
    mark.ICON = 21 / 24 * scale
    mark.OFFSET = (42 - 21) / 2 * scale
    rows = [b"".join(mark.pixel(x, y) for x in range(size)) for y in range(size)]
    return mark.png(size, size, rows)


def main() -> None:
    for name, size, rounded in (("favicon-32.png", 32, True), ("apple-touch-icon.png", 180, False)):
        out = PUBLIC / name
        out.write_bytes(draw(size, rounded=rounded))
        print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
