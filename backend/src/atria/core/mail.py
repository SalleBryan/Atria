"""Every email Atria sends, in the platform's own look (ADR 0020).

The screens are glass over a blue gradient. An email client renders neither
backdrop blur nor, in several clients, a stylesheet, so an email keeps what
survives the trip: the colours, taken by value from web/src/styles/tokens.css;
the type; the blue hero with its frosted cells from the visit detail screen;
and the white inner card beneath it. Layout is tables with inline styles,
because that is what Outlook and Gmail both render.

Two senders use this: the notice sender for booking emails, and the Cognito
custom message trigger for codes. Cognito refuses a message longer than 20,000
characters, which is why the markup is terse and why the tests measure every
page.

Every value a helper is given is escaped. What a helper returns is already
markup, so a page is built only from helpers here, never from raw strings.
"""

from __future__ import annotations

from collections.abc import Sequence
from html import escape

# Cognito's limit on a custom email message.
COGNITO_LIMIT = 20_000

# Tokens, by value (web/src/styles/tokens.css).
GROUND = "#e9f0fd"
INK = "#0d1b34"
INK_900 = "#16233f"
MUTED = "#5a6c8e"
SOFT = "#7181a0"
HAIRLINE = "#e3eaf8"
PANEL = "#f6f9ff"
BLUE = "#2f6be4"

DISPLAY = "font-family:Outfit,'Plus Jakarta Sans',Arial,sans-serif"
BODY = "font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif"

# The hero as the visit detail screen draws it: brand blue, or the slate a
# cancelled visit turns. The solid colour comes first for clients without
# gradients, and the soft bloom sits top right as it does on the screens.
BLOOM = "radial-gradient(circle at 92% 0%,rgba(255,255,255,.3),rgba(255,255,255,0) 42%)"
TONES = {
    "brand": ("#2f6be4", "#4a83f0 0%,#2f6be4 50%,#1e52c4 100%", "rgba(30,82,196,.3)"),
    "cancelled": ("#77849f", "#8b97ae 0%,#63769a 100%", "rgba(16,42,94,.2)"),
}

FONTS = (
    "https://fonts.googleapis.com/css2?family=Outfit:wght@600;700"
    "&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap"
)

# Served by the web client from web/public, so it exists once the site is
# hosted. Until then there is no public address for it and the header is the
# wordmark alone.
MARK = "/email/atria-mark.png"

FOOTER = {
    "fr": "Vous recevez cet e-mail parce que vous avez un compte Atria. "
    "Ce message est automatique : les réponses ne sont pas lues.",
    "en": "You are receiving this email because you have an Atria account. "
    "It was sent automatically, so replies are not read.",
}

TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
# The same, sized to its content, for a button or the header lockup.
SNUG = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'


def text(value: object) -> str:
    return escape(str(value), quote=True)


def paragraph(value: str, *, muted: bool = False) -> str:
    colour = MUTED if muted else INK_900
    size = "13px;line-height:20px" if muted else "14px;line-height:22px"
    return f'<p style="margin:0 0 14px;{BODY};font-size:{size};color:{colour}">{text(value)}</p>'


def label(value: str) -> str:
    return (
        f'<p style="margin:0 0 8px;{BODY};font-size:10.5px;font-weight:700;line-height:14px;'
        f'letter-spacing:.06em;color:{MUTED}">{text(value.upper())}</p>'
    )


def code(caption: str, value: str, *, digits: bool = True) -> str:
    """The code field from the verify screen: display type in a hairline box.

    Digits are spaced as the six boxes on that screen space them. A temporary
    password is not: spread out, its mixed case and symbols are harder to copy.
    """
    size, spacing = ("34px;line-height:40px", 10) if digits else ("24px;line-height:32px", 2)
    return (
        label(caption) + f'<table {TABLE} style="margin:0 0 12px"><tr><td align="center" '
        f'style="padding:18px 12px 18px {12 + spacing}px;border:1.5px solid {HAIRLINE};'
        f"border-radius:24px;background-color:{PANEL};{DISPLAY};font-weight:600;font-size:{size};"
        f'letter-spacing:{spacing}px;color:{INK_900};word-break:break-all">{text(value)}</td></tr></table>'
    )


def field(caption: str, value: str) -> str:
    """A value to copy exactly, such as a username, in the same box, smaller."""
    return (
        label(caption) + f'<table {TABLE} style="margin:0 0 14px"><tr><td '
        f'style="padding:13px 16px;border:1.5px solid {HAIRLINE};border-radius:16px;'
        f"background-color:{PANEL};{DISPLAY};font-weight:600;font-size:17px;line-height:22px;"
        f'color:{INK_900};word-break:break-all">{text(value)}</td></tr></table>'
    )


def divider() -> str:
    return f'<div style="height:1px;margin:6px 0 16px;background-color:{HAIRLINE}"></div>'


def button(caption: str, href: str) -> str:
    """The primary button: the same gradient, radius and shadow as the app's."""
    return (
        f'<table {SNUG} style="margin:4px 0 16px">'
        f'<tr><td bgcolor="{BLUE}" style="border-radius:19px;background-color:{BLUE};'
        "background-image:linear-gradient(140deg,#4a83f0 0%,#2461db 100%);"
        'box-shadow:0 12px 24px rgba(36,97,219,.32)">'
        f'<a href="{text(href)}" style="display:inline-block;padding:16px 28px;{BODY};'
        "font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;"
        f'border-radius:19px">{text(caption)}</a></td></tr></table>'
    )


