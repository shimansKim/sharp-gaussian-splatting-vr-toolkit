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
        # 이 PC의 사설 IPv4 주소 목록. 앱이 공유기 대역을 기억하는 데 쓴다.
        self.assertIsInstance(info["addresses"], list)
        for ip in info["addresses"]:
            self.assertTrue(qms.is_private_ipv4(ip), ip)

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

    def test_host_with_junk_after_the_port_is_rejected(self):
        for host in ("127.0.0.1:8787@evil.com", "127.0.0.1:8787x", "[::1]:8787@evil.com", "[::1]evil", "localhost:80a", "127.0.0.1:\uff18\uff17"):
            self.assertFalse(qms.host_allowed(host), host)
        for host in ("127.0.0.1:8787", "127.0.0.1", "[::1]:8787", "[::1]", "localhost:8787", "sharp-vr.local:8787"):
            self.assertTrue(qms.host_allowed(host), host)

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


class BindingsApiTests(unittest.TestCase):
    """컨트롤러 버튼 배정 GET/PUT /api/bindings 와 PC 설정 페이지(/settings/bindings)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        (base / "media").mkdir()
        self.path = base / "quest_bindings.json"
        self.server = qms.QuestServer(("127.0.0.1", 0), {"demo": (base / "media").resolve()}, False, False, set(), bindings_path=self.path)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def request(self, path, headers=None, method="GET", data=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", headers=headers or {}, method=method, data=data)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as err:
            return err.code, dict(err.headers), err.read()

    def put(self, payload, origin=ORIGIN, content_type="application/json", host=None):
        headers = {"Content-Type": content_type}
        if origin:
            headers["Origin"] = origin
        if host:
            headers["Host"] = host
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        status, headers, raw = self.request("/api/bindings", headers, method="PUT", data=body)
        return status, headers, json.loads(raw or b"{}")

    def test_empty_until_saved_then_round_trip(self):
        status, _, body = self.request("/api/bindings", {"Origin": ORIGIN})
        self.assertEqual((status, json.loads(body)), (200, {"version": 1, "updatedAt": 0, "bindings": {}}))
        bindings = {
            "common.prev": {"hand": "right", "button": "grip", "mode": "hold"},
            "media.zoom": {"hand": "left", "axis": "x"},
            "splat.move": {"hand": "right"},
            "splat.fit": None,
        }
        status, headers, saved = self.put({"bindings": bindings, "updatedAt": 1000})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(saved["bindings"], bindings)
        on_disk = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual((on_disk["updatedAt"], on_disk["bindings"]), (1000, bindings))
        status, _, body = self.request("/api/bindings")
        self.assertEqual(json.loads(body)["bindings"], bindings)

    def test_newer_wins_unless_forced(self):
        self.assertEqual(self.put({"bindings": {"splat.fit": None}, "updatedAt": 5000})[0], 200)
        status, _, body = self.put({"bindings": {}, "updatedAt": 4000})
        self.assertEqual(status, 409)
        self.assertEqual(body["current"]["updatedAt"], 5000)
        self.assertEqual(body["current"]["bindings"], {"splat.fit": None})
        status, _, body = self.put({"bindings": {}, "updatedAt": 4000, "force": True})
        self.assertEqual((status, body["bindings"]), (200, {}))

    def test_far_future_time_is_clamped(self):
        status, _, body = self.put({"bindings": {}, "updatedAt": 10 ** 15})
        self.assertEqual(status, 200)
        self.assertLess(body["updatedAt"], 10 ** 15)

    def test_rejects_bad_payloads(self):
        bad = [
            {"bindings": []},
            {"nope": {}},
            {"bindings": {"evil.thing": None}},
            {"bindings": {"common.prev": {"hand": "both", "button": "primary"}}},
            {"bindings": {"common.prev": {"hand": "left", "button": "home"}}},
            {"bindings": {"common.prev": {"hand": "left", "button": "primary", "mode": "double"}}},
            {"bindings": {"media.zoom": {"hand": "left", "axis": "z"}}},
            {"bindings": {"media.turn": {"hand": "either"}}},
            {"bindings": {"media.turn": {"hand": "left", "extra": 1}}},
            {"bindings": {"media.turn": "left"}},
            {"bindings": {}, "updatedAt": "yesterday"},
            {"bindings": {}, "updatedAt": True},
            {"bindings": {f"common.a{'b' * i}": None for i in range(qms.MAX_BINDINGS + 1)}},
        ]
        for payload in bad:
            self.assertEqual(self.put(payload)[0], 400, payload)
        self.assertEqual(self.put(b"{not json")[0], 400)
        self.assertEqual(self.put(b"x" * (qms.MAX_BINDINGS_BYTES + 1))[0], 413)
        self.assertFalse(self.path.exists())

    def test_put_checks_origin_content_type_and_host(self):
        ok = {"bindings": {}, "updatedAt": 1}
        self.assertEqual(self.put(ok, origin="https://evil.example")[0], 403)
        # 폼·text/plain 같은 단순 요청으로는 못 바꾼다
        self.assertEqual(self.put(ok, content_type="text/plain")[0], 415)
        self.assertEqual(self.put(ok, host="evil.example:8787")[0], 403)
        # 이 서버가 내보낸 설정 페이지(같은 출처)는 된다. Host와 다른 출처는 안 된다.
        self.assertEqual(self.put(ok, origin=f"http://127.0.0.1:{self.port}")[0], 200)
        self.assertEqual(self.put(ok, origin=f"http://127.0.0.1:{self.port + 1}")[0], 403)
        self.assertEqual(self.put(ok, origin="http://evil.example:8787", host="evil.example:8787")[0], 403)
        # 앱 출처의 사전 요청(OPTIONS)은 PUT을 허용한다고 답한다
        status, headers, _ = self.request("/api/bindings", {"Origin": ORIGIN, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type"}, method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertIn("PUT", headers["Access-Control-Allow-Methods"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)

    def test_clock_skew_limit_is_minutes_not_a_day(self):
        """시계가 앞선 기기가 보낸 시각은 몇 분 뒤까지만 받는다: 다른 쪽의 정상 변경이 그 뒤로 409를 오래 받지 않는다."""
        import time
        now = int(time.time() * 1000)
        status, _, body = self.put({"bindings": {}, "updatedAt": now + 3 * 3_600_000})  # 3시간 앞선 시계
        self.assertEqual(status, 200)
        self.assertLessEqual(body["updatedAt"], now + qms.MAX_BINDINGS_CLOCK_SKEW_MS + 5000)
        self.assertLessEqual(qms.MAX_BINDINGS_CLOCK_SKEW_MS, 10 * 60 * 1000)
        # 잠시 뒤(상한 안에서) 바른 시계의 기기가 바꾸면 받아들여진다
        status, _, _ = self.put({"bindings": {"splat.fit": None}, "updatedAt": now + qms.MAX_BINDINGS_CLOCK_SKEW_MS + 1000})
        self.assertEqual(status, 200)
        # 예전 버전이 하루 뒤 시각으로 저장해 둔 파일도 읽을 때 상한으로 잘린다
        self.path.write_text(json.dumps({"version": 1, "updatedAt": now + 86_400_000, "bindings": {}}), encoding="utf-8")
        _, _, raw = self.request("/api/bindings")
        self.assertLessEqual(json.loads(raw)["updatedAt"], now + qms.MAX_BINDINGS_CLOCK_SKEW_MS + 5000)

    def test_put_origin_is_narrower_than_read(self):
        """저장(PUT)은 앱 출처·--allow-origin·같은 출처 페이지만. 읽기 CORS 정책(LAN 개발 출처 포함)은 그대로."""
        ok = {"bindings": {}, "updatedAt": 1}
        lan_dev = "https://192.168.0.7:5173"
        self.assertEqual(self.put(ok, origin=lan_dev)[0], 403)
        self.assertEqual(self.put(ok, origin=None)[0], 403, "Origin 없는 요청(curl 등)은 저장 못 함")
        self.assertEqual(self.put(ok, origin="http://localhost:5173")[0], 200, "앱 개발 출처(ALLOWED_ORIGINS)는 된다")
        self.assertEqual(self.put(ok, origin=f"http://127.0.0.1:{self.port}")[0], 200, "같은 출처 설정 페이지")
        _, headers, _ = self.request("/api/bindings", {"Origin": lan_dev})
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), lan_dev, "읽기는 그대로")
        _, headers, _ = self.request("/api/info", {"Origin": lan_dev})
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), lan_dev)
        self.server.extra_origins = {"https://tunnel.example"}
        try:
            self.assertEqual(self.put(ok, origin="https://tunnel.example")[0], 200, "--allow-origin으로 더한 출처")
        finally:
            self.server.extra_origins = set()

    def test_bindings_version_is_kept(self):
        """앱의 배정 표 판(version)을 저장해 돌려준다(예전 판 값을 받은 앱이 기본값 변경을 옮겨 적용하도록). 없으면 1."""
        status, _, body = self.put({"version": 2, "bindings": {"common.openList": None}, "updatedAt": 10})
        self.assertEqual((status, body["version"]), (200, 2))
        _, _, raw = self.request("/api/bindings")
        self.assertEqual(json.loads(raw)["version"], 2)
        self.assertEqual(self.put({"bindings": {}, "updatedAt": 20})[2]["version"], 1)
        for bad in ("2", 0, 100, True, 1.5):
            self.assertEqual(self.put({"version": bad, "bindings": {}, "updatedAt": 30})[0], 400, bad)

    def test_corrupt_file_reads_as_empty(self):
        self.path.write_text("{broken", encoding="utf-8")
        status, _, body = self.request("/api/bindings")
        self.assertEqual(json.loads(body), {"version": 1, "updatedAt": 0, "bindings": {}})

    def test_settings_page_and_module_are_served(self):
        status, headers, body = self.request("/settings/bindings")
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("text/html"))
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertIn(b"bindings-page.js", body)
        status, headers, body = self.request("/settings/bindings-page.js")
        self.assertEqual(status, 200)
        self.assertIn(b"./bindings.js", body)
        status, headers, body = self.request("/settings/bindings.js")
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("text/javascript"))
        self.assertIn(b"export const ACTIONS", body)
        self.assertEqual(self.request("/settings/bindings", {"Host": "evil.example"})[0], 403)

    def test_server_rules_match_the_app_catalog(self):
        """앱의 동작 id(bindings.js ACTIONS)가 모두 서버 검사(BINDING_ID_RE)를 통과한다."""
        import re
        source = qms.BINDINGS_MODULE.read_text(encoding="utf-8")
        ids = re.findall(r'\{ id: "([a-z]+\.[A-Za-z]+)", scope: "[a-z]+", kind:', source)
        self.assertGreaterEqual(len(ids), 10)
        for action_id in ids:
            self.assertTrue(qms.BINDING_ID_RE.match(action_id), action_id)


class RecentMixTests(unittest.TestCase):
    """/api/recent 가 프레임 시퀀스에 밀리지 않고 종류별로 고르게 나오는지."""

    FRAMES = 1200  # 예전 limit(1000)을 넘는 수천 장 시퀀스를 흉내 낸다

    @classmethod
    def setUpClass(cls):
        import os

        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        old, mid, new = 1_700_000_000, 1_700_100_000, 1_700_200_000
        (base / "VR").mkdir()
        for i in range(3):
            clip = base / "VR" / f"clip{i}.mp4"
            clip.write_bytes(b"v")
            os.utime(clip, (old + i, old + i))
        (base / "ply").mkdir()
        for i in range(5):
            ply = base / "ply" / f"model{i}.ply"
            ply.write_bytes(b"ply")
            os.utime(ply, (old + i, old + i))
        frames = base / "run" / "03_stereo_frames"
        frames.mkdir(parents=True)
        for i in range(cls.FRAMES):
            f = frames / f"frame_{i:06d}.sbs.png"
            f.write_bytes(b"p")
            os.utime(f, (new, new))
        # 같은 폴더의 따로 놓인 사진은 시퀀스가 아니다
        cover = frames / "cover.png"
        cover.write_bytes(b"p")
        os.utime(cover, (new + 5, new + 5))
        # 사진 150장(이름이 제각각) → 기본 사진 상한 100에 걸린다
        photos = base / "photos"
        photos.mkdir()
        for i in range(150):
            f = photos / f"{'abcdefghij'[i % 10]}{i}_{'xyz'[i % 3]}.jpg"
            f.write_bytes(b"j")
            os.utime(f, (mid + i, mid + i))
        cls.base = base
        cls.server = qms.QuestServer(("127.0.0.1", 0), {"demo": base.resolve()}, False, False, set())
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}") as resp:
            return json.loads(resp.read())

    def test_sequence_key_ignores_numbers(self):
        self.assertEqual(qms.sequence_key("frame_000983.sbs.png"), qms.sequence_key("frame_000984.sbs.png"))
        self.assertNotEqual(qms.sequence_key("frame_1.png"), qms.sequence_key("cover.png"))

    def test_default_recent_shows_videos_and_plys_despite_newer_frames(self):
        data = self.get("/api/recent?limit=1000")
        kinds = [e["kind"] for e in data["items"]]
        self.assertEqual(kinds.count("video"), 3)
        self.assertEqual(kinds.count("splat"), 5)
        paths = [e["path"] for e in data["items"]]
        self.assertFalse(any("03_stereo_frames/frame_" in p for p in paths), "프레임 시퀀스는 최근 목록에 없어야 한다")
        self.assertIn("run/03_stereo_frames/cover.png", paths)

    def test_default_recent_caps_images_per_kind_and_orders_newest_first(self):
        data = self.get("/api/recent?limit=1000")
        images = [e for e in data["items"] if e["kind"] == "image"]
        self.assertEqual(len(images), qms.RECENT_PER_KIND["image"])
        mtimes = [e["mtime"] for e in data["items"]]
        self.assertEqual(mtimes, sorted(mtimes, reverse=True))
        # 전체 개수는 상한과 무관하게 알려 준다(시퀀스 프레임 제외)
        self.assertEqual(data["counts"], {"splat": 5, "video": 3, "image": 151})

    def test_recent_limit_still_caps_total(self):
        self.assertEqual(len(self.get("/api/recent?limit=10")["items"]), 10)

    def test_sequences_are_reported_as_folders(self):
        seqs = self.get("/api/recent")["sequences"]
        self.assertEqual(len(seqs), 1)
        self.assertEqual(seqs[0]["root"], "demo")
        self.assertEqual(seqs[0]["path"], "run/03_stereo_frames")
        self.assertEqual(seqs[0]["name"], "03_stereo_frames")
        self.assertEqual(seqs[0]["count"], self.FRAMES)

    def test_kind_video_returns_all_videos(self):
        data = self.get("/api/recent?kind=video&limit=1000")
        self.assertEqual(sorted(e["name"] for e in data["items"]), ["clip0.mp4", "clip1.mp4", "clip2.mp4"])
        self.assertEqual(data["items"][0]["name"], "clip2.mp4")

    def test_kind_image_excludes_frames_unless_asked(self):
        data = self.get("/api/recent?kind=image&limit=1000")
        self.assertEqual(len(data["items"]), 151)
        self.assertFalse(any("frame_" in e["name"] for e in data["items"]))
        everything = self.get(f"/api/recent?kind=image&limit=1000&include_sequences=1")
        self.assertEqual(len(everything["items"]), 1000)
        self.assertTrue(any("frame_" in e["name"] for e in everything["items"]))

    def test_folder_browsing_still_lists_every_frame(self):
        data = self.get("/api/list?root=demo&path=run/03_stereo_frames")
        self.assertEqual(len(data["items"]), self.FRAMES + 1)

    def test_sequence_frames_do_not_use_up_the_walk_budget(self):
        """프레임이 MAX_WALK(집계 상한)를 채워 다른 폴더의 영상을 밀어내면 안 된다."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "frames").mkdir()
            for i in range(200):
                (root / "frames" / f"f_{i:04d}.png").write_bytes(b"p")
            (root / "clips").mkdir()
            for i in range(3):
                (root / "clips" / f"v{i}.mp4").write_bytes(b"v")
            saved = qms.MAX_WALK
            qms.MAX_WALK = 20  # 프레임 200장이 상한을 훨씬 넘는 상황
            try:
                found, seqs, files = qms.walk_media("r", root, None)
            finally:
                qms.MAX_WALK = saved
        self.assertEqual(sorted(e["name"] for e in found), ["v0.mp4", "v1.mp4", "v2.mp4"])
        self.assertEqual([s["count"] for s in seqs], [200])
        self.assertEqual(len(files), 200)


