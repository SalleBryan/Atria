"""
Convert an Atria document (the HTML that produced the PDF) into an editable
Word file with the same fonts, colours, page ground and structure.

The HTML is the single source. Text becomes Word text in real styles
(Heading 1 to 3, a live TOC field, page fields in the footer). Things Word
cannot draw natively, such as the context diagram, component demos, the glass
sample and the cover artwork, are rendered by Edge at 220 dpi and placed as
pictures; the words on the cover sit on top in text boxes so they stay
editable.
"""
import copy
import os
import re
import subprocess
import sys

import fitz
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Emu, Mm, Pt, RGBColor
from lxml import etree, html as lhtml
from PIL import Image, ImageChops

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def _wait(path):
    """The Edge launcher can return before its headless child has written the file."""
    import time
    for _ in range(120):
        if os.path.exists(path) and os.path.getsize(path) > 0:
            break
        time.sleep(1)
    time.sleep(2)
DPI = 220
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NSDECL = ('xmlns:w="%s" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
          'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
          'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"' % W_NS)

# --------------------------------------------------------------- tokens
C = dict(ink="0D1B34", ink2="2C3D60", muted="5A6C8E", hair="DCE5F5", hair2="E9EFFA", tint="F3F7FF",
         ground="E9F0FD", white="FFFFFF", p100="E3EDFE", p200="BFD5FE", p400="7AA8FA", p500="4A83F0",
         p600="2F6BE4", p700="2461DB", p800="1B4FB8", p900="0B2B6B", ok="0B7A53", okt="E4F4EF",
         wait="9B5E0E", waitt="FAEFE3", bad="B93B4C", badt="FAE9EB")
CSSVAR = {"--ink": C["ink"], "--ink-2": C["ink2"], "--muted": C["muted"], "--p800": C["p800"],
          "--p700": C["p700"], "--p600": C["p600"], "--p500": C["p500"], "--p900": C["p900"]}
FACE = {
    ("text", 400): ("Plus Jakarta Sans", False), ("text", 500): ("Plus Jakarta Sans Medium", False),
    ("text", 600): ("Plus Jakarta Sans SemiBold", False), ("text", 700): ("Plus Jakarta Sans", True),
    ("display", 500): ("Outfit Medium", False), ("display", 600): ("Outfit SemiBold", False),
    ("display", 700): ("Outfit", True),
    ("mono", 500): ("IBM Plex Mono Medium", False), ("mono", 600): ("IBM Plex Mono SemiBold", False),
    ("mono", 700): ("IBM Plex Mono", True),
}
PAGE_W, PAGE_H = 210.0, 297.0
M_TOP, M_BOT, M_SIDE = 15.0, 17.0, 14.0
CONTENT_W = PAGE_W - 2 * M_SIDE           # 182 mm
PILL = {  # class -> (text colour, shade, border)
    "must": ("FFFFFF", C["p700"], None), "should": (C["p800"], C["p100"], None),
    "could": (C["muted"], None, C["hair"]),
    "ph1": (C["ok"], C["okt"], None), "ph2": (C["p800"], C["p100"], None), "ph3": (C["wait"], C["waitt"], None),
    "st-ok": (C["ok"], C["okt"], None), "st-wait": (C["wait"], C["waitt"], None),
    "st-bad": (C["bad"], C["badt"], None), "st-info": (C["p800"], C["p100"], None),
}
CALLOUT = {"info": ("F7FAFF", "DCE5F5"), "warn": ("FFF6EA", "F1DCBE"), "risk": ("FDF0F2", "F1CDD3")}
NBSP = "\u00a0"


def mm_emu(v):
    return int(round(v * 36000))


# --------------------------------------------------------------- run / paragraph formatting
def set_font(rpr_owner, family):
    rpr = rpr_owner.get_or_add_rPr() if hasattr(rpr_owner, "get_or_add_rPr") else rpr_owner
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.insert(0, rf)
    for k in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rf.set(qn(k), family)
    for k in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        if rf.get(qn(k)) is not None:
            del rf.attrib[qn(k)]


def fmt_run(run, role="text", weight=500, size=9.5, color=None, italic=False, caps=False,
            spacing=None, shade=None, border=None, underline=False):
    fam, bold = FACE[(role, weight)]
    set_font(run._r, fam)
    run.font.bold = bold
    run.font.italic = italic
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color or C["ink"])
    if caps:
        run.font.all_caps = True
    if underline:
        run.font.underline = True
    rpr = run._r.get_or_add_rPr()
    if spacing is not None:
        sp = OxmlElement("w:spacing")
        sp.set(qn("w:val"), str(int(round(spacing * 20))))
        rpr.append(sp)
    if shade:
        sh = OxmlElement("w:shd")
        sh.set(qn("w:val"), "clear"); sh.set(qn("w:color"), "auto"); sh.set(qn("w:fill"), shade)
        rpr.append(sh)
    if border:
        bd = OxmlElement("w:bdr")
        bd.set(qn("w:val"), "single"); bd.set(qn("w:sz"), "4"); bd.set(qn("w:space"), "0"); bd.set(qn("w:color"), border)
        rpr.append(bd)
    return run


def para_fmt(p, before=0, after=6, line=None, rule="atLeast", align=None, keep=False, indent=None, right=None):
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    if line:
        pf.line_spacing = Pt(line)
        pf.line_spacing_rule = WD_LINE_SPACING.AT_LEAST if rule == "atLeast" else WD_LINE_SPACING.EXACTLY
    if align == "center":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    elif align == "right":
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    if keep:
        pf.keep_with_next = True
    if indent is not None:
        pf.left_indent = Mm(indent)
    if right is not None:
        pf.right_indent = Mm(right)
    return p


def p_border_top(p, color, sz=4, space=6):
    ppr = p._p.get_or_add_pPr()
    b = OxmlElement("w:pBdr")
    t = OxmlElement("w:top")
    t.set(qn("w:val"), "single"); t.set(qn("w:sz"), str(sz)); t.set(qn("w:space"), str(space)); t.set(qn("w:color"), color)
    b.append(t)
    ppr.append(b)


# --------------------------------------------------------------- tables
def _el(tag, **attrs):
    e = OxmlElement(tag)
    for k, v in attrs.items():
        e.set(qn(k), str(v))
    return e


