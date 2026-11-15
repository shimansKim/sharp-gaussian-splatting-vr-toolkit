"""설치형 PC 앱(pc-server/pc_*.py): 설정 저장, 공유 폴더 관리, 관리 API 보안, 포트 충돌 생존."""

import http.client
import importlib
import json
import os
import socket
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "pc-server"))
sys.path.insert(0, str(REPO / "scripts"))

TOKEN_HEADER = "X-Admin-Token"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class AppTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.env = mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.base / "appdata"), "SHARP_PC_SERVER_INSTANCE": "-unittest"})
        self.env.start()
        import quest_media_server
        import sharp_pc_server

        self.qms = importlib.reload(quest_media_server)
        self.app = importlib.reload(sharp_pc_server)
        self.pc_admin = sys.modules["pc_admin"]
        self.pc_settings = sys.modules["pc_settings"]
        self.docs = mock.patch.object(self.app, "documents_dir", return_value=self.base / "docs")
        self.docs.start()
        self.app.configure()
        self.qms.build_roots = self.app.build_roots
        self.cleanups = []

    def tearDown(self):
        for fn in reversed(self.cleanups):
            try:
                fn()
            except Exception:  # noqa: BLE001
                pass
        self.docs.stop()
        self.env.stop()
        self.tmp.cleanup()

    def folder(self, name):
        path = self.base / name
        path.mkdir(exist_ok=True)
        return path

    def controller(self, **kw):
        ctl = self.pc_admin.ServerController(self.qms, self.app.build_roots, **kw)
        self.cleanups.append(ctl.stop)
        return ctl


class SettingsTests(AppTestCase):
    def test_defaults_and_round_trip_without_temp_files(self):
        path = self.base / "settings.json"
        store = self.pc_settings.SettingsStore(path)
        self.assertEqual(store.get(), {"port": 8787, "openWindowOnStart": True})
        store.update(port=9001, openWindowOnStart=False)
        again = self.pc_settings.SettingsStore(path)
        self.assertEqual(again.get(), {"port": 9001, "openWindowOnStart": False})
        self.assertEqual([p.name for p in self.base.iterdir() if p.name.startswith("settings")], ["settings.json"])
        self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["port"], 9001)

    def test_invalid_values_fall_back_and_ports_are_validated(self):
        norm = self.pc_settings.normalize_settings
        self.assertEqual(norm({"port": 70000, "openWindowOnStart": "yes", "evil": 1}), {"port": 8787, "openWindowOnStart": True})
        self.assertEqual(norm("nonsense"), {"port": 8787, "openWindowOnStart": True})
        for bad in (0, 65536, -1, True, 1.5, "80a", "", None):
            with self.assertRaises(ValueError, msg=repr(bad)):
                self.pc_settings.validate_port(bad)
        self.assertEqual(self.pc_settings.validate_port(" 8788 "), 8788)

    def test_corrupt_file_is_set_aside(self):
        path = self.base / "settings.json"
        path.write_text("{not json", encoding="utf-8")
        store = self.pc_settings.SettingsStore(path)
        self.assertEqual(store.get()["port"], 8787)
        self.assertTrue((self.base / "settings.json.bad").is_file())

    def test_folder_file_keeps_comments_dedupes_and_uses_crlf(self):
        path = self.base / "shared_folders.txt"
        path.write_bytes("# 내 폴더\r\nD:\\old\r\n".encode("utf-8"))
        a = self.folder("a")
        self.assertTrue(self.pc_settings.add_folder(path, a))
        if os.name == "nt":  # 대소문자만 다른 같은 폴더(Windows 파일 시스템에서만 같은 폴더다)
            self.assertFalse(self.pc_settings.add_folder(path, Path(str(a).upper())))
        self.assertFalse(self.pc_settings.add_folder(path, a))  # 같은 폴더를 다시 넣어도 늘지 않는다
        raw = path.read_bytes()
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))
        self.assertIn("# 내 폴더".encode("utf-8"), raw)
        self.assertTrue(self.pc_settings.remove_folder(path, "D:\\old"))
        self.assertFalse(self.pc_settings.remove_folder(path, "D:\\old"))
        self.assertEqual(self.pc_settings.list_folders(path), [a])
        self.assertIn("# 내 폴더".encode("utf-8"), path.read_bytes())

    def test_log_stream_rotates_and_never_needs_a_console(self):
        log = self.base / "server.log"
        stream = self.pc_settings.LogStream(log, mirror=None, max_bytes=200)
        for i in range(30):
            print(f"줄 {i} " + "x" * 20, file=stream)
        self.assertTrue(log.is_file())
        self.assertTrue((self.base / "server.log.1").is_file())
        self.assertLess(log.stat().st_size, 400)
        self.assertIn("줄 29", log.read_text(encoding="utf-8"))

    @unittest.skipUnless(sys.platform == "win32", "Windows 레지스트리")
    def test_autostart_registry_value_round_trip(self):
        ps = self.pc_settings
        self.assertEqual(ps.run_value_name(), "SHARP PC Server-unittest")  # 사람의 실제 값과 이름이 다르다
        self.cleanups.append(lambda: ps.set_autostart(False))
        self.assertIsNone(ps.get_autostart())
        ps.set_autostart(True, '"C:\\x\\app.exe" --background')
        self.assertEqual(ps.get_autostart(), '"C:\\x\\app.exe" --background')
        ps.set_autostart(False)
        ps.set_autostart(False)  # 없는 값을 또 지워도 오류가 아니다
        self.assertIsNone(ps.get_autostart())
        self.assertIn("--background", ps.autostart_command())


