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

if __name__ == "__main__":
    unittest.main()
