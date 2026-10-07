/**
 * An Atria PDF, built from the parts the documents are built from
 * (Documentation v2/build/atria_doc.py): the blue gradient cover with the
 * mark, the kicker and the glass meta card; chapter headings with their
 * number in a tinted mono chip; white table sheets with tinted small-caps
 * heads; tiles; callouts; and the running foot, the document code on the
 * left and "Page n of m" on the right, on an A4 page of the platform ground.
 *
 * The three faces are embedded from /fonts/export (Outfit, Plus Jakarta
 * Sans, IBM Plex Mono, all under the SIL Open Font License). If they cannot
 * be fetched the PDF is still made, in the PDF's own sans and mono.
 */

import { jsPDF } from "jspdf";

import { INK, TONE, type Tone } from "./tokens";

const W = 210;
const H = 297;
const SIDE = 14;
const TOP = 15;
const BOTTOM = 17;
const CONTENT = W - SIDE * 2;
const PT = 0.3528; // one point in millimetres

type Face = "display" | "text" | "mono";
type Weight = 500 | 600 | 700;

const FONT_FILES: { face: Face; weight: Weight; file: string }[] = [
  { face: "text", weight: 500, file: "PlusJakartaSans-Medium.ttf" },
  { face: "text", weight: 600, file: "PlusJakartaSans-SemiBold.ttf" },
  { face: "text", weight: 700, file: "PlusJakartaSans-Bold.ttf" },
  { face: "display", weight: 600, file: "Outfit-600.ttf" },
  { face: "display", weight: 700, file: "Outfit-700.ttf" },
  { face: "mono", weight: 500, file: "IBMPlexMono_500.ttf" },
  { face: "mono", weight: 600, file: "IBMPlexMono_600.ttf" },
];

const FAMILY: Record<Face, string> = { display: "AtriaDisplay", text: "AtriaText", mono: "AtriaMono" };