class AdminApiTests(AppTestCase):
    def setUp(self):
        super().setUp()
        self.opened = []
        self.hooks = self.pc_admin.AppHooks(version="9.9.9", data_dir=self.base / "appdata", open_in_explorer=self.opened.append)
        self.lan_port = free_port()
        self.ctl = self.controller()
        self.assertTrue(self.ctl.start(self.lan_port))
        self.store = self.pc_settings.SettingsStore(self.base / "settings.json")
        self.admin = self.pc_admin.AdminServer(self.ctl, self.store, self.hooks, REPO / "pc-server" / "settings_page.html", REPO / "pc-server" / "settings_page.js",
                                              favicon=REPO / "pc-server" / "assets" / "app-32.png")
        self.admin.start()
        self.cleanups.append(self.admin.stop)
        self.token = self.admin.token
        self.port = self.admin.admin_port

    def call(self, method, path, *, token="default", host="default", origin=None, body=None, content_type="application/json", port=None):
        conn = http.client.HTTPConnection("127.0.0.1", port or self.port, timeout=10)
        headers = {"Host": f"127.0.0.1:{self.port}" if host == "default" else host}
        if token == "default":
            token = self.token
        if token is not None:
            headers[TOKEN_HEADER] = token
        if origin is not None:
            headers["Origin"] = origin
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = content_type
        try:
            conn.request(method, path, body=data, headers=headers)
            resp = conn.getresponse()
            raw = resp.read()
            try:
                return resp.status, json.loads(raw)
            except ValueError:
                return resp.status, raw
        finally:
            conn.close()

    # -- 보안
    def test_state_needs_the_token_and_a_local_host(self):
        self.assertEqual(self.call("GET", "/api/admin/state")[0], 200)
        self.assertEqual(self.call("GET", "/api/admin/state", token=None)[0], 403)
        self.assertEqual(self.call("GET", "/api/admin/state", token="wrong")[0], 403)
        self.assertEqual(self.call("GET", "/api/admin/state", token=self.token[:-1])[0], 403)
        self.assertEqual(self.call("GET", "/api/admin/state", host="evil.example.com")[0], 403)  # DNS 리바인딩
        self.assertEqual(self.call("GET", "/api/admin/state", host=f"127.0.0.1:{self.port + 1}")[0], 403)
        self.assertEqual(self.call("GET", "/api/admin/state", host="192.168.0.5:%d" % self.port)[0], 403)
        self.assertEqual(self.call("GET", "/api/admin/state", host=f"localhost:{self.port}")[0], 200)

    def test_origin_must_match_when_present(self):
        same = f"http://127.0.0.1:{self.port}"
        self.assertEqual(self.call("GET", "/api/admin/state", origin=same)[0], 200)
        for origin in ("https://evil.example", f"http://localhost:{self.port}", "null", f"http://127.0.0.1:{self.lan_port}"):
            self.assertEqual(self.call("GET", "/api/admin/state", origin=origin)[0], 403, origin)
            self.assertEqual(self.call("POST", "/api/admin/restart", origin=origin, body={})[0], 403, origin)

    def test_pure_check_rejects_non_loopback_with_404(self):
        ev = self.pc_admin.evaluate_request
        host = f"127.0.0.1:{self.port}"
        self.assertEqual(ev("127.0.0.1", host, None, "t", "t", self.port)[0], 200)
        self.assertEqual(ev("::1", f"[::1]:{self.port}", None, "t", "t", self.port)[0], 200)
        self.assertEqual(ev("::ffff:127.0.0.1", host, None, "t", "t", self.port)[0], 200)
        for ip in ("192.168.0.20", "10.0.0.2", "8.8.8.8", "fe80::1", "0.0.0.0", "not-an-ip", ""):
            self.assertEqual(ev(ip, host, None, "t", "t", self.port)[0], 404, ip)  # 토큰이 맞아도 LAN은 존재 자체를 숨긴다
        self.assertEqual(ev("127.0.0.1", None, None, "t", "t", self.port)[0], 403)
        self.assertEqual(ev("127.0.0.1", host, None, None, "t", self.port)[0], 403)
        self.assertEqual(ev("127.0.0.1", host, None, "", "t", self.port)[0], 403)

    def test_every_mutating_route_is_protected(self):
        routes = ["folders/add", "folders/add-many", "folders/remove", "folders/choose", "folders/open", "settings", "restart", "quit"]
        for route in routes:
            path = "/api/admin/" + route
            self.assertEqual(self.call("POST", path, token=None, body={})[0], 403, route)
            self.assertEqual(self.call("POST", path, token="x", body={})[0], 403, route)
            self.assertEqual(self.call("POST", path, host="evil.example", body={})[0], 403, route)
        self.assertEqual(self.call("POST", "/api/admin/restart", content_type="text/plain", body={})[0], 415)  # 폼 전송(CSRF) 형태
        self.assertEqual(self.call("OPTIONS", "/api/admin/restart")[0], 403)  # CORS 사전 요청도 받지 않는다
        self.assertEqual(self.call("GET", "/api/admin/nope")[0], 404)

    def test_settings_page_needs_token_but_script_is_static(self):
        status, body = self.call("GET", f"/settings?t={self.token}", token=None)
        self.assertEqual(status, 200)
        self.assertIn("SHARP PC 서버 관리".encode("utf-8"), body)
        self.assertEqual(self.call("GET", "/settings", token=None)[0], 403)
        self.assertEqual(self.call("GET", "/settings?t=bad", token=None)[0], 403)
        self.assertEqual(self.call("GET", "/settings?t=" + self.token, token=None, host="evil.example")[0], 403)
        status, js = self.call("GET", "/settings/page.js", token=None)
        self.assertEqual(status, 200)
        self.assertNotIn(self.token.encode("utf-8"), js)
        self.assertEqual(self.call("GET", "/settings/page.js", token=None, host="evil.example")[0], 403)
        status, icon = self.call("GET", "/settings/favicon.png", token=None)
        self.assertEqual((status, icon[1:4]), (200, b"PNG"))
        self.assertEqual(self.call("GET", "/settings/favicon.png", token=None, host="evil.example")[0], 403)

    def test_admin_is_not_served_on_the_lan_port(self):
        for path in ("/settings", f"/settings?t={self.token}", "/api/admin/state", "/settings/page.js"):
            req = urllib.request.Request(f"http://127.0.0.1:{self.lan_port}{path}", headers={TOKEN_HEADER: self.token})
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req, timeout=5)
            self.assertEqual(ctx.exception.code, 404, path)
        self.assertNotEqual(self.lan_port, self.port)
        self.assertEqual(self.admin.server_address[0], "127.0.0.1")  # 0.0.0.0이 아니다

    def test_quest_api_keeps_its_contract(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.lan_port}/api/info", timeout=5) as resp:
            info = json.loads(resp.read())
        self.assertEqual(info["app"], "sharp-quest-server")
        self.assertEqual(info["version"], self.qms.API_VERSION)
        self.assertEqual(set(info), {"app", "version", "host", "mdns", "addresses", "probe", "roots"})
        with urllib.request.urlopen(f"http://127.0.0.1:{self.lan_port}/api/bindings", timeout=5) as resp:
            self.assertEqual(json.loads(resp.read())["schema"], 2)

    def test_admin_binding_catalog_save_reset(self):
        self.assertEqual(self.call("GET", "/api/admin/bindings", token=None)[0], 403)
        status, data = self.call("GET", "/api/admin/bindings")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["slots"]), 10)
        bindings = dict(data["record"]["bindings"])
        bindings["A.short"] = "hud:play"
        status, saved = self.call("POST", "/api/admin/bindings/save", body={"bindings": bindings, "updatedAt": 100, "expectedUpdatedAt": 0})
        self.assertEqual((status, saved["record"]["bindings"]), (200, bindings))
        with urllib.request.urlopen(f"http://127.0.0.1:{self.lan_port}/api/bindings", timeout=5) as response:
            self.assertEqual(json.loads(response.read())["bindings"], bindings)
        self.assertEqual(self.call("POST", "/api/admin/bindings/reset", body={"updatedAt": 99, "expectedUpdatedAt": 100})[0], 409)
        status, reset = self.call("POST", "/api/admin/bindings/reset", body={"updatedAt": 101, "expectedUpdatedAt": 100})
        self.assertEqual((status, reset["record"]["bindings"]), (200, data["defaults"]))

    def test_bindings_compare_and_save_against_quest_change(self):
        defaults = dict(self.qms.binding_catalog.DEFAULTS)
        first = {"bindings": defaults, "updatedAt": 100, "expectedUpdatedAt": 0}
        self.assertEqual(self.call("POST", "/api/admin/bindings/save", body=first)[0], 200)
        _, initial = self.call("GET", "/api/admin/bindings")
        quest = dict(defaults)
        quest["A.long"] = "nav.next"
        payload = {"schema": 2, "bindings": quest, "updatedAt": 200}
        req = urllib.request.Request(f"http://127.0.0.1:{self.lan_port}/api/bindings", method="PUT",
                                     headers={"Content-Type": "application/json", "X-Sharp-App": "splatia"},
                                     data=json.dumps(payload).encode())
        with urllib.request.urlopen(req, timeout=5) as response:
            self.assertEqual(response.status, 200)
        mine = dict(defaults)
        mine["A.long"] = "nav.prev"
        body = {"bindings": mine, "expectedUpdatedAt": initial["record"]["updatedAt"]}
        for route, request in (("save", body), ("reset", {"expectedUpdatedAt": 100})):
            status, result = self.call("POST", "/api/admin/bindings/" + route, body=request)
            self.assertEqual(status, 409)
            self.assertEqual(result["current"], payload)
        status, result = self.call("POST", "/api/admin/bindings/save", body={**body, "force": True})
        self.assertEqual((status, result["record"]["bindings"]), (200, mine))
        self.assertEqual(self.call("POST", "/api/admin/bindings/save", body={"bindings": mine})[0], 400)

    def test_admin_rejects_bindings_without_ui_toggle(self):
        bindings = {slot: "" for slot in self.qms.binding_catalog.SLOTS}
        status, _ = self.call("POST", "/api/admin/bindings/save", body={"bindings": bindings, "expectedUpdatedAt": 0})
        self.assertEqual(status, 400)
        status, data = self.call("POST", "/api/admin/bindings/reset", body={"expectedUpdatedAt": 0})
        self.assertEqual((status, data["record"]["bindings"]), (200, self.qms.binding_catalog.DEFAULTS))

    # -- 폴더
    def lan_roots(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.lan_port}/api/info", timeout=5) as resp:
            return json.loads(resp.read())["roots"]

    def test_add_and_remove_folder_apply_without_restart(self):
        videos = self.folder("videos")
        (videos / "a.ply").write_bytes(b"ply")
        status, data = self.call("GET", "/api/admin/state")
        self.assertEqual([f["kind"] for f in data["folders"]], ["default"])
        self.assertFalse(data["folders"][0]["removable"])
        self.assertEqual(len(self.lan_roots()), 1)

        status, data = self.call("POST", "/api/admin/folders/add", body={"path": str(videos)})
        self.assertEqual(status, 200, data)
        self.assertEqual([f["kind"] for f in data["folders"]], ["saved"])  # 폴더를 더하면 기본 폴더는 빠진다(기존 동작)
        self.assertEqual([r["id"] for r in self.lan_roots()], ["videos"])
        with urllib.request.urlopen(f"http://127.0.0.1:{self.lan_port}/api/list?root=videos", timeout=5) as resp:
            self.assertEqual([i["name"] for i in json.loads(resp.read())["items"]], ["a.ply"])
        self.assertIn(str(videos.resolve()), self.qms.FOLDERS_FILE.read_text(encoding="utf-8"))

        status, data = self.call("POST", "/api/admin/folders/add", body={"path": str(videos)})  # 중복은 목록에 한 번만
        self.assertEqual(len(data["folders"]), 1)
        status, data = self.call("POST", "/api/admin/folders/add", body={"path": str(self.base / "nope")})
        self.assertEqual(status, 400)
        self.assertIn("폴더가 없습니다", data["error"])
        status, data = self.call("POST", "/api/admin/folders/add", body={"path": ""})
        self.assertEqual(status, 400)

        status, data = self.call("POST", "/api/admin/folders/remove", body={"path": str(videos)})
        self.assertEqual(status, 200)
        self.assertEqual([f["kind"] for f in data["folders"]], ["default"])
        self.assertEqual([r["id"] for r in self.lan_roots()], ["sharp-vr"])
        self.assertEqual(self.call("POST", "/api/admin/folders/remove", body={"path": str(videos)})[0], 400)

    def test_same_name_folder_swap_does_not_serve_stale_listing(self):
        one, two = self.folder("one") / "pics", self.folder("two") / "pics"
        one.mkdir()
        two.mkdir()
        (one / "old.ply").write_bytes(b"ply")
        (two / "new.ply").write_bytes(b"ply")
        self.call("POST", "/api/admin/folders/add", body={"path": str(one)})

        def names():
            with urllib.request.urlopen(f"http://127.0.0.1:{self.lan_port}/api/list?root=pics", timeout=5) as resp:
                return [i["name"] for i in json.loads(resp.read())["items"]]

        self.assertEqual(names(), ["old.ply"])
        self.call("POST", "/api/admin/folders/remove", body={"path": str(one)})
        self.call("POST", "/api/admin/folders/add", body={"path": str(two)})
        self.assertEqual(names(), ["new.ply"])  # root id가 같아도 옛 목록 캐시를 쓰지 않는다

    def test_missing_folder_is_flagged_and_only_listed_folders_open(self):
        gone = self.folder("gone")
        self.call("POST", "/api/admin/folders/add", body={"path": str(gone)})
        self.ctl._scan_queue.join()
        gone.rmdir()
        with self.ctl._scan_lock:
            self.ctl._scan_cache.clear()
        self.call("GET", "/api/admin/state")
        self.ctl._scan_queue.join()
        status, data = self.call("GET", "/api/admin/state")
        entry = [f for f in data["folders"] if f["kind"] == "saved"][0]
        self.assertFalse(entry["exists"])
        self.assertEqual(self.call("POST", "/api/admin/folders/open", body={"path": str(gone)})[0], 400)
        self.assertEqual(self.call("POST", "/api/admin/folders/open", body={"path": "C:\\Windows"})[0], 400)  # 목록 밖 경로는 열지 않는다
        self.assertEqual(self.opened, [])
        listed = self.folder("listed")
        self.call("POST", "/api/admin/folders/add", body={"path": str(listed)})
        self.ctl._scan_queue.join()
        self.assertEqual(self.call("POST", "/api/admin/folders/open", body={"path": str(listed)})[0], 200)
        self.assertEqual(self.opened, [listed.resolve()])

    def test_open_rechecks_directory_instead_of_trusting_cached_scan(self):
        folder = self.folder("formerly-folder.exe")
        self.call("POST", "/api/admin/folders/add", body={"path": str(folder)})
        self.ctl._scan_queue.join()
        _, state = self.call("GET", "/api/admin/state")
        self.assertTrue(next(e for e in state["folders"] if e["path"] == str(folder.resolve()))["exists"])
        folder.rmdir()
        folder.write_bytes(b"not a directory")
        status, _ = self.call("POST", "/api/admin/folders/open", body={"path": str(folder)})
        self.assertEqual(status, 400)
        self.assertEqual(self.opened, [])

    def test_choose_dialog_hook_adds_or_cancels(self):
        picked = self.folder("picked")
        self.hooks.choose_folder = lambda: None
        status, data = self.call("POST", "/api/admin/folders/choose", body={})
        self.assertTrue(data["cancelled"])
        self.hooks.choose_folder = lambda: picked
        status, data = self.call("POST", "/api/admin/folders/choose", body={})
        self.assertEqual(status, 200)
        self.assertEqual([f["path"] for f in data["folders"]], [str(picked.resolve())])

    def test_add_many_and_folder_counts(self):
        one, two = self.folder("one"), self.folder("two")
        child = one / "child"
        child.mkdir()
        for name in ("a.ply", "b.MP4", "c.jpg"):
            (child / name).write_bytes(b"x")
        paths = [str(one), str(one), str(child), str(self.base / "missing"), str(two)]
        status, data = self.call("POST", "/api/admin/folders/add-many", body={"paths": paths})
        self.assertEqual(status, 200)
        self.assertEqual([r["status"] for r in data["results"]], ["added", "duplicate", "overlap", "missing", "added"])
        self.ctl._scan_queue.join()
        _, data = self.call("GET", "/api/admin/state")
        entry = next(e for e in data["folders"] if e["path"] == str(one.resolve()))
        self.assertEqual(entry["counts"], {"ply": 1, "video": 1, "photo": 1, "truncated": False})
        self.assertTrue(entry["canOpen"])
        self.assertEqual(self.call("POST", "/api/admin/folders/add-many", body={"paths": [5]})[0], 400)

    def test_slow_scan_does_not_block_state(self):
        import threading
        entered, release = threading.Event(), threading.Event()
        folder = self.folder("slow")
        self.ctl._scan_queue.join()
        def slow(path):
            entered.set()
            release.wait(5)
            return {"ply": 0, "video": 0, "photo": 0, "truncated": False}
        try:
            with mock.patch.object(self.pc_admin, "folder_counts", side_effect=slow):
                self.call("POST", "/api/admin/folders/add", body={"path": str(folder)})
                self.assertTrue(entered.wait(2))
                status, state = self.call("GET", "/api/admin/state")
                self.assertEqual(status, 200)
                entry = next(e for e in state["folders"] if e["path"] == str(folder.resolve()))
                self.assertEqual(entry["scanStatus"], "scanning")
        finally:
            release.set()
            self.ctl._scan_queue.join()

    def test_choose_multiple(self):
        one, two = self.folder("picked-one"), self.folder("picked-two")
        self.hooks.choose_folder = lambda: [one, two]
        status, data = self.call("POST", "/api/admin/folders/choose", body={})
        self.assertEqual(status, 200)
        self.assertEqual([r["status"] for r in data["results"]], ["added", "added"])

    # -- 설정·포트
    def test_port_change_moves_the_lan_server_and_persists(self):
        new_port = free_port()
        status, data = self.call("POST", "/api/admin/settings", body={"port": new_port})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["server"]["port"], new_port)
        self.assertEqual(self.pc_settings.SettingsStore(self.base / "settings.json").get()["port"], new_port)
        with urllib.request.urlopen(f"http://127.0.0.1:{new_port}/api/info", timeout=5) as resp:
            self.assertEqual(resp.status, 200)
        with self.assertRaises(OSError):
            urllib.request.urlopen(f"http://127.0.0.1:{self.lan_port}/api/info", timeout=2)

    def test_port_change_to_busy_port_keeps_old_server(self):
        with socket.socket() as busy:
            busy.bind(("0.0.0.0", 0))
            busy.listen(1)
            status, data = self.call("POST", "/api/admin/settings", body={"port": busy.getsockname()[1]})
        self.assertEqual(status, 400)
        self.assertIn("쓰고 있습니다", data["error"])
        self.assertEqual(data["server"]["state"], "running")
        self.assertEqual(data["server"]["port"], self.lan_port)
        self.assertEqual(self.store.get()["port"], 8787)  # 실패한 포트는 저장하지 않는다
        with urllib.request.urlopen(f"http://127.0.0.1:{self.lan_port}/api/info", timeout=5) as resp:
            self.assertEqual(resp.status, 200)

    def test_invalid_settings_are_rejected(self):
        for body in ({"port": 0}, {"port": "abc"}, {"port": 99999}, {"openWindowOnStart": "x"}, {"autostart": "yes"}):
            status, data = self.call("POST", "/api/admin/settings", body=body)
            self.assertEqual(status, 400, body)
            self.assertFalse(data["ok"])

    def test_open_window_option_is_saved(self):
        status, data = self.call("POST", "/api/admin/settings", body={"openWindowOnStart": False})
        self.assertEqual(status, 200)
        self.assertFalse(data["settings"]["openWindowOnStart"])
        self.assertFalse(self.pc_settings.SettingsStore(self.base / "settings.json").get()["openWindowOnStart"])

    @unittest.skipUnless(sys.platform == "win32", "Windows 레지스트리")
    def test_autostart_option_writes_registry_value(self):
        ps = self.pc_settings
        self.cleanups.append(lambda: ps.set_autostart(False))
        status, data = self.call("POST", "/api/admin/settings", body={"autostart": True})
        self.assertEqual(status, 200)
        self.assertTrue(data["settings"]["autostart"])
        self.assertIn("--background", ps.get_autostart())
        status, data = self.call("POST", "/api/admin/settings", body={"autostart": False})
        self.assertFalse(data["settings"]["autostart"])
        self.assertIsNone(ps.get_autostart())

    def test_restart_and_quit_hooks(self):
        quits = []
        self.hooks.quit = lambda: quits.append(1)
        self.assertEqual(self.call("POST", "/api/admin/restart", body={})[0], 200)
        with urllib.request.urlopen(f"http://127.0.0.1:{self.lan_port}/api/info", timeout=5) as resp:
            self.assertEqual(resp.status, 200)
        self.assertEqual(self.call("POST", "/api/admin/quit", body={})[0], 200)
        self.assertEqual(quits, [1])


