import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / "store-site"
PAGES = ["sharp-quest/index.html", "sharp-quest/privacy/index.html", "sharp-quest/terms/index.html", "sharp-quest/support/index.html"]
# 사람이 채울 자리표시. 채우면 이 목록에서 빼지 않아도 된다(남아 있는지만 따로 확인).
KNOWN_PLACEHOLDERS = {
    "SELLER_NAME", "REPRESENTATIVE", "BUSINESS_REG_NO", "ECOMMERCE_REG_NO", "BUSINESS_ADDRESS",
    "SUPPORT_EMAIL", "SUPPORT_PHONE", "PRIVACY_OFFICER", "EFFECTIVE_DATE",
}


class LinkCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for key in ("href", "src"):
            if attrs.get(key):
                self.links.append(attrs[key])


class StoreSitePagesTests(unittest.TestCase):
    def test_pages_exist_and_are_bilingual(self):
        for page in PAGES[1:]:
            text = (SITE / page).read_text(encoding="utf-8")
            with self.subTest(page=page):
                self.assertIn('id="ko"', text)
                self.assertIn('id="en"', text)
                self.assertIn('<meta name="viewport"', text)

    def test_privacy_states_drive_file_scope(self):
        text = (SITE / "sharp-quest/privacy/index.html").read_text(encoding="utf-8")
        self.assertGreaterEqual(text.count("https://www.googleapis.com/auth/drive.file"), 2)
        self.assertIn("Limited Use", text)
        self.assertIn("api-services-user-data-policy", text)

    def test_relative_links_resolve(self):
        for page in PAGES:
            path = SITE / page
            parser = LinkCollector()
            parser.feed(path.read_text(encoding="utf-8"))
            for link in parser.links:
                if re.match(r"^(https?:|mailto:|#)", link):
                    continue
                target = (path.parent / link.split("#")[0]).resolve()
                if target.is_dir():
                    target = target / "index.html"
                with self.subTest(page=page, link=link):
                    self.assertTrue(target.exists(), f"{page}: {link}")

    def test_only_known_placeholders(self):
        for page in PAGES:
            found = set(re.findall(r"\[\[([A-Z_]+)\]\]", (SITE / page).read_text(encoding="utf-8")))
            with self.subTest(page=page):
                self.assertLessEqual(found, KNOWN_PLACEHOLDERS)


if __name__ == "__main__":
    unittest.main()
