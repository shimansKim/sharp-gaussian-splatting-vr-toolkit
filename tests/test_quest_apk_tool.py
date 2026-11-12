import json
import tempfile
import unittest
from pathlib import Path

from scripts import quest_apk_tool as tool

REPO = Path(__file__).resolve().parents[1]

GRADLE = """android {
        compileSdkVersion 32
    defaultConfig {
        minSdkVersion 24
            targetSdkVersion %s
        versionCode 1
    }
}
"""


class EnsureTargetSdkTests(unittest.TestCase):
    def write(self, base: Path, value: int) -> Path:
        gradle = base / "app" / "build.gradle"
        gradle.parent.mkdir(parents=True)
        gradle.write_text(GRADLE % value, encoding="utf-8")
        return gradle

    def test_keeps_32(self):
        with tempfile.TemporaryDirectory() as tmp:
            gradle = self.write(Path(tmp), 32)
            self.assertEqual(tool.ensure_target_sdk(Path(tmp)), 0)
            self.assertIn("targetSdkVersion 32", gradle.read_text(encoding="utf-8"))

    def test_rewrites_other_value_to_32(self):
        with tempfile.TemporaryDirectory() as tmp:
            gradle = self.write(Path(tmp), 35)
            self.assertEqual(tool.ensure_target_sdk(Path(tmp)), 1)
            text = gradle.read_text(encoding="utf-8")
            self.assertIn("targetSdkVersion 32", text)
            self.assertNotIn("targetSdkVersion 35", text)


class TwaManifestTests(unittest.TestCase):
    def test_manifests_target_meta_quest_on_pages_path(self):
        for name in ("twa-manifest.json", "twa-manifest.vr.json"):
            manifest = json.loads((REPO / "twa" / name).read_text(encoding="utf-8"))
            with self.subTest(name=name):
                self.assertTrue(manifest["isMetaQuest"])
                self.assertEqual(manifest["host"], "shimanskim.github.io")
                self.assertTrue(manifest["startUrl"].startswith("/sharp-gaussian-splatting-vr-toolkit/"))

    def test_assetlinks_lists_both_packages(self):
        links = json.loads((REPO / "store-site" / ".well-known" / "assetlinks.json").read_text(encoding="utf-8"))
        packages = {entry["target"]["package_name"] for entry in links}
        for name in ("twa-manifest.json", "twa-manifest.vr.json"):
            manifest = json.loads((REPO / "twa" / name).read_text(encoding="utf-8"))
            self.assertIn(manifest["packageId"], packages)


if __name__ == "__main__":
    unittest.main()