def cells(pairs: Sequence[tuple[str, str]]) -> str:
    """The frosted cells on the visit hero, two to a row so a phone fits them."""
    line = "1px solid rgba(255,255,255,.35)"
    rows = []
    for start in range(0, len(pairs), 2):
        row = pairs[start : start + 2]
        tds = []
        for index, (caption, value) in enumerate(row):
            edges = (f"border-left:{line};" if index else "") + (
                f"border-top:{line};" if start else ""
            )
            span = ' colspan="2"' if len(row) == 1 else ' width="50%"'
            tds.append(
                f'<td{span} valign="top" style="{edges}padding:12px 16px">'
                f'<div style="{BODY};font-size:10px;font-weight:700;line-height:14px;'
                f'letter-spacing:.06em;color:#ffffff">{text(caption.upper())}</div>'
                f'<div style="margin-top:4px;{DISPLAY};font-weight:600;font-size:15px;'
                f'line-height:20px;color:#ffffff">{text(value)}</div></td>'
            )
        rows.append(f"<tr>{''.join(tds)}</tr>")
    return (
        f'<table {TABLE} style="margin-top:18px;border:1px solid #ffffff;border-radius:18px;'
        f'border-collapse:separate;background-color:rgba(255,255,255,.18)">{"".join(rows)}</table>'
    )


def hero(
    *,
    tag: str,
    heading: str,
    lead: str = "",
    pairs: Sequence[tuple[str, str]] = (),
    tone: str = "brand",
    checked: bool = False,
) -> str:
    solid, stops, shadow = TONES[tone]
    tick = "&#10003;&nbsp;" if checked else ""
    parts = [
        f'<span style="display:inline-block;padding:5px 11px;border:1px solid #ffffff;'
        f"border-radius:999px;background-color:rgba(255,255,255,.18);{BODY};font-size:11px;"
        f'font-weight:700;line-height:14px;letter-spacing:.04em;color:#ffffff">'
        f"{tick}{text(tag.upper())}</span>",
        f'<h1 style="margin:14px 0 0;{DISPLAY};font-weight:700;font-size:26px;line-height:32px;'
        f'letter-spacing:-.02em;color:#ffffff">{text(heading)}</h1>',
    ]
    if lead:
        parts.append(
            f'<p style="margin:6px 0 0;{BODY};font-size:13px;line-height:20px;color:#ffffff">'
            f"{text(lead)}</p>"
        )
    if pairs:
        parts.append(cells(pairs))
    return (
        f'<table {TABLE} bgcolor="{solid}" style="border-radius:28px;background-color:{solid};'
        f"background-image:{BLOOM},linear-gradient(140deg,{stops});"
        f'box-shadow:0 12px 28px {shadow},inset 0 1px 0 rgba(255,255,255,.32)">'
        f'<tr><td style="padding:26px">{"".join(parts)}</td></tr></table>'
    )


def card(*blocks: str) -> str:
    """The white inner card from the screens."""
    return (
        f'<table {TABLE} bgcolor="#ffffff" style="border-radius:24px;background-color:#ffffff;'
        'box-shadow:0 1px 8px rgba(16,42,94,.06)">'
        f'<tr><td style="padding:24px 24px 10px">{"".join(blocks)}</td></tr></table>'
    )


def page(
    *,
    language: str,
    subject: str,
    preheader: str,
    top: str,
    body: str,
    app_url: str = "",
) -> str:
    """A whole email: the wordmark, a hero, a card, and the footer."""
    base = app_url.rstrip("/")
    mark = (
        f'<td width="42" style="padding-right:11px"><img src="{text(base + MARK)}" width="42" '
        'height="42" alt="" style="display:block;border:0;border-radius:15px"></td>'
        if base
        else ""
    )
    return (
        "<!DOCTYPE html>"
        f'<html lang="{text(language)}"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light only">'
        '<meta name="supported-color-schemes" content="light">'
        f'<title>{text(subject)}</title><link href="{text(FONTS)}" rel="stylesheet"></head>'
        f'<body style="margin:0;padding:0;background-color:{GROUND}">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0">{text(preheader)}'
        f"{'&#847;&zwnj;&nbsp;' * 24}</div>"
        f'<table {TABLE} bgcolor="{GROUND}" style="background-color:{GROUND};'
        'background-image:linear-gradient(150deg,#dbe7fe 0%,#eff4fe 42%,#e9f0fd 100%)">'
        '<tr><td align="center" style="padding:32px 12px 40px">'
        f'<table {TABLE} style="max-width:560px">'
        '<tr><td style="padding:0 6px 20px">'
        f"<table {SNUG}><tr>{mark}"
        f'<td style="{DISPLAY};font-weight:600;font-size:18px;line-height:22px;'
        f'letter-spacing:.05em;color:{INK}">ATRIA</td></tr></table></td></tr>'
        f"<tr><td>{top}</td></tr>"
        f'<tr><td style="padding-top:16px">{body}</td></tr>'
        f'<tr><td align="center" style="padding:22px 16px 0;{BODY};font-size:11.5px;'
        f'line-height:18px;color:{SOFT}">{text(FOOTER.get(language, FOOTER["en"]))}</td></tr>'
        "</table></td></tr></table></body></html>"
    )
