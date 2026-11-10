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

    def test_junction_or_symlink_out_of_root_is_hidden(self):
        """루트 밖을 가리키는 정션/심볼릭 링크 폴더는 /api/list·/api/recent에 이름도 나오지 않는다."""
        import os
        import subprocess
        outside = tempfile.TemporaryDirectory()
        try:
            (Path(outside.name) / "leak.png").write_bytes(b"png")
            link = self.base / "jx"
            if os.name == "nt":
                made = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), outside.name], capture_output=True).returncode == 0
            else:
                os.symlink(outside.name, link)
                made = True
            if not made:
                self.skipTest("링크를 만들 수 없는 환경")
            self.server._recent_cache = None
            _, _, body = self.request("/api/list?root=demo")
            self.assertNotIn("jx", [i["name"] for i in json.loads(body)["items"]])
            _, _, body = self.request("/api/recent")
            self.assertNotIn("jx/leak.png", [i["path"] for i in json.loads(body)["items"]])
            self.assertEqual(self.request("/api/list?root=demo&path=jx")[0], 403)
            self.assertEqual(self.request("/files/demo/jx/leak.png")[0], 403)
        finally:
            if os.name == "nt":
                os.rmdir(link) if link.exists() else None  # 정션은 rmdir로 지워야 대상이 남는다
            elif link.is_symlink():
                link.unlink()
            outside.cleanup()
            self.server._recent_cache = None

    def test_files_only_serves_listed_media(self):
        """/files/는 목록에 나오는 종류(PLY·영상·사진)만, 숨김 경로 없이 내보낸다."""
        (self.base / ".env").write_text("SECRET=1")
        for path in ("/files/demo/note.txt", "/files/demo/.env", "/files/demo/.hidden/h.ply"):
            self.assertEqual(self.request(path)[0], 404, path)
        self.assertEqual(self.request("/files/demo/a.ply")[0], 200)
        self.assertEqual(self.request("/files/demo/VR/clip.mp4")[0], 200)
        self.assertEqual(self.request("/files/demo/../a.ply")[0], 403)  # 경로 이탈은 그대로 403

    def test_host_header_is_checked(self):
        """Host가 허용 목록 밖이면 거절한다(DNS 리바인딩 대비)."""
        for host in ("evil.example", "evil.example:8787", "127.0.0.1.evil.example"):
            self.assertEqual(self.request("/api/info", {"Host": host})[0], 403, host)
        for host in ("127.0.0.1:8787", "localhost:8787", "sharp-vr.local:8787", "192.168.0.23", "100.101.102.103:8787", "[::1]:8787"):
            self.assertEqual(self.request("/api/info", {"Host": host})[0], 200, host)
        import socket
        self.assertEqual(self.request("/api/info", {"Host": f"{socket.gethostname()}.local:8787"})[0], 200)
        self.assertEqual(self.request("/files/demo/a.ply", {"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("/api/probe-result", {"Host": "evil.example"}, method="POST", data=b"{}")[0], 403)

    def test_allow_host_adds_names(self):
        self.assertFalse(qms.host_allowed("my-tunnel.trycloudflare.com"))
        self.assertTrue(qms.host_allowed("my-tunnel.trycloudflare.com", {"My-Tunnel.trycloudflare.com"}))

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