class SequenceDetectionTests(unittest.TestCase):
    """프레임 시퀀스 판정이 휴대폰·카메라 사진 모음을 시퀀스로 오판하지 않는지."""

    def names(self, pattern, numbers):
        return [pattern.format(n) for n in numbers]

    def test_consecutive_frames_are_a_sequence(self):
        self.assertTrue(qms.is_frame_sequence(self.names("frame_{:06d}.sbs.png", range(1, 41))))
        self.assertTrue(qms.is_frame_sequence(self.names("frame_{:06d}.png", range(1, 8000))))

    def test_frames_with_a_fixed_stride_are_a_sequence(self):
        self.assertTrue(qms.is_frame_sequence(self.names("f_{:05d}.png", range(0, 200, 5))))

    def test_too_few_files_is_not_a_sequence(self):
        self.assertFalse(qms.is_frame_sequence(self.names("frame_{:06d}.png", range(1, qms.SEQUENCE_MIN))))

    def test_camera_named_jpegs_are_photos_even_when_numbered_consecutively(self):
        self.assertFalse(qms.is_frame_sequence(self.names("IMG_{:04d}.jpg", range(1, 61))))
        self.assertFalse(qms.is_frame_sequence(self.names("DSC{:05d}.JPG", range(100, 160))))
        self.assertFalse(qms.is_frame_sequence(self.names("PXL_{:08d}.jpg", range(20260101, 20260161))))
        self.assertFalse(qms.is_frame_sequence(self.names("IMG_{:04d}.jpeg", range(1, 61))))

    def test_photo_sets_with_gaps_are_not_a_sequence(self):
        gappy = [n for n in range(1, 200) if n % 3 != 0 and n % 7 != 0]
        self.assertGreaterEqual(len(gappy), qms.SEQUENCE_MIN)
        self.assertFalse(qms.is_frame_sequence(self.names("trip_{:04d}.jpg", gappy)))
        self.assertFalse(qms.is_frame_sequence(self.names("IMG_{:04d}.png", gappy)))

    def test_date_and_counter_names_use_the_counter_column(self):
        self.assertTrue(qms.is_frame_sequence(self.names("shot_20260101_{:04d}.png", range(1, 51))))

    def test_walk_keeps_phone_photos_visible_and_hides_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "phone").mkdir()
            for i in range(1, 61):
                (root / "phone" / f"IMG_{i:04d}.jpg").write_bytes(b"j")
            (root / "frames").mkdir()
            for i in range(1, 61):
                (root / "frames" / f"frame_{i:06d}.png").write_bytes(b"p")
            found, seqs, _ = qms.walk_media("r", root, None)
        self.assertEqual(len([e for e in found if e["path"].startswith("phone/")]), 60)
        self.assertFalse(any(e["path"].startswith("frames/") for e in found))
        self.assertEqual([s["path"] for s in seqs], ["frames"])


