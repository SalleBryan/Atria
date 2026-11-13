"""
Atria document system.

One stylesheet and a handful of HTML builders shared by the Software
Requirements Specification and the Design Specification, so both documents
read as the same product as the Atria apps themselves: the blue field, glass
panels spent by role, Outfit for display and numerals, Plus Jakarta Sans for
running text, IBM Plex Mono for identifiers.

The same file serves two outputs. On screen it is a responsive page; in print
(headless Edge, A4) it paginates with a full-bleed cover and running footers.
No <html>/<head>/<body> tags are emitted, so the file can also be published
as an Artifact unchanged.
"""

import html as _html
import os
import subprocess

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

FONTS = ("https://fonts.googleapis.com/css2?"
         "family=Outfit:wght@500;600;700"
         "&family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;1,500"
         "&family=IBM+Plex+Mono:wght@500;600&display=swap")

# Atria Foundations v1, Rev. A. Every value below is lifted from the canvas.
CSS = r"""
:root{
  --ground:#E9F0FD; --surface:#FFFFFF; --ink:#0D1B34; --ink-2:#2C3D60; --muted:#5A6C8E;
  --hair:#DCE5F5; --hair-2:#E9EFFA; --tint:#F3F7FF;
  --p100:#E3EDFE; --p200:#BFD5FE; --p400:#7AA8FA; --p500:#4A83F0; --p600:#2F6BE4;
  --p700:#2461DB; --p800:#1B4FB8; --p900:#0B2B6B;
  --ok:#0E9C6B; --ok-ink:#0B7A53; --wait:#D98324; --wait-ink:#9B5E0E;
  --bad:#D6485A; --bad-ink:#B93B4C; --admin:#5B34C4; --admin-2:#8B5CF0;
  --display:'Outfit','Segoe UI',system-ui,sans-serif;
  --text:'Plus Jakarta Sans','Segoe UI',system-ui,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,Consolas,monospace;
  --shadow:0 4px 22px rgba(16,42,94,.10);
  --glass:linear-gradient(150deg,rgba(255,255,255,.95),rgba(255,255,255,.74));
  --spring:cubic-bezier(.2,.9,.25,1.15);
}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--ground);color:var(--ink);font:500 13.5px/1.62 var(--text);
  font-variant-ligatures:common-ligatures}
.doc{max-width:900px;margin:0 auto;padding:28px 22px 80px;display:flex;flex-direction:column;gap:0}
a{color:var(--p700);text-decoration-thickness:1px;text-underline-offset:2px}
a:focus-visible{outline:3px solid var(--p400);outline-offset:2px;border-radius:4px}
p{margin:0 0 10px;max-width:72ch}
strong,b{font-weight:700;color:var(--ink)}
code,.mono{font-family:var(--mono);font-size:.86em;font-weight:500}
code{background:var(--p100);color:var(--p900);padding:1px 5px;border-radius:6px}

/* ---------- cover: an Atria screen, not a title page ---------- */
.cover{position:relative;overflow:hidden;border-radius:38px;color:#fff;
  padding:46px 48px 44px;min-height:600px;display:flex;flex-direction:column;gap:26px;
  background:
    radial-gradient(420px 420px at 88% 8%,rgba(150,190,255,.55),rgba(150,190,255,0) 70%),
    radial-gradient(380px 380px at 4% 92%,rgba(205,224,255,.55),rgba(205,224,255,0) 70%),
    linear-gradient(168deg,#123A8C 0%,#2C63DE 38%,#5E93F2 66%,#DDE9FE 100%);
  box-shadow:0 18px 50px rgba(18,58,140,.28)}
.cover .brand{display:flex;align-items:center;gap:13px}
.cover .mark{width:46px;height:46px;border-radius:16px;display:grid;place-items:center;
  background:linear-gradient(150deg,rgba(255,255,255,.34),rgba(255,255,255,.14));
  border:1px solid rgba(255,255,255,.45);box-shadow:inset 0 1px 0 rgba(255,255,255,.5)}
.cover .wm{font:600 20px/1 var(--display);letter-spacing:.14em}
.cover .wm small{display:block;font:600 10.5px/1.4 var(--text);letter-spacing:.14em;opacity:.8;margin-top:5px}
.cover .kicker{display:inline-flex;align-self:flex-start;gap:8px;align-items:center;
  font:700 10.5px/1 var(--text);letter-spacing:.12em;text-transform:uppercase;
  padding:8px 13px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.34)}
.cover h1{font:700 50px/1.02 var(--display);letter-spacing:-.03em;margin:0;max-width:13ch;text-wrap:balance}
.cover .lede{font:500 15.5px/1.55 var(--text);max-width:52ch;opacity:.92;margin:0}
.cover .spacer{flex:1}
.cover .meta{border-radius:26px;padding:20px 22px;color:var(--ink);
  background:linear-gradient(150deg,rgba(255,255,255,.93),rgba(255,255,255,.78));
  border:1px solid rgba(255,255,255,.96);box-shadow:0 10px 30px rgba(10,32,80,.18),inset 0 1px 0 #fff;
  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px 18px}
.cover .meta div{display:flex;flex-direction:column;gap:3px;min-width:0}
.cover .meta .k{font:700 9.5px/1.2 var(--text);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.cover .meta .v{font:600 13px/1.35 var(--text);color:var(--ink);overflow-wrap:anywhere}
.cover .meta .v.mono{font:600 12.5px/1.35 var(--mono)}

/* ---------- document control + contents ---------- */
.block{margin-top:30px}
.eyebrow{font:700 10.5px/1 var(--text);letter-spacing:.14em;text-transform:uppercase;color:var(--p700);margin:0 0 10px}
.toc{columns:2;column-gap:34px;list-style:none;padding:0;margin:0}
.toc li{break-inside:avoid;display:flex;gap:10px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--hair)}
.toc .n{font:600 12px/1.4 var(--mono);color:var(--p700);min-width:30px}
.toc a{color:var(--ink);text-decoration:none;font-weight:600}
.toc li.sub{padding-left:40px;border-bottom-style:dotted}
.toc li.sub a{font-weight:500;color:var(--ink-2)}

/* ---------- chapters ---------- */
.chapter{margin-top:44px}
.chapter > h2{display:flex;gap:14px;align-items:baseline;font:700 27px/1.15 var(--display);
  letter-spacing:-.022em;margin:0 0 16px;text-wrap:balance}
.chapter > h2 .n{font:600 15px/1 var(--mono);color:var(--p600);background:var(--p100);
  padding:7px 10px;border-radius:12px;flex:none;transform:translateY(-3px)}
h3{font:600 17px/1.3 var(--display);letter-spacing:-.012em;margin:26px 0 8px;text-wrap:balance}
h3 .n{font:600 12.5px/1 var(--mono);color:var(--p700);margin-right:8px}
h4{font:700 11px/1.3 var(--text);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px}
ul.clean{margin:0 0 12px;padding-left:18px}
ul.clean li{margin:3px 0;max-width:70ch}
ul.clean li::marker{color:var(--p500)}

/* glass is spent by role: callouts and key panels only */
.callout{border-radius:22px;padding:15px 18px;margin:14px 0;display:flex;gap:12px;align-items:flex-start;
  background:var(--glass);border:1px solid rgba(255,255,255,.96);box-shadow:var(--shadow),inset 0 1px 0 #fff}
.callout .ic{flex:none;width:28px;height:28px;border-radius:10px;display:grid;place-items:center;margin-top:1px}
.callout .t{font:700 13px/1.4 var(--text);margin-bottom:3px}
.callout p{margin:0;font-size:13px;max-width:none}
.callout.info .ic{background:rgba(47,107,228,.12)}
.callout.warn{background:linear-gradient(150deg,#FFF9F1,#FFF4E6);border-color:rgba(217,131,36,.25)}
.callout.warn .ic{background:rgba(217,131,36,.16)}
.callout.risk{background:linear-gradient(150deg,#FFF6F7,#FDEDEF);border-color:rgba(214,72,90,.24)}
.callout.risk .ic{background:rgba(214,72,90,.14)}

/* tables: white sheets, not cards stacked on cards */
.tw{overflow-x:auto;margin:12px 0 18px;border-radius:20px;background:var(--surface);
  border:1px solid var(--hair);box-shadow:0 1px 8px rgba(16,42,94,.05)}
table{border-collapse:collapse;width:100%;font-size:12.5px;line-height:1.5}
caption{caption-side:top;text-align:left;font:600 11.5px/1.4 var(--text);color:var(--muted);padding:12px 16px 0}
th{font:700 9.5px/1.3 var(--text);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);
  text-align:left;padding:11px 12px 9px;border-bottom:1px solid var(--hair);background:var(--tint);white-space:nowrap}
td{padding:9px 12px;border-bottom:1px solid var(--hair-2);vertical-align:top}
tr:last-child td{border-bottom:0}
td.id{font:600 11.5px/1.5 var(--mono);color:var(--p800);white-space:nowrap}
td.tr{font:500 10.5px/1.5 var(--mono);color:var(--muted)}
td .note{display:block;color:var(--muted);font-size:11.5px;margin-top:3px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.pill{display:inline-block;font:700 10px/1 var(--text);letter-spacing:.02em;padding:5px 9px;border-radius:999px;white-space:nowrap}
.must{background:var(--p700);color:#fff}
.should{background:var(--p100);color:var(--p800)}
.could{background:transparent;color:var(--muted);box-shadow:inset 0 0 0 1px var(--hair)}
.ph{display:inline-block;font:600 10px/1 var(--mono);padding:5px 7px;border-radius:8px;white-space:nowrap}
.ph1{background:#E4F4EF;color:var(--ok-ink)} .ph2{background:var(--p100);color:var(--p800)} .ph3{background:#FAEFE3;color:var(--wait-ink)}
.st-ok{background:#E4F4EF;color:var(--ok-ink)} .st-wait{background:#FAEFE3;color:var(--wait-ink)}
.st-bad{background:#FAE9EB;color:var(--bad-ink)} .st-info{background:var(--p100);color:var(--p800)}

/* summary tiles: only where the figures are the point */
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0 18px}
.tile{border-radius:22px;padding:15px 16px;background:var(--surface);border:1px solid var(--hair)}
.tile .v{font:700 28px/1 var(--display);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tile .l{font:600 11.5px/1.35 var(--text);color:var(--muted);margin-top:6px}

figure{margin:14px 0 20px}
figure .frame{border-radius:24px;background:var(--surface);border:1px solid var(--hair);padding:18px;overflow-x:auto}
figcaption{font:500 11.5px/1.5 var(--text);color:var(--muted);margin-top:8px;max-width:80ch}
svg text{font-family:var(--text)}

.gwt{border-radius:18px;background:var(--surface);border:1px solid var(--hair);padding:13px 16px;margin:10px 0;
  display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12.5px;break-inside:avoid}
.gwt .h{grid-column:1/-1;font:700 12.5px/1.4 var(--text);display:flex;gap:10px;align-items:center;margin-bottom:4px}
.gwt .k{font:700 10px/1.9 var(--mono);color:var(--p700);letter-spacing:.06em}

.sig{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.sig div{border-radius:18px;border:1px dashed var(--p200);padding:14px 16px 34px;background:var(--surface)}
.sig .k{font:700 9.5px/1.2 var(--text);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.sig .v{font:600 13px/1.4 var(--text);margin-top:4px}

.foot{margin-top:50px;color:var(--muted);font-size:11.5px;border-top:1px solid var(--hair);padding-top:12px}

@media (max-width:700px){
  .cover{padding:32px 26px;border-radius:30px;min-height:0}
  .cover h1{font-size:36px}
  .cover .meta{grid-template-columns:repeat(2,minmax(0,1fr))}
  .toc{columns:1}
  .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .sig{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}

/* ---------- print: A4, full-bleed cover, running footer ---------- */
/* Chrome lays out every page at one width, so every page keeps the same side
   margins; the cover is a rounded Atria panel on the ground, not full bleed. */
@page{size:A4;margin:15mm 14mm 17mm 14mm;background:#E9F0FD;
  @bottom-right{content:"Page " counter(page) " of " counter(pages);
    font:500 8pt 'Plus Jakarta Sans',sans-serif;color:#5A6C8E}
  @bottom-left{content:"__FOOTER__";font:600 8pt 'IBM Plex Mono',monospace;color:#5A6C8E}
}
@page :first{@bottom-right{content:none}@bottom-left{content:none}}
@media print{
  body{font-size:9.6pt;line-height:1.55;background:transparent}
  .doc{max-width:none;padding:0}
  .cover{border-radius:34px;height:263mm;min-height:0;padding:16mm 15mm 14mm;box-shadow:none;break-after:page}
  .cover h1{font-size:44pt}
  .chapter{break-before:page;margin-top:0}
  .chapter.cont{break-before:auto;margin-top:26px}
  .block{break-inside:avoid}
  h3,h4{break-after:avoid}
  tr,.callout,.tile,figure,.gwt{break-inside:avoid}
  thead{display:table-header-group}
  .tw{overflow:visible;box-shadow:none}
  table{font-size:8.4pt}
  td.id{font-size:8pt} td.tr{font-size:7.4pt}
  th{font-size:6.8pt}
  .callout{box-shadow:none}
  a{color:var(--ink);text-decoration:none}
  .noprint{display:none}
}
"""