class PortConflictTests(AppTestCase):
    def test_busy_port_does_not_kill_the_app_and_recovers(self):
        changes = []
        with socket.socket() as busy:
            busy.bind(("0.0.0.0", 0))
            busy.listen(1)
            port = busy.getsockname()[1]
            ctl = self.controller(on_change=lambda: changes.append(1))
            self.assertFalse(ctl.start(port))
            snap = ctl.snapshot()
            self.assertEqual(snap["state"], "error")
            self.assertIn(str(port), snap["error"])
            self.assertTrue(changes)
            store = self.pc_settings.SettingsStore(self.base / "settings.json")
            admin = self.pc_admin.AdminServer(ctl, store, self.pc_admin.AppHooks(), REPO / "pc-server" / "settings_page.html", REPO / "pc-server" / "settings_page.js")
            admin.start()
            self.cleanups.append(admin.stop)
            conn = http.client.HTTPConnection("127.0.0.1", admin.admin_port, timeout=5)
            conn.request("GET", "/api/admin/state", headers={TOKEN_HEADER: admin.token})
            state = json.loads(conn.getresponse().read())
            self.assertEqual(state["server"]["state"], "error")  # 관리 창은 LAN 포트와 무관하게 뜬다
            self.assertIsNone(state["server"]["bindingsUrl"])
            self.assertEqual(self.call_restart(admin), 200)  # 아직 충돌 중이어도 다시 시작이 죽지 않는다
            self.assertEqual(ctl.snapshot()["state"], "error")
        ok, error = ctl.apply_port(free_port())  # 다른 포트를 고르면 살아난다
        self.assertTrue(ok, error)
        self.assertEqual(ctl.snapshot()["state"], "running")

    def call_restart(self, admin):
        conn = http.client.HTTPConnection("127.0.0.1", admin.admin_port, timeout=5)
        conn.request("POST", "/api/admin/restart", body=b"{}", headers={TOKEN_HEADER: admin.token, "Content-Type": "application/json"})
        return conn.getresponse().status

    def test_second_bind_on_same_port_reports_in_use(self):
        first = self.controller()
        port = free_port()
        self.assertTrue(first.start(port))
        second = self.controller()
        self.assertFalse(second.start(port))
        self.assertIn("쓰고 있습니다", second.error)