def tbl_props(table, widths_mm, borders="sheet", spacing=None, cell_mar=(4.5, 7.5)):
    tbl = table._tbl
    tblPr = tbl.tblPr
    for child in list(tblPr):
        if child.tag in (qn("w:tblStyle"), qn("w:tblW"), qn("w:tblLayout"), qn("w:tblBorders"),
                         qn("w:tblCellMar"), qn("w:tblCellSpacing"), qn("w:tblLook")):
            tblPr.remove(child)
    total = sum(widths_mm)
    tblPr.append(_el("w:tblW", **{"w:w": int(total * 56.7), "w:type": "dxa"}))
    if spacing:
        tblPr.append(_el("w:tblCellSpacing", **{"w:w": int(spacing * 20), "w:type": "dxa"}))
    tblPr.append(_el("w:tblLayout", **{"w:type": "fixed"}))
    bd = OxmlElement("w:tblBorders")
    spec = {
        "sheet": dict(top=("single", 6, C["hair"]), left=("single", 6, C["hair"]), bottom=("single", 6, C["hair"]),
                      right=("single", 6, C["hair"]), insideH=("single", 4, C["hair2"]), insideV=("nil", 0, "auto")),
        "none": {k: ("nil", 0, "auto") for k in ("top", "left", "bottom", "right", "insideH", "insideV")},
        "rows": dict(top=("nil", 0, "auto"), left=("nil", 0, "auto"), bottom=("nil", 0, "auto"),
                     right=("nil", 0, "auto"), insideH=("single", 4, C["hair"]), insideV=("nil", 0, "auto")),
    }[borders]
    for side, (val, sz, col) in spec.items():
        bd.append(_el(f"w:{side}", **{"w:val": val, "w:sz": sz, "w:space": 0, "w:color": col}))
    tblPr.append(bd)
    mar = OxmlElement("w:tblCellMar")
    for side, v in (("top", cell_mar[0]), ("bottom", cell_mar[0]), ("left", cell_mar[1]), ("right", cell_mar[1])):
        mar.append(_el(f"w:{side}", **{"w:w": int(v * 20), "w:type": "dxa"}))
    tblPr.append(mar)
    grid = tbl.tblGrid
    for gc, w in zip(grid.findall(qn("w:gridCol")), widths_mm):
        gc.set(qn("w:w"), str(int(w * 56.7)))
    for row in table.rows:
        for cell, w in zip(row.cells, widths_mm):
            cell.width = Mm(w)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER


def cell_shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    tcPr.append(_el("w:shd", **{"w:val": "clear", "w:color": "auto", "w:fill": fill}))


def cell_borders(cell, color, sz=6, val="single", sides=("top", "left", "bottom", "right")):
    tcPr = cell._tc.get_or_add_tcPr()
    b = OxmlElement("w:tcBorders")
    for s in ("top", "left", "bottom", "right"):
        if s in sides:
            b.append(_el(f"w:{s}", **{"w:val": val, "w:sz": sz, "w:space": 0, "w:color": color}))
    tcPr.append(b)


def cell_valign(cell, v):
    cell._tc.get_or_add_tcPr().append(_el("w:vAlign", **{"w:val": v}))


def cell_margins(cell, top, right, bottom, left):
    tcPr = cell._tc.get_or_add_tcPr()
    m = OxmlElement("w:tcMar")
    for s, v in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        m.append(_el(f"w:{s}", **{"w:w": int(v * 20), "w:type": "dxa"}))
    tcPr.append(m)


def row_props(row, header=False, cant_split=True, height=None):
    trPr = row._tr.get_or_add_trPr()
    if cant_split:
        trPr.append(_el("w:cantSplit"))
    if header:
        trPr.append(_el("w:tblHeader"))
    if height:
        trPr.append(_el("w:trHeight", **{"w:val": int(height * 56.7), "w:hRule": "exact"}))