MARK_SVG = ('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" '
            'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            '<path d="M3 12h4l2-5 3 10 2.5-6 1.8 3H21"/></svg>')

ICON = {
    "info": ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2F6BE4" stroke-width="2.2" '
             'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4.5M12 8h.01"/></svg>'),
    "warn": ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9B5E0E" stroke-width="2.2" '
             'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'),
    "risk": ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B93B4C" stroke-width="2.2" '
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>'),
}


def esc(s):
    return _html.escape(str(s), quote=True)


def head(title, footer):
    css = CSS.replace("__FOOTER__", footer)
    return (f'<meta charset="utf-8">\n<title>{esc(title)}</title>\n'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">\n'
            f'<link rel="stylesheet" href="{FONTS}">\n<style>{css}</style>\n')


def cover(kicker, title, lede, meta):
    cells = "".join(
        f'<div><span class="k">{esc(k)}</span><span class="v{" mono" if m else ""}{" docid" if k == "Document" else ""}">{esc(v)}</span></div>'
        for k, v, m in meta)
    return f"""<header class="cover">
  <div class="brand"><div class="mark">{MARK_SVG}</div>
    <div class="wm">ATRIA<small>HEALTHCARE APPOINTMENTS</small></div></div>
  <span class="kicker">{esc(kicker)}</span>
  <h1>{esc(title)}</h1>
  <p class="lede">{lede}</p>
  <div class="spacer"></div>
  <div class="meta">{cells}</div>
</header>"""


