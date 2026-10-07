/**
 * The look of everything Atria exports (2026-10-07): the values the SRS, the
 * Technical Document and the Design Specification are set in (Documentation
 * v2/build/atria_doc.py, "Atria Foundations v1, Rev. A"). A PDF, a workbook
 * and a CSV from the console read as the same family as those documents.
 */

export const INK = {
  ground: "#E9F0FD",
  surface: "#FFFFFF",
  ink: "#0D1B34",
  ink2: "#2C3D60",
  muted: "#5A6C8E",
  hair: "#DCE5F5",
  hair2: "#E9EFFA",
  tint: "#F3F7FF",
  p100: "#E3EDFE",
  p200: "#BFD5FE",
  p500: "#4A83F0",
  p600: "#2F6BE4",
  p700: "#2461DB",
  p800: "#1B4FB8",
  p900: "#0B2B6B",
  ok: "#0B7A53",
  okTint: "#E4F4EF",
  wait: "#9B5E0E",
  waitTint: "#FAEFE3",
  bad: "#B93B4C",
  badTint: "#FAE9EB",
} as const;

export type Tone = "ok" | "wait" | "bad" | "info";

/** A pill's text and ground, as the documents' st-ok, st-wait, st-bad and st-info. */
export const TONE: Record<Tone, { ink: string; ground: string }> = {
  ok: { ink: INK.ok, ground: INK.okTint },
  wait: { ink: INK.wait, ground: INK.waitTint },
  bad: { ink: INK.bad, ground: INK.badTint },
  info: { ink: INK.p800, ground: INK.p100 },
};

/** The three faces, as the documents name them. */
export const FACE = { display: "Outfit", text: "Plus Jakarta Sans", mono: "IBM Plex Mono" } as const;

/** "7 October 2026, 16:09": when an export was made, in the reader's own clock. */
export function madeAt(at = new Date()): string {
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  return `${day}, ${time}`;
}

/**
 * A file name in the documents' manner ("ATR-TD-001 Technical Document Rev B"):
 * Atria, what it is, and for when. Only characters every system keeps.
 */
export function fileName(parts: (string | null | undefined)[], extension: string): string {
  const name = ["Atria", ...parts]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" ")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${name}.${extension}`;
}

/** Hands a finished file to the browser to save. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