# --------------------------------------------------------------- inline HTML -> runs
def style_map(style):
    out = {}
    for part in (style or "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def css_color(v):
    if not v:
        return None
    m = re.search(r"#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b", v)
    if m:
        h = m.group(1)
        return (h * 2 if len(h) == 3 else h).upper() if len(h) == 6 else "".join(c * 2 for c in h).upper()
    m = re.search(r"var\((--[\w-]+)\)", v)
    if m and m.group(1) in CSSVAR:
        return CSSVAR[m.group(1)]
    if "#fff" in v.lower():
        return "FFFFFF"
    return None


class Ctx(dict):
    def child(self, **kw):
        c = Ctx(self)
        c.update(kw)
        return c


def inline_ctx(el, ctx):
    tag = el.tag if isinstance(el.tag, str) else ""
    cls = set((el.get("class") or "").split())
    c = ctx.child()
    if tag in ("strong", "b"):
        c["weight"] = 700
    if tag == "em":
        c["italic"] = True
    if tag == "code":
        c.update(role="mono", weight=500, size=round(ctx["size"] * 0.86 * 2) / 2, color=C["p900"], shade=C["p100"], pad=True)
    if tag == "a":
        c["color"] = C["p700"]
    if "mono" in cls:
        c.update(role="mono", weight=max(500, min(ctx["weight"], 600)), size=round(ctx["size"] * 0.9 * 2) / 2)
    if "pill" in cls or "ph" in cls or "pl" in cls:
        key = next((k for k in cls if k in PILL), None)
        col, shade, border = PILL.get(key, (C["ink"], None, None))
        c.update(role="mono" if "ph" in cls else "text", weight=600 if "ph" in cls else 700,
                 size=7.5, color=col, shade=shade, border=border, pad=True, nowrap=True)
    st = style_map(el.get("style"))
    if st:
        if "font" in st:
            m = re.match(r"(\d{3})\s+([\d.]+)px(?:/[\d.]+)?\s+var\(--(display|text|mono)\)", st["font"])
            if m:
                c.update(weight=int(m.group(1)), size=round(float(m.group(2)) * 0.75 * 2) / 2, role=m.group(3))
        if "font-size" in st and st["font-size"].endswith("px"):
            c["size"] = round(float(st["font-size"][:-2]) * 0.75 * 2) / 2
        if "font-weight" in st:
            c["weight"] = int(st["font-weight"])
        if "color" in st:
            c["color"] = css_color(st["color"]) or c.get("color")
        if "background" in st and ("pl" in cls):
            c["shade"] = css_color(st["background"])
        if "letter-spacing" in st and st["letter-spacing"].endswith("em"):
            c["spacing"] = float(st["letter-spacing"][:-2]) * c["size"]
        if st.get("text-transform") == "uppercase":
            c["caps"] = True
        if st.get("text-decoration") == "line-through":
            c["strike"] = True
    return c


def add_text(p, text, ctx):
    if not text:
        return
    text = re.sub(r"[ \t\r\n]+", " ", text)
    if ctx.get("pad"):
        text = NBSP + text.strip() + NBSP
    if ctx.get("nowrap"):
        text = text.replace(" ", NBSP)
    r = p.add_run(text)
    fmt_run(r, ctx["role"], ctx["weight"], ctx["size"], ctx.get("color"), ctx.get("italic", False),
            ctx.get("caps", False), ctx.get("spacing"), ctx.get("shade"), ctx.get("border"))
    if ctx.get("strike"):
        r.font.strike = True


def walk_inline(el, p, ctx, new_para=None):
    """Append el's inline content to paragraph p. Block-ish children (span.note)
    ask new_para() for a fresh paragraph and continue there."""
    add_text(p, el.text, ctx) if el.text and el.text.strip() or (el.text and p.runs) else None
    for ch in el:
        if not isinstance(ch.tag, str):
            if ch.tail:
                add_text(p, ch.tail, ctx)
            continue
        cls = set((ch.get("class") or "").split())
        if ch.tag == "br":
            p.add_run().add_break()
        elif "note" in cls and new_para:
            q = new_para()
            walk_inline(ch, q, ctx.child(size=8, color=C["muted"], weight=500))
            p = q
        else:
            walk_inline(ch, p, inline_ctx(ch, ctx), new_para)
        if ch.tail:
            add_text(p, ch.tail, ctx)
    return p


def cell_text(cell, el, ctx, after=0, line=12):
    p = cell.paragraphs[0]
    para_fmt(p, 0, after, line)

    def more():
        q = cell.add_paragraph()
        para_fmt(q, 1.5, after, line)
        return q
    walk_inline(el, p, ctx, more)
    return p


def text_len(el):
    return len(re.sub(r"\s+", " ", el.text_content()).strip())


# --------------------------------------------------------------- fragments rendered as images
def render_fragments(head_html, frags, workdir, name):
    """frags: list of (key, html, width_mm, bg). Returns {key: png_path}."""
    if not frags:
        return {}
    body = []
    for key, h, w, bg in frags:
        body.append(f'<div class="frag" style="width:{w}mm;background:#{bg}">{h}</div>')
    override = ("<style>@page{size:182mm 420mm;margin:0;background:#E9F0FD;"
                "@bottom-left{content:none}@bottom-right{content:none}}"
                "@page :first{margin:0}body{background:#E9F0FD;margin:0}.frag{display:flow-root;break-after:page;margin:0;padding:0;height:auto;"
                "overflow:hidden}.frag > *{margin-top:0!important;margin-bottom:0!important}</style>")
    page = head_html + override + '<div class="fragroot" style="display:block">' + "".join(body) + "</div>"
    hp = os.path.join(workdir, f"{name}_frags.html")
    pp = os.path.join(workdir, f"{name}_frags.pdf")
    with open(hp, "w", encoding="utf-8") as f:
        f.write(page)
    if os.path.exists(pp):
        os.remove(pp)
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--user-data-dir=" + os.path.join(os.environ.get("TEMP", "."), "atria-edge-print"), "--virtual-time-budget=15000",
                    f"--print-to-pdf={pp}", "file:///" + hp.replace("\\", "/")],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=240)
    _wait(pp)
    d = fitz.open(pp)
    if len(d) < len(frags):
        sys.exit(f"fragment render produced {len(d)} pages for {len(frags)} fragments")
    out = {}
    for i, (key, _, w, bg) in enumerate(frags):
        pix = d[i].get_pixmap(dpi=DPI)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        img = img.crop((0, 0, img.width, img.height - 8))   # page-size rounding leaves a white hairline at the foot

        def bbox_vs(im, hexcol):
            ref = Image.new("RGB", im.size, tuple(int(hexcol[j:j + 2], 16) for j in (0, 2, 4)))
            return ImageChops.difference(im, ref).convert("L").point(lambda v: 255 if v > 7 else 0).getbbox()
        # stage 1: the fragment's own area, against the render page's ground
        box = bbox_vs(img, "E9F0FD")
        if box:
            if bg.upper() != "E9F0FD":
                wpx = int(round(w / 25.4 * DPI))
                box = (0, box[1], min(img.width, wpx), box[3])
            img = img.crop(box)
        # stage 2: for icons, tighten to the drawn tile inside the fragment
        if key.startswith("ic_"):
            b2 = bbox_vs(img, bg)
            if b2:
                img = img.crop(b2)
        path = os.path.join(workdir, f"{name}_{key}.png")
        img.save(path, dpi=(DPI, DPI))
        out[key] = path
    return out


# --------------------------------------------------------------- drawing XML
_docpr = [100]


def _next_id():
    _docpr[0] += 1
    return _docpr[0]


def anchor_picture(run, rid, x_mm, y_mm, w_mm, h_mm, behind=True):
    i = _next_id()
    xml = f'''<w:drawing {NSDECL}><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="{251600000 + i}"
 behindDoc="{1 if behind else 0}" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>
<wp:positionH relativeFrom="page"><wp:posOffset>{mm_emu(x_mm)}</wp:posOffset></wp:positionH>
<wp:positionV relativeFrom="page"><wp:posOffset>{mm_emu(y_mm)}</wp:posOffset></wp:positionV>
<wp:extent cx="{mm_emu(w_mm)}" cy="{mm_emu(h_mm)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>
<wp:docPr id="{i}" name="Cover artwork {i}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
<pic:nvPicPr><pic:cNvPr id="{i}" name="cover.png"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{mm_emu(w_mm)}" cy="{mm_emu(h_mm)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>'''
    run._r.append(etree.fromstring(xml))


def anchor_textbox(run, x_mm, y_mm, w_mm, h_mm, content_elements, name):
    i = _next_id()
    xml = f'''<w:drawing {NSDECL}><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="{251700000 + i}"
 behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>
<wp:positionH relativeFrom="page"><wp:posOffset>{mm_emu(x_mm)}</wp:posOffset></wp:positionH>
<wp:positionV relativeFrom="page"><wp:posOffset>{mm_emu(y_mm)}</wp:posOffset></wp:positionV>
<wp:extent cx="{mm_emu(w_mm)}" cy="{mm_emu(h_mm)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>
<wp:docPr id="{i}" name="{name}"/><wp:cNvGraphicFramePr/>
<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp>
<wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{mm_emu(w_mm)}" cy="{mm_emu(h_mm)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>
<wps:txbx><w:txbxContent/></wps:txbx>
<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr>
</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'''
    dr = etree.fromstring(xml)
    tx = dr.find(".//{%s}txbxContent" % W_NS)
    for e in content_elements:
        tx.append(e)
    run._r.append(dr)