def chapter(num, title, body, anchor, cont=False):
    return (f'<section class="chapter{" cont" if cont else ""}" id="{anchor}">'
            f'<h2><span class="n">{esc(num)}</span>{esc(title)}</h2>{body}</section>')


def h3(num, title, anchor=None):
    a = f' id="{anchor}"' if anchor else ""
    return f'<h3{a}><span class="n">{esc(num)}</span>{esc(title)}</h3>'


def callout(kind, title, text):
    return (f'<div class="callout {kind}"><div class="ic">{ICON[kind]}</div>'
            f'<div><div class="t">{esc(title)}</div><p>{text}</p></div></div>')


def table(headers, rows, caption=None, cls=None, raw=False, colcls=None):
    """rows are lists of cell html (raw) or text (escaped). colcls gives td classes."""
    cap = f"<caption>{esc(caption)}</caption>" if caption else ""
    th = "".join(f'<th class="{(colcls or [None]*len(headers))[i] or ""}">{esc(h)}</th>'
                 for i, h in enumerate(headers))
    body = []
    for r in rows:
        tds = []
        for i, c in enumerate(r):
            k = (colcls or [None] * len(r))[i]
            val = c if raw else esc(c)
            tds.append(f'<td class="{k}">{val}</td>' if k else f"<td>{val}</td>")
        body.append("<tr>" + "".join(tds) + "</tr>")
    return (f'<div class="tw"><table class="{cls or ""}">{cap}<thead><tr>{th}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table></div>')


def ul(items):
    return '<ul class="clean">' + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def render(name, html_text, pdf=True):
    os.makedirs(OUT, exist_ok=True)
    html_path = os.path.join(OUT, name + ".html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_text)
    pages = None
    if pdf:
        pdf_path = os.path.join(OUT, name + ".pdf")
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--user-data-dir=" + os.path.join(os.environ.get("TEMP", OUT), "atria-edge-print"),
                        "--virtual-time-budget=15000", f"--print-to-pdf={pdf_path}",
                        "file:///" + html_path.replace("\\", "/")],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
        import time
        for _ in range(120):  # the launcher can return before its headless child writes the file
            if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0:
                break
            time.sleep(1)
        time.sleep(2)
        import fitz
        d = fitz.open(pdf_path)
        pages = len(d)
    return html_path, pages
