import re
import shutil
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / "store-site"
PAGES = ["sharp-quest/index.html", "sharp-quest/privacy/index.html", "sharp-quest/terms/index.html", "sharp-quest/support/index.html", "sharp-quest/download/index.html"]
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

    def test_release_has_no_google_drive(self):
        for page in ("sharp-quest/support/index.html", "sharp-quest/terms/index.html", "sharp-quest/privacy/index.html"):
            text = (SITE / page).read_text(encoding="utf-8")
            with self.subTest(page=page):
                self.assertTrue("현재 출시판에는" in text and "does not include Google Drive" in text)

    def test_privacy_describes_installed_app(self):
        text = (SITE / "sharp-quest/privacy/index.html").read_text(encoding="utf-8")
        # 폐기한 웹 앱 기준 문구가 돌아오지 않게 막는다.
        for gone in ("브라우저 저장소", "browser storage", "앱 화면", "the app's own files", "serves the app's files"):
            with self.subTest(gone=gone):
                self.assertNotIn(gone, text)
        # 설치형 앱이 실제로 저장·전송하는 것.
        for kept in ("PC에서 받아 둔 사진·PLY 파일", "downloaded from your PC", "암호화하지 않은 HTTP", "unencrypted HTTP",
                     "모든 파일 접근", "All files access"):
            with self.subTest(kept=kept):
                self.assertIn(kept, text)

    def test_pages_use_installed_app_labels(self):
        for page in PAGES:
            text = (SITE / page).read_text(encoding="utf-8")
            for gone in ("[PC] 탭", "PC tab", "검은 창", "오픈소스 라이선스]"):
                with self.subTest(page=page, gone=gone):
                    self.assertNotIn(gone, text)

    def test_download_page_reads_release_info(self):
        text = (SITE / "sharp-quest/download/index.html").read_text(encoding="utf-8")
        self.assertIn("/downloads/pc-server.json", text)
        self.assertIn("Windows의 PC 보호", text)
        self.assertIn("개인 네트워크", text)

    def test_download_fallback_links_are_direct(self):
        text = (SITE / "sharp-quest/download/index.html").read_text(encoding="utf-8")
        base = "https://github.com/crayonsmilegames/crayonsmilegames.github.io/releases/download/pc-server-v1.1.1/"
        self.assertEqual(re.findall(r'data-link href="([^"]+)"', text), [base + "Splatia-PC-Server-1.1.1-Setup.exe"] * 2)
        self.assertEqual(re.findall(r'data-zip-link href="([^"]+)"', text), [base + "Splatia-PC-Server-1.1.1-win64.zip"] * 2)
        self.assertEqual(text.count("f66c0199d069538d3cb32543052972265ce47de3c913f15102e764a05486de80"), 2)

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for download script behavior")
    def test_download_metadata_behavior(self):
        script = r'''
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const html = fs.readFileSync(process.argv[1], 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const base = 'https://github.com/crayonsmilegames/crayonsmilegames.github.io/releases/download/pc-server-v';
const zip = base + '2.0.0/Test-2.0.0.zip', setup = base + '2.0.0/Test-2.0.0-Setup.exe';
const good = {version:'2.0.0', url:zip, file:'Test-2.0.0.zip', installerUrl:setup,
  installer:'Test-2.0.0-Setup.exe', installerSize:12345, installerSha256:'a'.repeat(64)};
async function run(meta, fail) {
  const nodes = {};
  for (const key of ['link','version','size','sha','zip-link']) nodes['[data-'+key+']'] = {href:'original', textContent:'original'};
  const boxes = [0,1].map(() => ({querySelector: key => nodes[key]}));
  vm.runInNewContext(script, {document:{querySelectorAll: () => boxes}, fetch: () => fail ? Promise.reject(Error('offline')) : Promise.resolve({ok:true,json:()=>Promise.resolve(meta)})});
  await new Promise(resolve => setImmediate(resolve));
  return nodes;
}
(async () => {
  for (const meta of [null, {...good, installerUrl:''}, {...good, installerUrl:42},
    {...good, installerUrl:undefined}, {...good, installerSize:undefined}, {...good, installerSha256:'bad'},
    {...good, installerUrl:'https://example.com/wrong-Setup.exe'}]) {
    const n = await run(meta, false);
    for (const key of ['link','version','size','sha']) assert.equal(n['[data-'+key+']'].href === 'original' && n['[data-'+key+']'].textContent === 'original', true);
  }
  const offline = await run(null, true); assert.equal(offline['[data-link]'].href, 'original');
  const valid = await run(good, false);
  assert.equal(valid['[data-link]'].href, setup); assert.equal(valid['[data-zip-link]'].href, zip);
  assert.equal(valid['[data-sha]'].textContent, 'a'.repeat(64)); assert.match(valid['[data-version]'].textContent, /2\.0\.0/);
  const zipOnly = await run({...good, installerUrl:''}, false);
  assert.equal(zipOnly['[data-zip-link]'].href, zip); assert.equal(zipOnly['[data-link]'].href, 'original');
})().catch(err => { console.error(err); process.exitCode = 1; });
'''
        subprocess.run([shutil.which("node"), "-e", script, str(SITE / "sharp-quest/download/index.html")], check=True)

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

    def test_placeholders_are_still_there(self):
        # 사람이 값을 줄 때까지 자리표시 9개를 그대로 둔다. 값을 채우는 PR에서 이 시험을 함께 고친다.
        found = set()
        for page in PAGES:
            found |= set(re.findall(r"\[\[([A-Z_]+)\]\]", (SITE / page).read_text(encoding="utf-8")))
        self.assertEqual(found, KNOWN_PLACEHOLDERS)


if __name__ == "__main__":
    unittest.main()