class ListPagingTests(unittest.TestCase):
    """/api/list 가 MAX_LIST를 넘는 폴더를 offset으로 이어 받게 하는지."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        (base / "big").mkdir()
        for i in range(23):
            (base / "big" / f"f_{i:04d}.png").write_bytes(b"p")
        (base / "big" / "note.txt").write_text("x")
        (base / "big" / "sub").mkdir()
        cls.server = qms.QuestServer(("127.0.0.1", 0), {"demo": base.resolve()}, False, False, set())
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}") as resp:
            return json.loads(resp.read())

    def test_unpaged_request_returns_everything_with_total(self):
        data = self.get("/api/list?root=demo&path=big")
        self.assertEqual(data["total"], 25)  # 폴더 1 + png 23 + txt 1
        self.assertEqual(len(data["items"]), 25)
        self.assertEqual(data["offset"], 0)
        self.assertIsNone(data["nextOffset"])

    def test_pages_cover_every_entry_exactly_once(self):
        saved = qms.MAX_LIST
        qms.MAX_LIST = 10
        try:
            seen, offset, pages = [], 0, 0
            while offset is not None:
                data = self.get(f"/api/list?root=demo&path=big&offset={offset}")
                seen.extend(i["name"] for i in data["items"])
                self.assertEqual(data["total"], 25)
                self.assertLessEqual(len(data["items"]), 10)
                offset = data["nextOffset"]
                pages += 1
        finally:
            qms.MAX_LIST = saved
        self.assertEqual(pages, 3)
        self.assertEqual(len(seen), 25)
        self.assertEqual(len(set(seen)), 25)
        self.assertEqual(seen[0], "sub")  # 폴더 먼저, 이어서 파일 이름순

    def test_limit_is_clamped_and_bad_values_fall_back(self):
        self.assertEqual(len(self.get("/api/list?root=demo&path=big&limit=5")["items"]), 5)
        self.assertEqual(len(self.get("/api/list?root=demo&path=big&limit=abc&offset=zz")["items"]), 25)
        self.assertEqual(self.get("/api/list?root=demo&path=big&offset=999")["items"], [])


class ListCacheTests(unittest.TestCase):
    """/api/list 가 같은 폴더를 쪽마다 다시 읽지 않는지."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        (self.base / "big").mkdir()
        for i in range(12):
            (self.base / "big" / f"f_{i:03d}.png").write_bytes(b"p")
        self.server = qms.QuestServer(("127.0.0.1", 0), {"demo": self.base.resolve()}, False, False, set())
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.reads = 0
        self.real = qms.list_directory

        def counting(*args, **kwargs):
            self.reads += 1
            return self.real(*args, **kwargs)

        qms.list_directory = counting

    def tearDown(self):
        qms.list_directory = self.real
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def get(self, query):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/list?root=demo&path=big{query}") as resp:
            return json.loads(resp.read())

    def test_pages_reuse_one_folder_read(self):
        saved = qms.MAX_LIST
        qms.MAX_LIST = 5
        try:
            offset, pages = 0, 0
            while offset is not None:
                offset = self.get(f"&offset={offset}")["nextOffset"]
                pages += 1
        finally:
            qms.MAX_LIST = saved
        self.assertEqual(pages, 3)
        self.assertEqual(self.reads, 1, "쪽마다 폴더를 다시 읽으면 안 된다")

    def test_new_file_invalidates_the_cache(self):
        self.assertEqual(self.get("")["total"], 12)
        (self.base / "big" / "f_new.png").write_bytes(b"p")
        # 일부 파일시스템은 mtime 해상도가 낮아 같은 값이 될 수 있으니 폴더 mtime을 확실히 앞당긴다
        import os
        st = (self.base / "big").stat()
        os.utime(self.base / "big", ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
        self.assertEqual(self.get("")["total"], 13)
        self.assertEqual(self.reads, 2)

    def test_cache_expires_after_ttl(self):
        # TTL 0은 "기억하지 않음"이다. 시계 해상도(Windows monotonic은 약 15ms)와 무관하게 두 번 읽어야 한다.
        saved = qms.LIST_CACHE_TTL
        qms.LIST_CACHE_TTL = 0.0
        try:
            for _ in range(5):
                self.get("")
        finally:
            qms.LIST_CACHE_TTL = saved
        self.assertEqual(self.reads, 5)

    def test_cache_keeps_a_bounded_number_of_folders(self):
        for i in range(qms.LIST_CACHE_FOLDERS + 3):
            sub = self.base / f"d{i}"
            sub.mkdir()
            (sub / "x.png").write_bytes(b"p")
            with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/list?root=demo&path=d{i}") as resp:
                resp.read()
        self.assertLessEqual(len(self.server._list_cache), qms.LIST_CACHE_FOLDERS)

if __name__ == "__main__":
    unittest.main()
