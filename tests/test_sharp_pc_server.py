import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "pc-server"))
sys.path.insert(0, str(REPO / "scripts"))


class SharpPcServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.env = mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.base / "appdata")})
        self.env.start()
        import quest_media_server
        import sharp_pc_server

        self.qms = importlib.reload(quest_media_server)
        self.app = importlib.reload(sharp_pc_server)
        self.docs = mock.patch.object(self.app, "documents_dir", return_value=self.base / "docs")
        self.docs.start()
        self.app.configure()

    def tearDown(self):
        self.docs.stop()
        self.env.stop()
        self.tmp.cleanup()

    def test_paths_move_to_local_appdata(self):
        data = self.base / "appdata" / "SHARP PC Server"
        self.assertEqual(self.qms.FOLDERS_FILE, data / "shared_folders.txt")
        self.assertEqual(self.qms.BINDINGS_FILE, data / "quest_bindings.json")
        self.assertTrue(self.qms.BINDINGS_MODULE.is_file())
        self.assertTrue(self.qms.BINDINGS_PAGE.is_file())
        self.assertTrue(self.qms.BINDINGS_PAGE_SCRIPT.is_file())

    def test_default_folder_when_nothing_shared(self):
        roots = self.app.build_roots([], remember=False)
        self.assertEqual(list(roots.values()), [(self.base / "docs" / "SHARP VR").resolve()])
        self.assertEqual(list(roots), ["sharp-vr"])

    def test_extra_folder_replaces_default_and_is_remembered(self):
        shared = self.base / "videos"
        shared.mkdir()
        roots = self.app.build_roots([shared], remember=True)
        self.assertEqual(list(roots.values()), [shared.resolve()])
        self.assertIn(str(shared.resolve()), self.qms.FOLDERS_FILE.read_text(encoding="utf-8"))
        again = self.app.build_roots([], remember=False)
        self.assertEqual(list(again.values()), [shared.resolve()])

    def test_build_contents_exclude_forbidden(self):
        sys.path.insert(0, str(REPO / "pc-server"))
        import build

        self.assertIn("zeroconf", build.EXCLUDES)
        self.assertIn("torch", build.FORBIDDEN)
        for name, src in build.DATA_FILES.items():
            self.assertTrue(src.is_file(), name)


if __name__ == "__main__":
    unittest.main()
