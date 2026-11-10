import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from scripts import quest_media_server as qms

ORIGIN = "https://shimanskim.github.io"


class QuestMediaServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        (base / "VR").mkdir()
        (base / "VR" / "clip.mp4").write_bytes(b"v" * 100)
        (base / "a.ply").write_bytes(bytes(range(256)) * 4)
        (base / "b.PLY").write_bytes(b"ply")
        (base / "note.txt").write_text("x")
        (base / ".hidden").mkdir()
        (base / ".hidden" / "h.ply").write_bytes(b"ply")
        cls.base = base
        cls.server = qms.QuestServer(("127.0.0.1", 0), {"demo": base.resolve()}, False, False, set())
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def request(self, path, headers=None, method="GET", data=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", headers=headers or {}, method=method, data=data)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as err:
            return err.code, dict(err.headers), err.read()

    def test_info_contract_and_cors(self):
        status, headers, body = self.request("/api/info", {"Origin": ORIGIN})
        info = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(info["app"], "sharp-quest-server")
        self.assertEqual(info["roots"], [{"id": "demo", "label": Path(self.tmp.name).name}])
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")

    def test_unknown_origin_gets_no_allow_origin(self):
        _, headers, _ = self.request("/api/info", {"Origin": "https://evil.example"})
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_preflight(self):
        status, headers, _ = self.request("/files/demo/a.ply", {"Origin": ORIGIN, "Access-Control-Request-Headers": "range"}, method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Headers"], "range")
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")

    def test_list_root_puts_dirs_first_and_hides_dotfiles(self):
        status, _, body = self.request("/api/list?root=demo")
        items = json.loads(body)["items"]
        self.assertEqual(status, 200)
        self.assertEqual([i["name"] for i in items], ["VR", "a.ply", "b.PLY", "note.txt"])
        self.assertEqual(items[0]["type"], "dir")
        self.assertEqual([i["kind"] for i in items[1:]], ["splat", "splat", None])
        self.assertEqual(items[1]["size"], 1024)

    def test_list_subfolder_uses_relative_path(self):
        _, _, body = self.request("/api/list?root=demo&path=VR")
        items = json.loads(body)["items"]
        self.assertEqual(items[0]["path"], "VR/clip.mp4")
        self.assertEqual(items[0]["kind"], "video")

    def test_list_rejects_escape_and_unknown_root(self):
        self.assertEqual(self.request("/api/list?root=demo&path=..")[0], 403)
        self.assertEqual(self.request("/api/list?root=nope")[0], 404)
        self.assertEqual(self.request("/api/list?root=demo&path=a.ply")[0], 404)

    def test_recent_filters_by_kind_and_orders_newest_first(self):
        newest = self.base / "VR" / "clip.mp4"
        import os
        os.utime(newest, (4102444800, 4102444800))
        self.server._recent_cache = None
        _, _, body = self.request("/api/recent")
        paths = [i["path"] for i in json.loads(body)["items"]]
        self.assertEqual(paths[0], "VR/clip.mp4")
        self.assertNotIn(".hidden/h.ply", paths)
        self.assertNotIn("note.txt", paths)
        _, _, body = self.request("/api/recent?kind=splat&limit=1")
        items = json.loads(body)["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["kind"], "splat")
        self.assertEqual(self.request("/api/recent?kind=bogus")[0], 400)

    def test_file_range(self):
        status, headers, body = self.request("/files/demo/a.ply", {"Range": "bytes=10-19"})
        self.assertEqual(status, 206)
        self.assertEqual(headers["Content-Range"], "bytes 10-19/1024")
        self.assertEqual(body, bytes(range(10, 20)))
        status, _, body = self.request("/files/demo/a.ply", {"Range": "bytes=-4"})
        self.assertEqual((status, body), (206, bytes([252, 253, 254, 255])))
        self.assertEqual(self.request("/files/demo/a.ply", {"Range": "bytes=5000-"})[0], 416)

    def test_file_full_and_traversal(self):
        status, headers, body = self.request("/files/demo/a.ply")
        self.assertEqual((status, len(body)), (200, 1024))
        self.assertEqual(headers["Accept-Ranges"], "bytes")
        self.assertEqual(self.request("/files/demo/%2e%2e/README.md")[0], 403)
        self.assertEqual(self.request("/files/demo/a.ply:stream")[0], 403)
        self.assertEqual(self.request("/files/demo/missing.ply")[0], 404)

    def test_parse_range(self):
        self.assertEqual(qms.parse_range("bytes=0-", 10), (0, 9))
        self.assertEqual(qms.parse_range("bytes=2-100", 10), (2, 9))
        self.assertIsNone(qms.parse_range("bytes=5-2", 10))
        self.assertIsNone(qms.parse_range("bytes=0-1,3-4", 10))


if __name__ == "__main__":
    unittest.main()