class WiringTests(AppTestCase):
    def test_page_assets_exist_and_build_includes_them(self):
        import build

        self.assertTrue((REPO / "pc-server" / "settings_page.html").is_file())
        self.assertTrue((REPO / "pc-server" / "settings_page.js").is_file())
        for name in ("settings_page.html", "settings_page.js"):
            self.assertIn(name, build.DATA_FILES)

    def test_icon_path_falls_back_when_missing(self):
        import pc_tray

        self.assertIsNone(pc_tray.find_icon_file(self.base, self.base))
        (self.base / "assets").mkdir()
        (self.base / "assets" / "app.ico").write_bytes(b"ico")
        self.assertEqual(pc_tray.find_icon_file(self.base, self.base), self.base / "assets" / "app.ico")

    def test_cli_flags_are_still_accepted(self):
        own, rest = self.app.parse_own_args(["--port", "9000", "--probe", "--no-remember", "D:\\x", "--choose-folder", "--forget-folders", "--version", "--console", "--headless", "--background", "--quit"])
        self.assertTrue(all([own.choose_folder, own.forget_folders, own.version, own.console, own.headless, own.background, own.quit]))
        self.assertEqual(rest, ["--port", "9000", "--probe", "--no-remember", "D:\\x"])
        self.assertTrue(self.app.explicit_port(rest))
        self.assertFalse(self.app.explicit_port(["--probe"]))


if __name__ == "__main__":
    unittest.main()