// Fetched once per visit: the files are the same for every export.
let fontData: Promise<Map<string, string> | null> | null = null;

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function loadFonts(): Promise<Map<string, string> | null> {
  fontData ??= Promise.all(
    FONT_FILES.map(async ({ file }) => {
      const response = await fetch(`/fonts/export/${file}`);
      if (!response.ok) throw new Error(file);
      return [file, base64(await response.arrayBuffer())] as const;
    }),
  )
    .then((pairs) => new Map(pairs))
    .catch(() => {
      fontData = null; // try again next time
      return null;
    });
  return fontData;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The cover's ground, painted as the documents' CSS paints it, with its corners rounded. */
function coverImage(wMm: number, hMm: number, radiusMm: number): string | null {
  try {
    const scale = 5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(wMm * scale);
    canvas.height = Math.round(hMm * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const w = canvas.width;
    const h = canvas.height;
    // The page's ground in the corners, so the cover needs no transparency
    // and travels as a small JPEG.
    ctx.fillStyle = INK.ground;
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, radiusMm * scale);
    ctx.clip();
    // linear-gradient(168deg, #123A8C 0%, #2C63DE 38%, #5E93F2 66%, #DDE9FE 100%)
    const angle = (168 * Math.PI) / 180;
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    const linear = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
    linear.addColorStop(0, "#123A8C");
    linear.addColorStop(0.38, "#2C63DE");
    linear.addColorStop(0.66, "#5E93F2");
    linear.addColorStop(1, "#DDE9FE");
    ctx.fillStyle = linear;
    ctx.fillRect(0, 0, w, h);
    // The two soft lights: top right and bottom left.
    for (const [x, y, r, colour] of [
      [0.88, 0.08, 0.47, "150,190,255"],
      [0.04, 0.92, 0.42, "205,224,255"],
    ] as const) {
      const radial = ctx.createRadialGradient(w * x, h * y, 0, w * x, h * y, w * r);
      radial.addColorStop(0, `rgba(${colour},0.55)`);
      radial.addColorStop(0.7, `rgba(${colour},0)`);
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, w, h);
    }
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch {
    return null;
  }
}

export interface MetaItem {
  label: string;
  value: string;
  mono?: boolean;
}

export interface Column {
  label: string;
  /** A share of the table's width; the shares are scaled to fill it. */
  width: number;
  align?: "left" | "right";
  mono?: boolean;
}

export type Cell = string | number | { text: string; tone: Tone };

export class AtriaPdf {
  readonly doc: jsPDF;
  private y = TOP;
  private embedded: boolean;

  private constructor(
    doc: jsPDF,
    embedded: boolean,
    private readonly code: string,
  ) {
    this.doc = doc;
    this.embedded = embedded;
    this.ground();
  }

  /** A new A4 document. `code` runs in the foot of every page, as "ATR-TD-001 · Rev B" does. */
  static async create(code: string): Promise<AtriaPdf> {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const fonts = await loadFonts();
    if (fonts) {
      for (const { face, weight, file } of FONT_FILES) {
        const data = fonts.get(file);
        if (!data) continue;
        doc.addFileToVFS(file, data);
        doc.addFont(file, FAMILY[face], String(weight));
      }
    }
    return new AtriaPdf(doc, Boolean(fonts), code);
  }

  // ----------------------------------------------------------- drawing
  private ground() {
    this.doc.setFillColor(...rgb(INK.ground));
    this.doc.rect(0, 0, W, H, "F");
  }

  private face(face: Face, weight: Weight, sizePt: number, colour: string, spacingEm = 0) {
    if (this.embedded) {
      const have = FONT_FILES.some((f) => f.face === face && f.weight === weight);
      const use = have ? weight : face === "display" ? 600 : face === "mono" ? 600 : 700;
      this.doc.setFont(FAMILY[face], String(use));
    } else {
      this.doc.setFont(face === "mono" ? "courier" : "helvetica", weight >= 600 ? "bold" : "normal");
    }
    this.doc.setFontSize(sizePt);
    this.doc.setTextColor(...rgb(colour));
    this.doc.setCharSpace(spacingEm * sizePt * PT);
  }

  private fill(hex: string) {
    this.doc.setFillColor(...rgb(hex));
  }

  private stroke(hex: string, widthMm = 0.25) {
    this.doc.setDrawColor(...rgb(hex));
    this.doc.setLineWidth(widthMm);
  }

  private translucent(opacity: number, draw: () => void) {
    const doc = this.doc as jsPDF & { GState?: new (o: { opacity: number }) => unknown; setGState?: (g: unknown) => void };
    if (doc.GState && doc.setGState) {
      doc.setGState(new doc.GState({ opacity }));
      draw();
      doc.setGState(new doc.GState({ opacity: 1 }));
    } else {
      draw();
    }
  }

  /** The Atria mark: a pulse line in a glass tile. */
  private mark(x: number, y: number, size: number) {
    this.translucent(0.24, () => {
      this.fill("#FFFFFF");
      this.doc.roundedRect(x, y, size, size, size * 0.34, size * 0.34, "F");
    });
    this.translucent(0.5, () => {
      this.stroke("#FFFFFF", 0.25);
      this.doc.roundedRect(x, y, size, size, size * 0.34, size * 0.34, "S");
    });
    // M3 12h4l2-5 3 10 2.5-6 1.8 3H21, in a 24 box drawn at half the tile.
    const s = (size * 0.5) / 24;
    const ox = x + size * 0.25;
    const oy = y + size * 0.25;
    const points: [number, number][] = [[3, 12], [7, 12], [9, 7], [12, 17], [14.5, 11], [16.3, 14], [21, 14]];
    this.stroke("#FFFFFF", size * 0.045);
    this.doc.setLineCap("round");
    this.doc.setLineJoin("round");
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      this.doc.line(ox + ax * s, oy + ay * s, ox + bx * s, oy + by * s);
    }
  }

  private newPage() {
    this.doc.addPage();
    this.ground();
    this.y = TOP;
  }

  /** Room for `height` more millimetres on this page, or a new page. */
  private room(height: number) {
    if (this.y + height > H - BOTTOM - 4) this.newPage();
  }

  // ----------------------------------------------------------- parts
  /**
   * The cover, as the documents open: the brand, a kicker, the title, a lede
   * and the meta card. `full` fills the first page, as a document's does; a
   * report's sits at the top and the figures follow.
   */
  cover({ kicker, title, lede, meta, full = false }: { kicker: string; title: string; lede?: string; meta: MetaItem[]; full?: boolean }) {
    const x = SIDE;
    const top = TOP;
    const pad = 11;
    const inner = CONTENT - pad * 2;
    this.face("display", 700, full ? 34 : 24, "#FFFFFF");
    const titleLines: string[] = this.doc.splitTextToSize(title, inner);
    this.face("text", 500, 10.5, "#FFFFFF");
    const ledeLines: string[] = lede ? this.doc.splitTextToSize(lede, inner * 0.82) : [];
    const columns = Math.min(4, meta.length);
    const metaRows = Math.ceil(meta.length / columns);
    const metaHeight = 9 + metaRows * 14;
    const titleHeight = titleLines.length * (full ? 13 : 9.6);
    const natural = pad + 11 + 8 + 19 + titleHeight + 4 + ledeLines.length * 5.2 + 8 + metaHeight + pad;
    const height = full ? H - TOP - BOTTOM - 8 : natural;

    const image = coverImage(CONTENT, height, 12);
    if (image) this.doc.addImage(image, "JPEG", x, top, CONTENT, height);
    else {
      this.fill(INK.p700);
      this.doc.roundedRect(x, top, CONTENT, height, 12, 12, "F");
    }

    let y = top + pad;
    this.mark(x + pad, y, 11);
    this.face("display", 600, 13, "#FFFFFF", 0.14);
    this.doc.text("ATRIA", x + pad + 15, y + 5);
    this.face("text", 600, 7, "#FFFFFF", 0.14);
    this.doc.text("HEALTHCARE APPOINTMENTS", x + pad + 15, y + 9.4);
    y += 11 + 8;

    // The kicker pill.
    this.face("text", 700, 7, "#FFFFFF", 0.12);
    const kickerText = kicker.toUpperCase();
    const kw = this.doc.getTextWidth(kickerText) + kickerText.length * 0.12 * 7 * PT + 9;
    this.translucent(0.16, () => {
      this.fill("#FFFFFF");
      this.doc.roundedRect(x + pad, y, kw, 7, 3.5, 3.5, "F");
    });
    this.translucent(0.34, () => {
      this.stroke("#FFFFFF", 0.25);
      this.doc.roundedRect(x + pad, y, kw, 7, 3.5, 3.5, "S");
    });
    this.face("text", 700, 7, "#FFFFFF", 0.12);
    this.doc.text(kickerText, x + pad + 4.5, y + 4.7);
    y += 7 + (full ? 16 : 12);

    this.face("display", 700, full ? 34 : 24, "#FFFFFF", -0.03);
    for (const line of titleLines) {
      this.doc.text(line, x + pad, y);
      y += full ? 13 : 9.6;
    }
    if (ledeLines.length) {
      y += 1;
      this.face("text", 500, 10.5, "#EEF4FF");
      for (const line of ledeLines) {
        this.doc.text(line, x + pad, y);
        y += 5.2;
      }
    }

    // The glass meta card, at the foot of the cover.
    const cardY = top + height - pad - metaHeight;
    this.translucent(0.9, () => {
      this.fill("#FFFFFF");
      this.doc.roundedRect(x + pad, cardY, inner, metaHeight, 7, 7, "F");
    });
    const colW = (inner - 12) / columns;
    meta.forEach((item, i) => {
      const cx = x + pad + 6 + (i % columns) * colW;
      const cy = cardY + 8 + Math.floor(i / columns) * 14;
      this.face("text", 700, 6.4, INK.muted, 0.1);
      this.doc.text(item.label.toUpperCase(), cx, cy);
      this.face(item.mono ? "mono" : "text", 600, 8.6, INK.ink);
      const value: string[] = this.doc.splitTextToSize(item.value, colW - 3);
      value.slice(0, 2).forEach((line, l) => this.doc.text(line, cx, cy + 4.6 + l * 3.8));
    });

    this.y = top + height + 9;
    if (full) this.newPage();
  }

  /** A chapter heading: its number in a tinted mono chip, the title in Outfit. */
  heading(number: string, title: string, sub?: string) {
    this.room(sub ? 34 : 26);
    if (this.y > TOP + 1) this.y += 5;
    this.face("mono", 600, 9, INK.p600);
    const nw = this.doc.getTextWidth(number) + 5;
    this.fill(INK.p100);
    this.doc.roundedRect(SIDE, this.y - 5, nw, 7, 2.6, 2.6, "F");
    this.doc.text(number, SIDE + 2.5, this.y);
    this.face("display", 700, 15, INK.ink, -0.022);
    this.doc.text(title, SIDE + nw + 3.5, this.y);
    this.y += 4;
    if (sub) {
      this.face("text", 500, 8.6, INK.muted);
      const lines: string[] = this.doc.splitTextToSize(sub, CONTENT);
      for (const line of lines) {
        this.y += 4.4;
        this.doc.text(line, SIDE, this.y);
      }
    }
    this.y += 5;
  }

  /** Figures in a row of white tiles, each with its small-caps label. */
  tiles(items: { label: string; value: string; tone?: Tone }[]) {
    const gap = 3.5;
    const w = (CONTENT - gap * (items.length - 1)) / items.length;
    const h = 21;
    this.room(h + 6);
    items.forEach((item, i) => {
      const x = SIDE + i * (w + gap);
      const accent = item.tone === "info";
      this.fill(accent ? INK.p700 : INK.surface);
      this.stroke(accent ? INK.p700 : INK.hair);
      this.doc.roundedRect(x, this.y, w, h, 5, 5, "FD");
      this.face("text", 700, 6.4, accent ? "#DCE8FF" : INK.muted, 0.1);
      this.doc.text(item.label.toUpperCase(), x + 4.5, this.y + 7);
      const colour = accent ? "#FFFFFF" : item.tone ? TONE[item.tone].ink : INK.ink;
      this.face("display", 700, 17, colour, -0.02);
      this.doc.text(item.value, x + 4.5, this.y + 16.5);
    });
    this.y += h + 7;
  }

  /** A white table sheet: a tinted small-caps head, hairlines between rows, the head repeated on a new page. */
  table(columns: Column[], rows: Cell[][], { caption, empty = "Nothing to show for this period." }: { caption?: string; empty?: string } = {}) {
    const total = columns.reduce((sum, c) => sum + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * CONTENT);
    const padX = 3.6;
    const headH = 8.4;
    const lineH = 4.1;

    const lay = (row: Cell[]) =>
      row.map((cell, i) => {
        const column = columns[i]!;
        const text = typeof cell === "object" ? cell.text : String(cell);
        this.face(column.mono ? "mono" : "text", 500, 8.4, INK.ink);
        const lines: string[] = typeof cell === "object" ? [text] : this.doc.splitTextToSize(text, widths[i]! - padX * 2);
        return { lines, cell, column };
      });
    const heightOf = (laid: ReturnType<typeof lay>) => Math.max(...laid.map((c) => c.lines.length)) * lineH + 4.6;

    const head = (top: number) => {
      let x = SIDE;
      this.face("text", 700, 6.6, INK.muted, 0.1);
      columns.forEach((column, i) => {
        const label = column.label.toUpperCase();
        const tx = column.align === "right" ? x + widths[i]! - padX : x + padX;
        this.doc.text(label, tx, top + 5.6, { align: column.align === "right" ? "right" : "left" });
        x += widths[i]!;
      });
    };

    const captionH = caption ? 7 : 0;
    const sheet = (top: number, height: number, withCaption: boolean) => {
      this.fill(INK.surface);
      this.stroke(INK.hair);
      this.doc.roundedRect(SIDE, top, CONTENT, height, 5, 5, "FD");
      // The head's tint, square at its foot.
      const headTop = top + (withCaption ? captionH : 0);
      this.fill(INK.tint);
      if (withCaption) this.doc.rect(SIDE + 0.15, headTop, CONTENT - 0.3, headH, "F");
      else {
        this.doc.roundedRect(SIDE + 0.15, headTop + 0.15, CONTENT - 0.3, headH, 4.8, 4.8, "F");
        this.doc.rect(SIDE + 0.15, headTop + headH / 2, CONTENT - 0.3, headH / 2, "F");
      }
      this.stroke(INK.hair);
      this.doc.line(SIDE, headTop + headH, SIDE + CONTENT, headTop + headH);
      if (withCaption && caption) {
        this.face("text", 600, 7.8, INK.muted);
        this.doc.text(caption, SIDE + padX, top + 5.2);
      }
      head(headTop);
    };

    const laidRows = rows.length ? rows.map(lay) : null;
    // Draw page by page: a sheet holds the rows that fit, then the next page carries on.
    let index = 0;
    let first = true;
    do {
      const withCaption = first && Boolean(caption);
      const start = withCaption ? captionH + headH : headH;
      this.room(start + (laidRows ? heightOf(laidRows[index]!) : 10) + 2);
      const limit = H - BOTTOM - 4 - this.y;
      let height = start;
      const fits: number[] = [];
      if (laidRows) {
        while (index < laidRows.length && height + heightOf(laidRows[index]!) <= limit) {
          height += heightOf(laidRows[index]!);
          fits.push(index++);
        }
      } else height += 10;
      height += 1.5;
      const top = this.y;
      sheet(top, height, withCaption);
      let rowY = top + start;
      if (!laidRows) {
        this.face("text", 500, 8.4, INK.muted);
        this.doc.text(empty, SIDE + padX, rowY + 6.4);
      }
      fits.forEach((r, n) => {
        const laid = laidRows![r]!;
        const rh = heightOf(laid);
        if (n > 0) {
          this.stroke(INK.hair2);
          this.doc.line(SIDE + 0.5, rowY, SIDE + CONTENT - 0.5, rowY);
        }
        let x = SIDE;
        laid.forEach(({ lines, cell, column }, i) => {
          const right = column.align === "right";
          const tx = right ? x + widths[i]! - padX : x + padX;
          if (typeof cell === "object") {
            this.face("text", 700, 7, TONE[cell.tone].ink);
            const pw = this.doc.getTextWidth(cell.text) + 5;
            this.fill(TONE[cell.tone].ground);
            const px = right ? tx - pw : tx;
            this.doc.roundedRect(px, rowY + 1.6, pw, 5.2, 2.6, 2.6, "F");
            this.doc.text(cell.text, px + 2.5, rowY + 5.1);
          } else {
            this.face(column.mono ? "mono" : "text", i === 0 ? 600 : 500, 8.4, column.mono ? INK.p800 : INK.ink);
            lines.forEach((line, l) => this.doc.text(line, tx, rowY + 5.5 + l * lineH, { align: right ? "right" : "left" }));
          }
          x += widths[i]!;
        });
        rowY += rh;
      });
      this.y = top + height + 6;
      first = false;
      if (laidRows && index < laidRows.length) this.newPage();
    } while (laidRows && index < laidRows.length);
  }

  /** A note in the documents' info callout: a tinted panel, a bold title, its lines. */
  callout(title: string, lines: string[], tone: "info" | "warn" = "info") {
    this.face("text", 500, 8.4, INK.ink);
    const wrapped = lines.flatMap((line) => this.doc.splitTextToSize(line, CONTENT - 16) as string[]);
    const h = 10 + wrapped.length * 4.3 + 3;
    this.room(h + 4);
    this.fill(tone === "warn" ? "#FFF6EA" : "#F7FAFF");
    this.stroke(tone === "warn" ? "#F1DCBE" : INK.hair);
    this.doc.roundedRect(SIDE, this.y, CONTENT, h, 6, 6, "FD");
    this.fill(tone === "warn" ? "#F7E3C6" : INK.p100);
    this.doc.roundedRect(SIDE + 4.5, this.y + 4.2, 6, 6, 2, 2, "F");
    this.face("text", 700, 8, tone === "warn" ? INK.wait : INK.p600);
    this.doc.text(tone === "warn" ? "!" : "i", SIDE + 7.5, this.y + 8.5, { align: "center" });
    this.face("text", 700, 9, INK.ink);
    this.doc.text(title, SIDE + 14, this.y + 8.4);
    this.face("text", 500, 8.4, INK.ink2);
    wrapped.forEach((line, i) => this.doc.text(line, SIDE + 14, this.y + 13.4 + i * 4.3));
    this.y += h + 6;
  }

  /** Space left on the page for a part of this height, or a fresh page. */
  keep(height: number) {
    this.room(height);
  }

  /** The running foot on every page, then the file. */
  save(name: string) {
    const pages = this.doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      this.doc.setPage(page);
      this.face("mono", 600, 8, INK.muted);
      this.doc.text(this.code, SIDE, H - 8);
      this.face("text", 500, 8, INK.muted);
      this.doc.text(`Page ${page} of ${pages}`, W - SIDE, H - 8, { align: "right" });
    }
    this.doc.save(name);
  }
}