# --------------------------------------------------------------- the converter
class Converter:
    def __init__(self, html_path, pdf_path, out_path, footer, workdir):
        self.src = open(html_path, encoding="utf-8").read()
        self.html_dir = os.path.dirname(os.path.abspath(html_path))
        self.pdf_path, self.out_path, self.footer, self.work = pdf_path, out_path, footer, workdir
        self.name = os.path.splitext(os.path.basename(out_path))[0]
        root = lhtml.fromstring(f"<div id='__root'>{self.src}</div>")
        self.root = root
        self.main = root.find(".//main")
        self.head_html = "".join(lhtml.tostring(e, encoding="unicode") for e in root.iter("link", "style", "title"))
        self.doc = Document()
        self.frags, self.imgs = [], {}
        self.base = Ctx(role="text", weight=500, size=9.5, color=C["ink"])

    # ---------- document scaffolding
    def setup(self):
        d = self.doc
        sec = d.sections[0]
        sec.page_width, sec.page_height = Mm(PAGE_W), Mm(PAGE_H)
        sec.top_margin, sec.bottom_margin = Mm(M_TOP), Mm(M_BOT)
        sec.left_margin = sec.right_margin = Mm(M_SIDE)
        sec.footer_distance = Mm(7)
        sec.header_distance = Mm(7)
        sec.different_first_page_header_footer = True
        d.element.insert(0, etree.fromstring(f'<w:background xmlns:w="{W_NS}" w:color="{C["ground"]}"/>'))
        settings = d.settings.element
        settings.insert(0, etree.fromstring(f'<w:displayBackgroundShape xmlns:w="{W_NS}"/>'))

        st = d.styles
        normal = st["Normal"]
        set_font(normal.element.get_or_add_rPr(), FACE[("text", 500)][0])
        normal.font.size = Pt(9.5)
        normal.font.color.rgb = RGBColor.from_string(C["ink"])
        normal.paragraph_format.space_after = Pt(7.5)
        normal.paragraph_format.line_spacing = Pt(14.5)
        normal.paragraph_format.line_spacing_rule = WD_LINE_SPACING.AT_LEAST
        for name, role, w, size, color, before, after, pbb in (
                ("Heading 1", "display", 700, 20, C["ink"], 0, 12, True),
                ("Heading 2", "display", 600, 13, C["ink"], 18, 5, False),
                ("Heading 3", "text", 700, 8, C["muted"], 12, 5, False)):
            s = st[name]
            fam, bold = FACE[(role, w)]
            set_font(s.element.get_or_add_rPr(), fam)
            s.font.bold = bold
            s.font.italic = False
            s.font.size = Pt(size)
            s.font.color.rgb = RGBColor.from_string(color)
            s.font.all_caps = name == "Heading 3"
            pf = s.paragraph_format
            pf.space_before, pf.space_after = Pt(before), Pt(after)
            pf.keep_with_next = True
            pf.page_break_before = pbb
            pf.line_spacing = 1.0
        for sname in ("Normal", "Heading 1", "Heading 2", "Heading 3"):
            col = st[sname].element.get_or_add_rPr().find(qn("w:color"))
            if col is not None:
                for a in ("w:themeColor", "w:themeShade", "w:themeTint"):
                    if col.get(qn(a)) is not None:
                        del col.attrib[qn(a)]
        for name, role, w, size, color, ind in (("TOC 1", "text", 600, 10, C["ink"], 0), ("TOC 2", "text", 500, 9, C["ink2"], 9)):
            try:
                s = st[name]
            except KeyError:
                s = st.add_style(name, 1)
            s.base_style = st["Normal"]
            fam, bold = FACE[(role, w)]
            set_font(s.element.get_or_add_rPr(), fam)
            s.font.bold, s.font.size = bold, Pt(size)
            s.font.color.rgb = RGBColor.from_string(color)
            pf = s.paragraph_format
            pf.left_indent = Mm(ind)
            pf.space_before, pf.space_after = Pt(3 if name == "TOC 1" else 0), Pt(2)
            pf.tab_stops.add_tab_stop(Mm(CONTENT_W), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        self.setup_numbering()
        self.setup_footer()

    def setup_numbering(self):
        numbering = self.doc.part.numbering_part.element
        first_num = numbering.find(qn("w:num"))
        bullet = etree.fromstring(f'''<w:abstractNum xmlns:w="{W_NS}" w:abstractNumId="90"><w:multiLevelType w:val="singleLevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="400" w:hanging="220"/></w:pPr><w:rPr><w:rFonts w:ascii="Plus Jakarta Sans" w:hAnsi="Plus Jakarta Sans"/>
<w:color w:val="{C["p500"]}"/></w:rPr></w:lvl></w:abstractNum>''')
        dec = etree.fromstring(f'''<w:abstractNum xmlns:w="{W_NS}" w:abstractNumId="91"><w:multiLevelType w:val="singleLevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="440" w:hanging="300"/></w:pPr><w:rPr><w:rFonts w:ascii="IBM Plex Mono SemiBold" w:hAnsi="IBM Plex Mono SemiBold"/>
<w:color w:val="{C["p700"]}"/><w:sz w:val="17"/></w:rPr></w:lvl></w:abstractNum>''')
        for a in (bullet, dec):
            if first_num is not None:
                first_num.addprevious(a)
            else:
                numbering.append(a)
        numbering.append(etree.fromstring(f'<w:num xmlns:w="{W_NS}" w:numId="90"><w:abstractNumId w:val="90"/></w:num>'))
        self.numbering, self.next_num = numbering, 91

    def new_ol(self):
        self.next_num += 1
        n = self.next_num
        self.numbering.append(etree.fromstring(
            f'<w:num xmlns:w="{W_NS}" w:numId="{n}"><w:abstractNumId w:val="91"/>'
            f'<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'))
        return n

    def set_num(self, p, num_id):
        ppr = p._p.get_or_add_pPr()
        numpr = OxmlElement("w:numPr")
        numpr.append(_el("w:ilvl", **{"w:val": 0}))
        numpr.append(_el("w:numId", **{"w:val": num_id}))
        ppr.insert(0, numpr)

    def field(self, p, instr, placeholder, ctx):
        def r_(child):
            r = p.add_run()
            fmt_run(r, ctx["role"], ctx["weight"], ctx["size"], ctx["color"])
            r._r.append(child)
            return r
        r_(_el("w:fldChar", **{"w:fldCharType": "begin"}))
        it = OxmlElement("w:instrText"); it.set(qn("xml:space"), "preserve"); it.text = instr
        r_(it)
        r_(_el("w:fldChar", **{"w:fldCharType": "separate"}))
        r = p.add_run(placeholder); fmt_run(r, ctx["role"], ctx["weight"], ctx["size"], ctx["color"])
        r_(_el("w:fldChar", **{"w:fldCharType": "end"}))

    def setup_footer(self):
        sec = self.doc.sections[0]
        p = sec.footer.paragraphs[0]
        p.style = self.doc.styles["Normal"]
        para_fmt(p, 0, 0)
        p.paragraph_format.tab_stops.add_tab_stop(Mm(CONTENT_W), WD_TAB_ALIGNMENT.RIGHT)
        fmt_run(p.add_run(self.footer), "mono", 600, 7.5, C["muted"])
        ctx = Ctx(role="text", weight=500, size=7.5, color=C["muted"])
        fmt_run(p.add_run("\tPage "), **{k: ctx[k] for k in ("role", "weight", "size", "color")})
        self.field(p, " PAGE ", "1", ctx)
        fmt_run(p.add_run(" of "), **{k: ctx[k] for k in ("role", "weight", "size", "color")})
        self.field(p, " NUMPAGES ", "1", ctx)
        fp = sec.first_page_footer.paragraphs[0]
        para_fmt(fp, 0, 0)

    # ---------- cover
    def cover(self, header_el):
        # 1. artwork: the cover rendered with its editable words made transparent
        hide = ("<style>.cover h1,.cover .lede,.cover .meta .k,.cover .meta .v{color:transparent!important}</style>")
        page = self.head_html + hide + '<main class="doc">' + lhtml.tostring(header_el, encoding="unicode") + "</main>"
        hp = os.path.join(self.work, f"{self.name}_cover.html")
        pp = os.path.join(self.work, f"{self.name}_cover.pdf")
        open(hp, "w", encoding="utf-8").write(page)
        if os.path.exists(pp):
            os.remove(pp)
        subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--user-data-dir=" + os.path.join(os.environ.get("TEMP", "."), "atria-edge-print"), "--virtual-time-budget=15000",
                        f"--print-to-pdf={pp}", "file:///" + hp.replace("\\", "/")],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
        _wait(pp)
        pix = fitz.open(pp)[0].get_pixmap(dpi=200)
        art = os.path.join(self.work, f"{self.name}_cover.png")
        pix.save(art)

        # 2. where the words sit, measured from the real PDF
        pg = fitz.open(self.pdf_path)[0]
        k2mm = 25.4 / 72
        spans = [s for b in pg.get_text("dict")["blocks"] for l in b.get("lines", []) for s in l["spans"] if s["text"].strip()]
        title_s = [s for s in spans if s["size"] > 30]
        tx0 = min(s["bbox"][0] for s in title_s) * k2mm
        ty0 = min(s["bbox"][1] for s in title_s) * k2mm
        tx1 = max(s["bbox"][2] for s in title_s) * k2mm
        ty1 = max(s["bbox"][3] for s in title_s) * k2mm
        labels = {s["text"].strip().upper(): s for s in spans if 6 < s["size"] < 8.5}
        row1 = [labels[k] for k in ("DOCUMENT", "REVISION", "DATE", "STATUS")]
        xs = [s["bbox"][0] * k2mm for s in row1]
        pitch = xs[1] - xs[0]
        my0 = row1[0]["bbox"][1] * k2mm
        lede_s = [s for s in spans if 10 < s["size"] < 13 and s["bbox"][1] * k2mm > ty1 and s["bbox"][1] * k2mm < my0 - 20]
        ly1 = max(s["bbox"][3] for s in lede_s) * k2mm if lede_s else ty1 + 30
        lx1 = max(s["bbox"][2] for s in lede_s) * k2mm if lede_s else tx1

        body = self.doc.element.body
        p0 = self.doc.add_paragraph()
        para_fmt(p0, 0, 0)
        rid, _ = self.doc.part.get_or_add_image(art)
        anchor_picture(p0.add_run(), rid, 0, 0, PAGE_W, PAGE_H, behind=True)

        # title and lede
        h1 = header_el.find(".//h1")
        lede = header_el.find(".//p")
        scratch = []
        tp = self.doc.add_paragraph(); para_fmt(tp, 0, 0, 45, "exact")
        tp.paragraph_format.right_indent = Mm(max(0, (lx1 - tx0) - (tx1 - tx0) * 1.06))
        fmt_run(tp.add_run(h1.text_content().strip()), "display", 700, 44, "FFFFFF", spacing=-1.3)
        lp = self.doc.add_paragraph(); para_fmt(lp, 20, 0, 18, "exact")
        fmt_run(lp.add_run(re.sub(r"\s+", " ", lede.text_content()).strip()), "text", 500, 11.5, "EEF3FF")
        for e in (tp, lp):
            scratch.append(e._p)
            body.remove(e._p)
        r = p0.add_run()
        anchor_textbox(r, tx0, ty0 - 1.5, (lx1 - tx0) + 4, (ly1 - ty0) + 10, scratch, "Cover title")

        # document control grid inside the glass card
        cells = header_el.find_class("meta")[0].findall("div")
        t = self.doc.add_table(rows=4, cols=4)
        col_w = [pitch] * 4
        tbl_props(t, col_w, borders="none", cell_mar=(0, 0))
        for i, cdiv in enumerate(cells[:8]):
            k = cdiv.find_class("k")[0].text_content().strip()
            v = cdiv.find_class("v")[0]
            mono = "mono" in (v.get("class") or "")
            row, col = (i // 4) * 2, i % 4
            kp = t.cell(row, col).paragraphs[0]; para_fmt(kp, 0, 1.5)
            fmt_run(kp.add_run(k.upper()), "text", 700, 7, C["muted"], spacing=0.7)
            vp = t.cell(row + 1, col).paragraphs[0]; para_fmt(vp, 0, 8 if row == 0 else 0, 12)
            fmt_run(vp.add_run(v.text_content().strip()), "mono" if mono else "text", 600, 9.5 if mono else 10, C["ink"])
        tail = self.doc.add_paragraph(); para_fmt(tail, 0, 0)
        grid = [t._tbl, tail._p]
        for e in grid:
            body.remove(e)
        r = p0.add_run()
        anchor_textbox(r, xs[0], my0 - 0.6, pitch * 4, 32, grid, "Cover document control")
        br = self.doc.add_paragraph(); para_fmt(br, 0, 0)
        br.add_run().add_break(WD_BREAK.PAGE)

    # ---------- blocks
    def h(self, el, level):
        p = self.doc.add_paragraph(style=f"Heading {level}")
        n = el.find_class("n")
        if n:
            num = n[0].text_content().strip()
            if level == 1:
                fmt_run(p.add_run(f"{NBSP}{num}{NBSP}"), "mono", 600, 11, C["p600"], shade=C["p100"])
                fmt_run(p.add_run(NBSP * 2), "display", 700, 20)
            else:
                fmt_run(p.add_run(num + NBSP * 2), "mono", 600, 9.5, C["p700"])
        title = "".join(t for t in el.itertext() if t not in (n[0].text_content() if n else "",)).strip()
        if n:
            title = el.text_content().replace(n[0].text_content(), "", 1).strip()
        r = p.add_run(title)
        if level == 1:
            fmt_run(r, "display", 700, 20, C["ink"], spacing=-0.45)
        elif level == 2:
            fmt_run(r, "display", 600, 13, C["ink"], spacing=-0.15)
        else:
            fmt_run(r, "text", 700, 8, C["muted"], caps=True, spacing=0.8)
        return p

    def paragraph(self, el, ctx=None, before=0, after=7.5, line=14.5, style_fn=None):
        p = self.doc.add_paragraph()
        para_fmt(p, before, after, line)
        walk_inline(el, p, ctx or self.base)
        return p

    def eyebrow(self, el):
        p = self.doc.add_paragraph(); para_fmt(p, 14, 6, keep=True)
        fmt_run(p.add_run(el.text_content().strip()), "text", 700, 8, C["p700"], caps=True, spacing=1.1)

    def ulist(self, el, ordered=False):
        num = self.new_ol() if ordered else 90
        for li in el.findall("li"):
            p = self.doc.add_paragraph()
            para_fmt(p, 0, 2.5, 14)
            self.set_num(p, num)
            walk_inline(li, p, self.base)
        self.doc.paragraphs[-1].paragraph_format.space_after = Pt(8)

    def spacer(self, pts=6):
        p = self.doc.add_paragraph(); para_fmt(p, 0, 0, pts, "exact")
        return p

    def table(self, tw):
        tbl = tw.find(".//table")
        cap = tbl.find("caption")
        if cap is not None:
            p = self.doc.add_paragraph(); para_fmt(p, 4, 3, keep=True)
            fmt_run(p.add_run(cap.text_content().strip()), "text", 600, 8.5, C["muted"])
        heads = tbl.findall(".//thead/tr/th")
        rows = tbl.findall(".//tbody/tr")
        ncol = len(heads)
        # column widths from content
        cls = [set((th.get("class") or "").split()) for th in heads]
        body_cls = [set((td.get("class") or "").split()) for td in rows[0].findall("td")] if rows else [set()] * ncol
        lens = [[text_len(td) for td in r.findall("td")] for r in rows]
        fixed, weight = [], []
        for j in range(ncol):
            col = [l[j] for l in lens if j < len(l)] or [0]
            hl = len(heads[j].text_content().strip())
            is_pill = any(len(r.findall("td")) > j and r.findall("td")[j].find_class(k) for r in rows[:3] for k in ("pill", "ph", "pl"))
            if "id" in body_cls[j] or is_pill or max(col) <= 12:
                w = max(max(col) * (1.75 if "id" in body_cls[j] else 1.7), hl * 2.25, 8) + 6
                fixed.append(min(w, 42)); weight.append(0)
            else:
                fixed.append(None); weight.append(max(8.0, (sum(col) / len(col)) ** 0.62))
        rest = CONTENT_W - sum(f for f in fixed if f)
        tw_ = sum(weight) or 1
        widths = [f if f else max(18, rest * w / tw_) for f, w in zip(fixed, weight)]
        scale = CONTENT_W / sum(widths)
        widths = [w * scale for w in widths]

        t = self.doc.add_table(rows=1 + len(rows), cols=ncol)
        tbl_props(t, widths, "sheet")
        hdr = t.rows[0]
        row_props(hdr, header=True)
        for j, th in enumerate(heads):
            c = hdr.cells[j]
            cell_shade(c, C["tint"])
            cell_borders(c, C["hair"], 6, sides=("bottom",))
            p = c.paragraphs[0]; para_fmt(p, 0, 0, 10)
            if "num" in cls[j]:
                p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            fmt_run(p.add_run(th.text_content().strip().upper()), "text", 700, 6.5, C["muted"], spacing=0.6)
        for i, tr in enumerate(rows):
            row = t.rows[i + 1]
            row_props(row)
            for j, td in enumerate(tr.findall("td")[:ncol]):
                c = row.cells[j]
                cell_shade(c, C["white"])
                tcls = set((td.get("class") or "").split())
                ctx = Ctx(role="text", weight=500, size=8.5, color=C["ink"])
                if "id" in tcls:
                    ctx.update(role="mono", weight=600, size=8, color=C["p800"])
                if "tr" in tcls:
                    ctx.update(role="mono", weight=500, size=7.5, color=C["muted"])
                p = cell_text(c, td, ctx)
                if "num" in tcls or td.find_class("num"):
                    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        self.spacer(8)

    def callout(self, el):
        kind = next(k for k in ("info", "warn", "risk") if k in el.get("class"))
        fill, border = CALLOUT[kind]
        t = self.doc.add_table(rows=1, cols=2)
        tbl_props(t, [11, CONTENT_W - 11], "none", cell_mar=(6, 6))
        row_props(t.rows[0])
        for c in t.rows[0].cells:
            cell_shade(c, fill)
        a, b = t.rows[0].cells
        cell_borders(a, border, 6, sides=("top", "left", "bottom"))
        cell_borders(b, border, 6, sides=("top", "right", "bottom"))
        cell_margins(a, 9, 0, 9, 10)
        cell_margins(b, 9, 12, 9, 6)
        ip = a.paragraphs[0]; para_fmt(ip, 0, 0)
        ip.add_run().add_picture(self.imgs[f"ic_{kind}"], width=Mm(7.4))
        tp = b.paragraphs[0]; para_fmt(tp, 0, 2, 13)
        fmt_run(tp.add_run(el.find_class("t")[0].text_content().strip()), "text", 700, 9.5, C["ink"])
        bp = b.add_paragraph(); para_fmt(bp, 0, 0, 14)
        walk_inline(el.find(".//p"), bp, self.base)
        self.spacer(8)

    def tiles(self, el):
        tiles = el.find_class("tile")
        n = len(tiles)
        w = (CONTENT_W - (n - 1) * 3.5) / n
        t = self.doc.add_table(rows=1, cols=n)
        tbl_props(t, [w] * n, "none", spacing=3.5, cell_mar=(8, 9))
        row_props(t.rows[0])
        for c, tile in zip(t.rows[0].cells, tiles):
            cell_shade(c, C["white"]); cell_borders(c, C["hair"], 6)
            p = c.paragraphs[0]; para_fmt(p, 2, 3, 24)
            fmt_run(p.add_run(tile.find_class("v")[0].text_content().strip()), "display", 700, 20, C["ink"], spacing=-0.4)
            q = c.add_paragraph(); para_fmt(q, 0, 2, 11)
            fmt_run(q.add_run(tile.find_class("l")[0].text_content().strip()), "text", 600, 8.5, C["muted"])
        self.spacer(8)

    def sig(self, el):
        boxes = el.findall("div")
        w = (CONTENT_W - 2 * 3.5) / 3
        t = self.doc.add_table(rows=1, cols=3)
        tbl_props(t, [w] * 3, "none", spacing=3.5, cell_mar=(8, 9))
        for c, bx in zip(t.rows[0].cells, boxes):
            cell_shade(c, C["white"]); cell_borders(c, C["p200"], 6, val="dashed")
            p = c.paragraphs[0]; para_fmt(p, 0, 2)
            fmt_run(p.add_run(bx.find_class("k")[0].text_content().strip().upper()), "text", 700, 7, C["muted"], spacing=0.7)
            q = c.add_paragraph(); para_fmt(q, 0, 22)
            fmt_run(q.add_run(bx.find_class("v")[0].text_content().strip()), "text", 600, 10, C["ink"])
        self.spacer(6)

    def gwt(self, el):
        head = el.find_class("h")[0]
        ks, vs = el.find_class("k"), [s for s in el.findall("span") if "k" not in (s.get("class") or "")]
        t = self.doc.add_table(rows=1 + len(ks), cols=2)
        tbl_props(t, [17, CONTENT_W - 17], "none", cell_mar=(2.5, 8))
        top = t.cell(0, 0).merge(t.cell(0, 1))
        for r in t.rows:
            row_props(r)
            for c in r.cells:
                cell_shade(c, C["white"])
        # outline the block
        for i, r in enumerate(t.rows):
            for j, c in enumerate(r.cells):
                sides = []
                if i == 0: sides.append("top")
                if i == len(t.rows) - 1: sides.append("bottom")
                if j == 0: sides.append("left")
                if j == len(r.cells) - 1 or i == 0: sides.append("right")
                cell_borders(c, C["hair"], 6, sides=tuple(sides))
        p = top.paragraphs[0]; para_fmt(p, 3, 3)
        walk_inline(head, p, Ctx(role="text", weight=700, size=9, color=C["ink"]))
        for i, (k, v) in enumerate(zip(ks, vs), 1):
            kp = t.cell(i, 0).paragraphs[0]; para_fmt(kp, 0, 0, 12)
            fmt_run(kp.add_run(k.text_content().strip()), "mono", 600, 7.5, C["p700"], spacing=0.4)
            vp = t.cell(i, 1).paragraphs[0]; para_fmt(vp, 0, 0, 12)
            walk_inline(v, vp, Ctx(role="text", weight=500, size=9, color=C["ink"]))
        self.spacer(6)

    def picture_block(self, key, frame=False, caption=None, path=None, max_h=None):
        path = path or self.imgs[key]
        wpx, hpx = Image.open(path).size
        w_mm = wpx / DPI * 25.4
        if max_h:
            # a raster figure fills the width unless that would make it taller than max_h
            w_mm = min(CONTENT_W - 6, (CONTENT_W - 6) * max_h / ((CONTENT_W - 6) * hpx / wpx))
        if frame:
            t = self.doc.add_table(rows=1, cols=1)
            tbl_props(t, [CONTENT_W], "none", cell_mar=(8, 8))
            c = t.cell(0, 0); cell_shade(c, C["white"]); cell_borders(c, C["hair"], 6)
            row_props(t.rows[0])
            p = c.paragraphs[0]; para_fmt(p, 0, 0); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.add_run().add_picture(path, width=Mm(min(w_mm, CONTENT_W - 6)))
        else:
            p = self.doc.add_paragraph(); para_fmt(p, 3, 3)
            p.add_run().add_picture(path, width=Mm(min(w_mm, CONTENT_W)))
        if caption is not None:
            q = self.doc.add_paragraph(); para_fmt(q, 5, 10, 12)
            walk_inline(caption, q, Ctx(role="text", weight=500, size=8.5, color=C["muted"]))
        elif frame:
            self.spacer(6)

    def toc(self):
        p = self.doc.add_paragraph(); para_fmt(p, 0, 0)
        self.field(p, ' TOC \\o "1-2" \\h \\z \\u ', "Right-click and choose Update Field to build the contents.",
                   Ctx(role="text", weight=500, size=9, color=C["muted"]))

    # ---------- design-spec blocks
    def swatches(self, el):
        cells = el.findall("div")
        t = self.doc.add_table(rows=1, cols=len(cells))
        tbl_props(t, [CONTENT_W / len(cells)] * len(cells), "none", cell_mar=(5, 5))
        row_props(t.rows[0], height=19)
        for c, d in zip(t.rows[0].cells, cells):
            st = style_map(d.get("style"))
            cell_shade(c, css_color(st.get("background")) or "FFFFFF")
            cell_valign(c, "bottom")
            col = css_color(st.get("color")) or C["ink"]
            span = d.find("span")
            label = (d.text or "").strip()
            p = c.paragraphs[0]; para_fmt(p, 0, 0, 10)
            fmt_run(p.add_run(label), "text", 700, 7.5, col)
            q = c.add_paragraph(); para_fmt(q, 0, 0, 9)
            fmt_run(q.add_run(span.text_content().strip() if span is not None else ""), "mono", 500, 6.5, col)
        self.spacer(6)

    def chips(self, el):
        boxes = el.findall("div")
        per = 4
        w = (CONTENT_W - (per - 1) * 3) / per
        rows = [boxes[i:i + per] for i in range(0, len(boxes), per)]
        t = self.doc.add_table(rows=len(rows), cols=per)
        tbl_props(t, [w] * per, "none", spacing=3, cell_mar=(6, 7))
        for r, grp in zip(t.rows, rows):
            row_props(r)
            for c, d in zip(r.cells, grp):
                st = style_map(d.get("style"))
                bg = css_color(st.get("background")) or "FFFFFF"
                if "gradient" in st.get("background", ""):
                    bg = "7348DA"
                cell_shade(c, bg)
                col = css_color(st.get("color")) or C["ink"]
                p = c.paragraphs[0]; para_fmt(p, 0, 1)
                fmt_run(p.add_run(d.find_class("h")[0].text_content().strip()), "text", 700, 8.5, col)
                q = c.add_paragraph(); para_fmt(q, 0, 0)
                fmt_run(q.add_run(d.find_class("x")[0].text_content().strip()), "mono", 500, 7, col)
        self.spacer(6)

    def keyvalue(self, el, kind):
        rows = el.find_class("row")
        kw = 40 if kind == "type" else 26
        t = self.doc.add_table(rows=len(rows), cols=2)
        tbl_props(t, [kw, CONTENT_W - kw], "rows", cell_mar=(5, 2))
        for r, rowel in zip(t.rows, rows):
            row_props(r)
            k = rowel.find_class("k")[0]
            v = [s for s in rowel if s is not k][0]
            kp = r.cells[0].paragraphs[0]; para_fmt(kp, 0, 0, 12)
            fmt_run(kp.add_run(k.text_content().strip()), "mono", 600, 7.5, C["muted"])
            cell_valign(r.cells[0], "center" if kind == "type" else "top")
            vctx = inline_ctx(v, self.base.child(size=9)) if kind == "type" else self.base.child(size=9)
            vp = r.cells[1].paragraphs[0]; para_fmt(vp, 0, 0, 12)
            if kind == "type":
                add_text(vp, v.text_content().strip(), vctx)
            else:
                walk_inline(v, vp, vctx)
        self.spacer(6)

    def inventory(self, el):
        cards = el.findall("div")
        per = 3
        w = (CONTENT_W - (per - 1) * 3.5) / per
        grp = [cards[i:i + per] for i in range(0, len(cards), per)]
        t = self.doc.add_table(rows=len(grp), cols=per)
        tbl_props(t, [w] * per, "none", spacing=3.5, cell_mar=(7, 8))
        for r, g in zip(t.rows, grp):
            row_props(r)
            for c, card in zip(r.cells, g):
                cell_shade(c, C["white"]); cell_borders(c, C["hair"], 6)
                h = card.find_class("h")[0]
                p = c.paragraphs[0]; para_fmt(p, 0, 1)
                p.paragraph_format.tab_stops.add_tab_stop(Mm(w - 16), WD_TAB_ALIGNMENT.RIGHT)
                fmt_run(p.add_run(h.find("b").text_content()), "display", 600, 10.5, C["ink"])
                fmt_run(p.add_run("\t" + h.find("span").text_content()), "display", 700, 15, C["p700"])
                q = c.add_paragraph(); para_fmt(q, 0, 3)
                fmt_run(q.add_run(card.find_class("d")[0].text_content()), "mono", 500, 7, C["muted"])
                cl = [d for d in card.findall("div") if not d.get("class")]
                if cl:
                    q = c.add_paragraph(); para_fmt(q, 0, 3)
                    fmt_run(q.add_run(cl[0].text_content()), "text", 600, 8, C["p800"])
                for li in card.findall(".//li"):
                    q = c.add_paragraph(); para_fmt(q, 0, 0, 11)
                    fmt_run(q.add_run("\u2022  "), "text", 700, 8, C["p500"])
                    fmt_run(q.add_run(li.text_content()), "text", 500, 8, C["ink2"])
        self.spacer(6)

    def code_block(self, el):
        t = self.doc.add_table(rows=1, cols=1)
        tbl_props(t, [CONTENT_W], "none", cell_mar=(9, 11))
        c = t.cell(0, 0); cell_shade(c, "0B1733")
        lines = el.text_content().split("\n")
        first = True
        for ln in lines:
            p = c.paragraphs[0] if first else c.add_paragraph()
            first = False
            para_fmt(p, 0, 0, 10, "exact")
            r = p.add_run(ln.replace(" ", NBSP) if ln.startswith(" ") else ln)
            fmt_run(r, "mono", 500, 7, "DCE8FE")
        self.spacer(6)

    def foot(self, el):
        p = self.doc.add_paragraph(); para_fmt(p, 24, 0, 12)
        p_border_top(p, C["hair"])
        walk_inline(el, p, Ctx(role="text", weight=500, size=8.5, color=C["muted"]))

    # ---------- traversal
    def collect_fragments(self):
        """Queue every element Word cannot draw, in document order."""
        n = 0
        for el in self.main.iter():
            if not isinstance(el.tag, str):
                continue
            cls = set((el.get("class") or "").split())
            key = None
            if el.tag == "figure":
                svg = el.find(".//svg")
                if svg is not None:
                    key, h, w, bg = f"fig{n}", lhtml.tostring(svg, encoding="unicode"), CONTENT_W - 8, "FFFFFF"
            elif "demo" in cls:
                key, h, w, bg = f"demo{n}", lhtml.tostring(el, encoding="unicode"), CONTENT_W, C["ground"]
            elif "field-demo" in cls:
                key, h, w, bg = f"field{n}", lhtml.tostring(el, encoding="unicode"), CONTENT_W, C["ground"]
            elif "shapes" in cls:
                key, h, w, bg = f"shapes{n}", lhtml.tostring(el, encoding="unicode"), CONTENT_W, C["ground"]
            if key:
                el.set("data-frag", key)
                self.frags.append((key, h, w, bg))
                n += 1
        from atria_doc import ICON
        for kind, (fill, _) in CALLOUT.items():
            h = (f'<div class="callout {kind}" style="margin:0;padding:0;background:none;border:0;box-shadow:none;'
                 f'display:inline-flex"><div class="ic" style="margin:0">{ICON[kind]}</div></div>')
            self.frags.append((f"ic_{kind}", h, 20, fill))

    def blocks(self, container):
        for el in container:
            if not isinstance(el.tag, str):
                continue
            cls = set((el.get("class") or "").split())
            tag = el.tag
            if tag == "h2":
                self.h(el, 1)
            elif tag == "h3":
                self.h(el, 2)
            elif tag == "h4":
                self.h(el, 3)
            elif tag == "p" and "eyebrow" in cls:
                self.eyebrow(el)
                if el.text_content().strip() == "Contents":
                    self.toc()
            elif tag == "p" and "foot" in cls:
                self.foot(el)
            elif tag == "p":
                self.paragraph(el)
            elif tag == "ol" and "toc" in cls:
                continue          # replaced by the live TOC field
            elif tag == "ul":
                self.ulist(el)
            elif tag == "ol":
                self.ulist(el, ordered=True)
            elif "tw" in cls:
                self.table(el)
            elif "callout" in cls:
                self.callout(el)
            elif "tiles" in cls:
                self.tiles(el)
            elif "sig" in cls:
                self.sig(el)
            elif "gwt" in cls:
                self.gwt(el)
            elif tag == "figure" and el.find(".//img") is not None:
                img = el.find(".//img")
                src = os.path.normpath(os.path.join(self.html_dir, img.get("src")))
                self.picture_block(None, frame=True, caption=el.find("figcaption"), path=src,
                                   max_h=float(img.get("data-maxh") or 215))
            elif tag == "figure":
                self.picture_block(el.get("data-frag"), frame=True, caption=el.find("figcaption"))
            elif el.get("data-frag"):
                self.picture_block(el.get("data-frag"))
            elif "sw-row" in cls:
                self.swatches(el)
            elif "chips-row" in cls:
                self.chips(el)
            elif "type-spec" in cls:
                self.keyvalue(el, "type")
            elif "spec" in cls:
                self.keyvalue(el, "spec")
            elif "inv" in cls:
                self.inventory(el)
            elif tag == "pre":
                self.code_block(el)
            elif tag in ("section", "div"):
                self.blocks(el)

    def build(self):
        self.setup()
        self.collect_fragments()
        self.imgs = render_fragments(self.head_html, self.frags, self.work, self.name)
        for el in self.main:
            if not isinstance(el.tag, str):
                continue
            if el.tag == "header" and "cover" in (el.get("class") or ""):
                self.cover(el)
            else:
                self.blocks([el] if el.tag in ("h2",) else el)
        # python-docx's default body starts with no paragraph; drop any trailing empty one
        self.doc.save(self.out_path)
        return self.out_path


def finish_in_word(docx_path, pdf_check=None):
    """Update the TOC and page fields, embed the fonts, save; optionally export a check PDF."""
    import win32com.client as w32
    word = w32.DispatchEx("Word.Application")
    word.Visible = False
    try:
        doc = word.Documents.Open(os.path.abspath(docx_path))
        for toc in doc.TablesOfContents:
            toc.Update()
        doc.Fields.Update()
        doc.EmbedTrueTypeFonts = True
        doc.SaveSubsetFonts = False
        doc.DoNotEmbedSystemFonts = True
        doc.Save()
        if pdf_check:
            word.Options.PrintBackground = True
            doc.SaveAs2(os.path.abspath(pdf_check), FileFormat=17)
        pages = doc.ComputeStatistics(2)
        doc.Close(False)
        return pages
    finally:
        word.Quit()
