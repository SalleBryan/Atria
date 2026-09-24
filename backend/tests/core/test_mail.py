"""Every email is in the platform's look, and none can be broken by its values.

ADR 0020. The layout is shared by the booking emails and Cognito's own, so the
things that would break either are pinned here: escaping, Cognito's length
limit, and the mark and button that wait for the hosted site.
"""

from __future__ import annotations

from atria.core import mail


def page(**overrides: str) -> str:
    settings = {
        "language": "fr",
        "subject": "Sujet",
        "preheader": "Aperçu",
        "top": mail.hero(tag="Vérification", heading="Titre"),
        "body": mail.card(mail.paragraph("Bonjour,")),
    }
    settings.update(overrides)
    return mail.page(**settings)


class TestEscaping:
    def test_a_value_cannot_become_markup(self):
        """A clinic or a person names itself; what it types is text, not HTML."""
        html = mail.hero(
            tag="x", heading="<script>alert(1)</script>", pairs=[("Lieu", 'Clinique "A" & <b>')]
        )
        assert "<script>" not in html
        assert "&lt;script&gt;" in html
        assert "Clinique &quot;A&quot; &amp; &lt;b&gt;" in html

    def test_a_link_cannot_leave_its_attribute(self):
        html = mail.button("Ouvrir", 'https://atria.example/" onclick="x')
        assert 'onclick="x' not in html

    def test_cognitos_placeholders_pass_through_untouched(self):
        """Cognito looks for these exact strings to put the code in."""
        html = mail.code("Votre code", "{####}") + mail.field("Identifiant", "{username}")
        assert "{####}" in html
        assert "{username}" in html


class TestLook:
    def test_the_page_uses_the_platform_colours(self):
        html = page()
        assert mail.GROUND in html
        assert "#4a83f0" in html  # the hero gradient's first stop, --blue-500

    def test_a_cancelled_hero_turns_slate_as_on_the_visit_screen(self):
        assert "#8b97ae" in mail.hero(tag="x", heading="y", tone="cancelled")
        assert "#8b97ae" not in mail.hero(tag="x", heading="y")

    def test_the_page_asks_to_be_read_in_light_mode(self):
        assert 'content="light only"' in page()

    def test_the_page_names_its_language(self):
        assert '<html lang="en">' in page(language="en")

    def test_the_footer_is_in_the_pages_language(self):
        assert mail.FOOTER["en"].split(".")[0] in page(language="en")
        assert "les réponses ne sont pas lues" in page(language="fr")

    def test_two_cells_share_a_row_and_an_odd_one_spans_it(self):
        html = mail.cells([("Date", "1"), ("Heure", "2"), ("Lieu", "3")])
        assert html.count("<tr>") == 2
        assert 'colspan="2"' in html


class TestHostedSite:
    def test_without_a_public_address_there_is_no_mark_to_load(self):
        """A development server is not something to link from an inbox."""
        assert "<img" not in page()

    def test_with_one_the_mark_comes_from_the_site(self):
        html = page(app_url="https://app.atria.example/")
        assert 'src="https://app.atria.example/email/atria-mark.png"' in html


class TestLength:
    def test_a_code_email_fits_well_inside_cognitos_limit(self):
        html = page(body=mail.card(mail.paragraph("Bonjour,"), mail.code("Votre code", "{####}")))
        assert len(html) < mail.COGNITO_LIMIT / 2
