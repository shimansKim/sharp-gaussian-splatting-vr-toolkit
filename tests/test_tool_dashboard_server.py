import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import tool_dashboard_server as dashboard


class ToolDashboardServerTests(unittest.TestCase):
    def test_registered_batch_files_exist_and_use_bat_directory(self):
        for tool in dashboard.TOOLS:
            with self.subTest(tool=tool.id):
                expected = (dashboard.PROJECT_ROOT / "bat" / tool.bat).resolve()
                self.assertEqual(Path(dashboard.tool_to_json(tool)["batPath"]), expected)
                self.assertTrue(expected.is_file())

    def test_root_batch_files_are_exactly_the_allowed_launchers(self):
        self.assertEqual(
            {path.name for path in dashboard.PROJECT_ROOT.glob("*.bat")},
            {"run_tool_dashboard.bat", "run_quest_pc_server.bat",
             "update_quest_pc_server.bat", "run_quest_pc_probe.bat"},
        )

    def test_bat_launch_uses_project_root_working_directory(self):
        with mock.patch.object(dashboard.subprocess, "Popen") as popen:
            popen.return_value.pid = 1
            dashboard.launch_tool("check_env", None)
        command = popen.call_args.args[0]
        self.assertEqual(Path(command[2]), dashboard.BAT_DIR / "check_env.bat")
        self.assertEqual(popen.call_args.kwargs["cwd"], dashboard.PROJECT_ROOT)

    def test_file_picker_keeps_requested_extensions_and_local_filters(self):
        import tkinter
        from tkinter import filedialog

        root = mock.MagicMock()
        with mock.patch.object(tkinter, "Tk", return_value=root), mock.patch.object(
            filedialog, "askopenfilename", return_value="C:/demo/image.png"
        ) as picker:
            self.assertEqual(dashboard.pick_path("file", [".png", ".jpg"]), "C:/demo/image.png")
        root.lift.assert_called_once()
        root.focus_force.assert_called_once()
        root.destroy.assert_called_once()
        filters = picker.call_args.kwargs["filetypes"]
        self.assertEqual(filters[0], ("요청한 지원 파일", "*.png *.jpg"))
        self.assertTrue(any("3D PLY" in title for title, _ in filters))

    def test_video_pipeline_requires_a_file_path(self):
        tool = dashboard.TOOLS_BY_ID["video_to_vr_pipeline"]

        with self.assertRaises(ValueError):
            dashboard.build_launch_command(tool, None)

    def test_double_click_tools_do_not_require_a_path(self):
        tool = dashboard.TOOLS_BY_ID["check_env"]

        command = dashboard.build_launch_command(tool, None)

        self.assertEqual(command[:2], ["cmd.exe", "/c"])
        self.assertTrue(command[2].endswith("check_env.bat"))

    def test_ply_render_tool_accepts_a_path_with_default_render_settings(self):
        tool = dashboard.TOOLS_BY_ID["render_stereo_video"]

        command = dashboard.build_launch_command(tool, r"C:\demo\scene.ply")

        self.assertEqual(command[-3:], [r"C:\demo\scene.ply", "rotate_forward", "4"])

    def test_selected_image_or_folder_render_tool_accepts_the_chosen_path(self):
        tool = dashboard.TOOLS_BY_ID["run_predict_render_drag_image_here"]

        command = dashboard.build_launch_command(tool, r"C:\demo\images")

        self.assertTrue(command[2].endswith("run_predict_render_drag_image_here.bat"))
        self.assertEqual(command[-1], r"C:\demo\images")

    def test_configured_image_render_passes_trajectory_and_duration(self):
        tool = dashboard.TOOLS_BY_ID["run_predict_render_configured"]

        command = dashboard.build_launch_command(
            tool,
            r"C:\demo\image.png",
            trajectory="rotate",
            duration_seconds=6,
        )

        self.assertEqual(command[-3:], [r"C:\demo\image.png", "rotate", "6"])

    def test_folder_video_merge_accepts_the_chosen_folder(self):
        tool = dashboard.TOOLS_BY_ID.get("merge_folder_videos")
        self.assertIsNotNone(tool)

        command = dashboard.build_launch_command(tool, r"C:\demo\sharp_mp4s")

        self.assertTrue(command[2].endswith("merge_folder_videos.bat"))
        self.assertEqual(command[-1], r"C:\demo\sharp_mp4s")

    def test_configured_ply_render_tools_pass_path_trajectory_and_duration(self):
        expected = {
            "render_ply_video": "render_ply_video.bat",
            "render_stereo_video": "render_stereo_video.bat",
        }

        for tool_id, bat_name in expected.items():
            tool = dashboard.TOOLS_BY_ID.get(tool_id)
            self.assertIsNotNone(tool)
            self.assertEqual(tool.input_mode, "ply_render_configurable")

            command = dashboard.build_launch_command(
                tool,
                r"C:\demo\plys",
                trajectory="swipe",
                duration_seconds=3.5,
            )

            self.assertTrue(command[2].endswith(bat_name))
            self.assertEqual(command[-3:], [r"C:\demo\plys", "swipe", "3.5"])

    def test_configured_ply_render_rejects_a_zero_duration(self):
        tool = dashboard.TOOLS_BY_ID["render_stereo_video"]

        with self.assertRaises(ValueError):
            dashboard.build_launch_command(tool, r"C:\demo\scene.ply", duration_seconds=0)

    def test_60fps_resume_command_preserves_existing_output_folder(self):
        tool = dashboard.TOOLS_BY_ID["resume_video_to_vr_pipeline_60fps"]

        command = dashboard.build_launch_command(
            tool,
            r"C:\demo\source.mp4",
            r"C:\demo\outputs\video_vr_20260829-135525",
            15258,
        )

        self.assertEqual(command[3], r"C:\demo\source.mp4")
        self.assertEqual(
            command[4:],
            [
                "--output-dir",
                r"C:\demo\outputs\video_vr_20260829-135525",
                "--resume",
                "--repair-frames-from",
                "15258",
                "--delete-ply-after-render",
            ],
        )

    def test_60fps_resume_command_uses_automatic_repair_when_frame_is_empty(self):
        tool = dashboard.TOOLS_BY_ID["resume_video_to_vr_pipeline_60fps"]

        command = dashboard.build_launch_command(
            tool,
            r"C:\demo\source.mp4",
            r"C:\demo\outputs\video_vr_20260829-135525",
            None,
        )

        self.assertNotIn("--repair-frames-from", command)

    def test_30fps_resume_command_accepts_parallel_render_worker_count(self):
        tool = dashboard.TOOLS_BY_ID["resume_video_to_vr_pipeline"]

        command = dashboard.build_launch_command(
            tool,
            r"C:\demo\source.mp4",
            r"C:\demo\outputs\video_vr_20260829-135525",
            None,
            4,
        )

        self.assertTrue(command[2].endswith("video_to_vr_pipeline.bat"))
        self.assertEqual(command[-2:], ["--render-workers", "4"])

    def test_resume_command_accepts_ply_batch_size(self):
        tool = dashboard.TOOLS_BY_ID["resume_video_to_vr_pipeline_60fps"]

        command = dashboard.build_launch_command(
            tool,
            r"C:\demo\source.mp4",
            r"C:\demo\outputs\video_vr_20260829-135525",
            None,
            4,
            1000,
        )

        self.assertEqual(command[-4:], ["--render-workers", "4", "--ply-batch-size", "1000"])

    def test_tool_catalog_exposes_safe_input_modes(self):
        modes = {tool.id: tool.input_mode for tool in dashboard.TOOLS}

        self.assertEqual(modes["setup_environment"], "none")
        self.assertEqual(modes["run_predict"], "none")
        self.assertEqual(modes["run_predict_drag_image_here"], "file_or_folder_required")
        self.assertEqual(modes["video_to_vr_pipeline"], "file_required")
        self.assertEqual(modes["video_to_vr_pipeline_test_5frames"], "file_optional")

    def test_quest_app_hevc_tool_runs_the_pipeline_in_quest_app_mode(self):
        tool = dashboard.TOOLS_BY_ID["quest_app_hevc"]
        self.assertEqual(tool.input_mode, "file_or_folder_required")
        with self.assertRaises(ValueError):
            dashboard.build_launch_command(tool, None)

        command = dashboard.build_launch_command(tool, r"C:\demo\clips")

        self.assertTrue(command[2].endswith("sharp_pipeline.py"))
        self.assertEqual(command[3:], ["-i", r"C:\demo\clips", "--mode", "quest_app"])

    def test_quest3_8k_tool_says_it_is_for_pc_streaming_players_and_keeps_its_mode(self):
        tool = dashboard.TOOLS_BY_ID["batch_quest3_optimize"]

        self.assertIn("4XVR", tool.title)
        self.assertIn("PC 스트리밍", tool.summary)
        self.assertIn("Quest 앱용 HEVC", tool.caution)
        self.assertEqual(dashboard.build_launch_command(tool, r"C:\demo")[3:], ["-i", r"C:\demo", "--mode", "optimize_quest3"])

    def test_dashboard_html_offers_the_quest_app_mode(self):
        html = dashboard.DASHBOARD_HTML.read_text(encoding="utf-8")

        self.assertIn("data-mode=\"quest_app\"", html)
        self.assertIn("Quest 앱용 HEVC 변환", html)
        self.assertIn("PC 스트리밍 플레이어 4XVR", html)


class DashboardSecurityTests(unittest.TestCase):
    """명령 주입(셸 문자열 결합)과 다른 웹페이지에서 온 요청(CSRF·DNS 리바인딩) 방어."""

    # ---- 인자 목록 실행 ----
    def tail(self, command):
        """pipeline_command가 만든 [python, run_and_pause.py, sharp_pipeline.py, ...인자]에서 인자만."""
        self.assertTrue(command[1].endswith("run_and_pause.py"))
        self.assertTrue(command[2].endswith("sharp_pipeline.py"))
        return command[3:]

    def test_pipeline_tools_build_argument_lists_without_a_shell(self):
        for tool_id, extra in (
            ("quest_app_hevc", ["--mode", "quest_app"]),
            ("batch_quest3_optimize", ["--mode", "optimize_quest3"]),
            ("batch_video_vr", ["--mode", "batch_video_vr", "--resume"]),
        ):
            command = dashboard.build_launch_command(dashboard.TOOLS_BY_ID[tool_id], r"C:\demo\clips")
            self.assertNotIn("cmd.exe", command)
            self.assertNotIn("/c", command)
            self.assertEqual(self.tail(command), ["-i", r"C:\demo\clips", *extra])

    def test_pipeline_tools_keep_shell_characters_inside_a_single_argument(self):
        """셸을 거치지 않으니 경로에 &가 있어도 그냥 한 인자다."""
        command = dashboard.build_launch_command(dashboard.TOOLS_BY_ID["quest_app_hevc"], r"C:\Tom & Jerry\a&b.mp4")
        self.assertEqual(self.tail(command), ["-i", r"C:\Tom & Jerry\a&b.mp4", "--mode", "quest_app"])

    def test_bat_tools_reject_cmd_special_characters_in_paths(self):
        tool = dashboard.TOOLS_BY_ID["merge_folder_videos"]
        for bad in (r"C:\a&calc.exe", r"C:\a|b", r"C:\a>b", r"C:\a^b", r"C:\%TEMP%", r"C:\a!b", 'C:\\a"b', "C:\\a\nb"):
            with self.assertRaises(ValueError, msg=bad):
                dashboard.build_launch_command(tool, bad)
        resume = dashboard.TOOLS_BY_ID["resume_video_to_vr_pipeline"]
        with self.assertRaises(ValueError):
            dashboard.build_launch_command(resume, r"C:\demo\source.mp4", r"C:\out&calc")

    def test_bat_tools_still_accept_ordinary_windows_paths(self):
        tool = dashboard.TOOLS_BY_ID["merge_folder_videos"]
        for ok in (r"C:\demo\sharp_mp4s", r"C:\Users\나\영상 폴더 (2026)\IZ＊ONE - 'Beware' MV", r"D:\a,b;c=d"):
            self.assertEqual(dashboard.build_launch_command(tool, ok)[-1], ok)

    # ---- /api/run_pipeline ----
    def run_pipeline(self, params):
        launched = []

        class FakeProcess:
            pid = 4242

        def fake_popen(command, **kwargs):
            launched.append((command, kwargs))
            return FakeProcess()

        with tempfile.TemporaryDirectory() as tmp:
            payload = {"input": tmp, **params}
            with mock.patch.object(dashboard.subprocess, "Popen", fake_popen):
                try:
                    result = dashboard.launch_custom_pipeline(payload)
                except ValueError as error:
                    return launched, error, tmp
            return launched, result, tmp

    def test_injection_in_mode_is_rejected_and_nothing_is_launched(self):
        launched, error, _ = self.run_pipeline({"mode": "quest_app&calc.exe&rem"})
        self.assertIsInstance(error, ValueError)
        self.assertEqual(launched, [])

    def test_every_enum_field_rejects_values_outside_the_allow_list(self):
        for field in ("mode", "preset", "meuralOrientation", "trajectory", "ytFormat"):
            for bad in ("x&calc.exe", "a b", "auto|calc", "../x", "%TEMP%"):
                launched, error, _ = self.run_pipeline({field: bad})
                self.assertIsInstance(error, ValueError, f"{field}={bad}")
                self.assertEqual(launched, [], f"{field}={bad}")

    def test_numeric_fields_reject_injection_and_out_of_range_values(self):
        cases = {
            "fps": ["30&calc", "-5", "0.1&", "1e999", "nan", True],
            "duration": ["4&calc", "0", "99999"],
            "ipd": ["0.064&calc", "5"],
            "renderWorkers": ["2&calc", "1000", "1.5"],
            "plyBatchSize": ["10&calc", "-3"],
            "startSeconds": ["1&calc"],
            "maxFrames": ["5&calc"],
        }
        for field, values in cases.items():
            for bad in values:
                try:
                    launched, error, _ = self.run_pipeline({field: bad})
                except (ValueError, TypeError):
                    continue  # float()/int()에서 바로 거절된 경우도 실행되지 않은 것이다
                self.assertIsInstance(error, ValueError, f"{field}={bad!r}")
                self.assertEqual(launched, [], f"{field}={bad!r}")

    def test_normal_dashboard_request_is_assembled_as_an_argument_list(self):
        launched, result, tmp = self.run_pipeline({
            "mode": "video_vr", "preset": "default", "meuralOrientation": "auto", "fps": 30.0,
            "trajectory": "rotate_forward", "duration": 4.0, "renderWorkers": 2, "plyBatchSize": 1000,
            "ytFormat": "none", "resume": True, "cleanPly": False, "renderDepth": True, "output": "",
        })
        self.assertEqual(len(launched), 1)
        command, kwargs = launched[0]
        self.assertIsInstance(command, list)
        self.assertEqual(self.tail(command), [
            "-i", tmp, "--mode", "video_vr", "--fps", "30", "--trajectory", "rotate_forward", "--duration", "4",
            "--render-workers", "2", "--ply-batch-size", "1000", "--resume", "--render-depth",
        ])
        self.assertEqual(kwargs["cwd"], dashboard.PROJECT_ROOT)
        self.assertEqual(kwargs["creationflags"], getattr(dashboard.subprocess, "CREATE_NEW_CONSOLE", 0))
        self.assertEqual(result["pid"], 4242)

    def test_quest_app_mode_from_the_dashboard_is_allowed(self):
        launched, _, tmp = self.run_pipeline({"mode": "quest_app"})
        self.assertEqual(self.tail(launched[0][0]), ["-i", tmp, "--mode", "quest_app"])

    def test_sbs_image_mode_and_video_codec_from_dashboard_are_allowed(self):
        launched, _, tmp = self.run_pipeline({"mode": "sbs_image", "ipd": 0.068, "videoCodec": "quest3_hevc"})
        self.assertEqual(
            self.tail(launched[0][0]),
            ["-i", tmp, "--mode", "sbs_image", "--ipd", "0.068", "--video-codec", "quest3_hevc"],
        )
        launched_bad, bad_res, _ = self.run_pipeline({"mode": "video_vr", "videoCodec": "invalid_codec"})
        self.assertIsInstance(bad_res, ValueError)
        self.assertEqual(launched_bad, [])

    def test_dashboard_html_offers_sbs_image_and_quest3_hevc_options(self):
        html = dashboard.DASHBOARD_HTML.read_text(encoding="utf-8")
        self.assertIn('data-mode="sbs_image"', html)
        self.assertIn('id="paramVideoCodec"', html)
        self.assertIn('id="paramIpd"', html)

    def test_allowed_values_match_the_pipeline_cli(self):
        from scripts import sharp_pipeline

        parser_choices = {}
        old = sys.argv
        try:
            sys.argv = ["sharp_pipeline.py", "-i", "x"]
            import argparse

            real = argparse.ArgumentParser.add_argument

            def spy(self, *args, **kwargs):
                if "choices" in kwargs:
                    parser_choices[args[-1] if args[-1].startswith("--") else args[0]] = set(kwargs["choices"])
                return real(self, *args, **kwargs)

            with mock.patch.object(argparse.ArgumentParser, "add_argument", spy):
                sharp_pipeline.parse_arguments()
        finally:
            sys.argv = old
        self.assertEqual(parser_choices["--mode"], set(dashboard.ALLOWED_MODES))
        self.assertEqual(parser_choices["--preset"], set(dashboard.ALLOWED_PRESETS))
        self.assertEqual(parser_choices["--meural-orientation"], set(dashboard.ALLOWED_MEURAL_ORIENTATIONS))
        self.assertEqual(parser_choices["--trajectory"], set(dashboard.ALLOWED_TRAJECTORIES))
        self.assertEqual(parser_choices["--yt-format"], set(dashboard.ALLOWED_YT_FORMATS))
        self.assertEqual(parser_choices["--video-codec"], set(dashboard.ALLOWED_VIDEO_CODECS))

    def test_run_and_pause_runs_the_script_without_a_shell_and_pauses(self):
        from scripts import run_and_pause

        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "probe.py"
            marker = Path(tmp) / "got.txt"
            script.write_text(f"import sys, pathlib\npathlib.Path(r'{marker}').write_text(repr(sys.argv[1:]), encoding='utf-8')\nsys.exit(3)\n", encoding="utf-8")
            paused = []
            with mock.patch.object(run_and_pause, "pause", lambda: paused.append(True)):
                code = run_and_pause.main([str(script), "a&calc.exe", "b|c", "%TEMP%"])
            self.assertEqual(code, 3)
            self.assertEqual(paused, [True])
            self.assertEqual(marker.read_text(encoding="utf-8"), repr(["a&calc.exe", "b|c", "%TEMP%"]))  # 특수문자가 그대로 인자로 간다

    # ---- Host / Origin / Content-Type ----
    HOSTS = dashboard.LOOPBACK_HOSTS
    PORT = 52345

    def check(self, method="POST", **headers):
        base = {"Host": f"127.0.0.1:{self.PORT}", "Content-Type": "application/json"}
        base.update({k.replace("_", "-"): v for k, v in headers.items()})
        base = {k: v for k, v in base.items() if v is not None}
        return dashboard.check_request(method, base, self.HOSTS, self.PORT)

    def test_same_origin_requests_pass(self):
        self.assertIsNone(self.check())
        self.assertIsNone(self.check(Origin=f"http://127.0.0.1:{self.PORT}"))
        self.assertIsNone(self.check(Origin=f"http://localhost:{self.PORT}", Host=f"localhost:{self.PORT}"))
        self.assertIsNone(self.check(Origin=f"http://[::1]:{self.PORT}", Host=f"[::1]:{self.PORT}"))
        self.assertIsNone(self.check(Sec_Fetch_Site="same-origin"))
        self.assertIsNone(self.check(method="GET", Content_Type=None))

    def test_other_origins_are_rejected_with_403(self):
        for origin in ("https://evil.example", "http://evil.example", "null", f"http://127.0.0.1.evil.example:{self.PORT}",
                       f"http://127.0.0.1:{self.PORT + 1}", f"https://127.0.0.1:{self.PORT}", "http://localhost.evil.example"):
            self.assertEqual(self.check(Origin=origin)[0], 403, origin)
        self.assertEqual(self.check(Sec_Fetch_Site="cross-site")[0], 403)
        self.assertEqual(self.check(Sec_Fetch_Site="same-site")[0], 403)

    def test_foreign_hosts_are_rejected_to_stop_dns_rebinding(self):
        for host in ("evil.example", f"evil.example:{self.PORT}", f"127.0.0.1.evil.example:{self.PORT}", "192.168.0.5:52345", f"127.0.0.1:{self.PORT + 1}"):
            self.assertEqual(self.check(Host=host)[0], 403, host)
        self.assertEqual(self.check(Host=None)[0], 403)
        self.assertEqual(self.check(method="GET", Host="evil.example")[0], 403)

    def test_a_port_with_junk_after_it_is_rejected(self):
        """Host·Origin의 포트 자리에 숫자가 아닌 것(userinfo 꼴 포함)이 있으면 거절한다."""
        for junk in (f"127.0.0.1:{self.PORT}@evil.com", f"127.0.0.1:{self.PORT}x", f"localhost:{self.PORT}@evil.com",
                     f"[::1]:{self.PORT}@evil.com", f"[::1]evil", f"127.0.0.1:{self.PORT}/", "127.0.0.1:\uff15\uff12\uff13\uff14\uff15"):
            self.assertEqual(self.check(Host=junk)[0], 403, f"Host {junk}")
            self.assertEqual(self.check(Origin=f"http://{junk}")[0], 403, f"Origin {junk}")
        self.assertEqual(self.check(Host=f"evil@127.0.0.1:{self.PORT}")[0], 403)
        self.assertIsNone(self.check(Host=f"127.0.0.1:{self.PORT}"))
        self.assertIsNone(self.check(Host="127.0.0.1"))

    def test_post_requires_application_json(self):
        for content_type in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", None, ""):
            self.assertEqual(self.check(Content_Type=content_type)[0], 415, content_type)
        self.assertIsNone(self.check(Content_Type="application/json; charset=utf-8"))
        self.assertIsNone(self.check(Content_Type="Application/JSON"))

    # ---- 실제 서버로 확인 ----
    @classmethod
    def start_server(cls):
        import threading
        from http.server import ThreadingHTTPServer

        server = ThreadingHTTPServer(("127.0.0.1", 0), dashboard.DashboardHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server

    def request(self, server, path, method="POST", body=None, headers=None):
        import http.client
        import json

        port = server.server_address[1]
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        merged = {"Host": f"127.0.0.1:{port}"}
        if method == "POST":
            merged["Content-Type"] = "application/json"
        merged.update(headers or {})
        merged = {k: v for k, v in merged.items() if v is not None}
        data = json.dumps(body).encode("utf-8") if isinstance(body, dict) else body
        conn.request(method, path, body=data, headers=merged)
        response = conn.getresponse()
        text = response.read().decode("utf-8", "replace")
        conn.close()
        return response.status, text

    def test_head_is_checked_like_get_and_does_not_serve_project_files(self):
        server = self.start_server()
        port = server.server_address[1]
        try:
            # 다른 Host·Origin이면 HEAD도 403(예전에는 Host: evil.example로 HEAD /README.md가 200과 크기를 돌려줬다)
            self.assertEqual(self.request(server, "/README.md", method="HEAD", headers={"Host": "evil.example"})[0], 403)
            self.assertEqual(self.request(server, "/", method="HEAD", headers={"Host": "evil.example"})[0], 403)
            self.assertEqual(self.request(server, "/", method="HEAD", headers={"Origin": "https://evil.example"})[0], 403)
            self.assertEqual(self.request(server, "/", method="HEAD", headers={"Host": f"127.0.0.1:{port}@evil.com"})[0], 403)
            self.assertEqual(self.request(server, "/", method="HEAD", headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
            # 올바른 Host라도 대시보드 화면 외의 파일은 내보내지 않는다
            for path in ("/README.md", "/scripts/tool_dashboard_server.py", "/.git/config", "/../README.md", "/outputs/"):
                self.assertEqual(self.request(server, path, method="HEAD")[0], 404, path)
            # 대시보드 화면 자체는 HEAD로도 확인할 수 있다(본문 없음)
            status, text = self.request(server, "/", method="HEAD")
            self.assertEqual((status, text), (200, ""))
            self.assertEqual(self.request(server, "/tool_dashboard.html", method="HEAD")[0], 200)
        finally:
            server.shutdown()
            server.server_close()

    def test_live_server_blocks_foreign_requests_and_keeps_the_normal_flow(self):
        server = self.start_server()
        port = server.server_address[1]
        try:
            with tempfile.TemporaryDirectory() as tmp, mock.patch.object(
                dashboard.subprocess, "Popen", side_effect=AssertionError("거절되어야 하는 요청이 실행됐다")
            ):
                injected = {"input": tmp, "mode": "quest_app&calc.exe&rem"}
                # 다른 웹페이지가 단순 요청(text/plain)으로 보낸 경우
                status, _ = self.request(server, "/api/run_pipeline", body=injected, headers={"Content-Type": "text/plain", "Origin": "https://evil.example"})
                self.assertIn(status, (403, 415))
                # Origin이 다르면 Content-Type이 맞아도 403
                status, text = self.request(server, "/api/run_pipeline", body=injected, headers={"Origin": "https://evil.example"})
                self.assertEqual(status, 403)
                # Content-Type이 text/plain이면 415
                status, _ = self.request(server, "/api/run_pipeline", body=injected, headers={"Content-Type": "text/plain"})
                self.assertEqual(status, 415)
                # Host가 다르면(DNS 리바인딩) 403
                status, _ = self.request(server, "/api/run_pipeline", body=injected, headers={"Host": "evil.example"})
                self.assertEqual(status, 403)
                status, _ = self.request(server, "/api/health", method="GET", headers={"Host": "evil.example"})
                self.assertEqual(status, 403)
                # 올바른 출처라도 mode가 허용 목록에 없으면 400이고 실행되지 않는다
                status, text = self.request(server, "/api/run_pipeline", body=injected, headers={"Origin": f"http://127.0.0.1:{port}"})
                self.assertEqual(status, 400)
                self.assertIn("허용되지 않는 mode", text)

            # 정상 흐름: 같은 출처에서 오는 대시보드 버튼 요청
            status, text = self.request(server, "/api/health", method="GET")
            self.assertEqual(status, 200)
            self.assertIn('"ok": true', text)
            status, text = self.request(server, "/api/tools", method="GET", headers={"Origin": f"http://127.0.0.1:{port}"})
            self.assertEqual(status, 200)
            with tempfile.TemporaryDirectory() as tmp:
                status, text = self.request(server, "/api/scan_folder", body={"folder": tmp}, headers={"Origin": f"http://127.0.0.1:{port}"})
                self.assertEqual(status, 200)
                launched = []

                class FakeProcess:
                    pid = 7

                with mock.patch.object(dashboard.subprocess, "Popen", lambda command, **kw: launched.append(command) or FakeProcess()):
                    status, text = self.request(
                        server, "/api/run_pipeline", body={"input": tmp, "mode": "quest_app"}, headers={"Origin": f"http://127.0.0.1:{port}"}
                    )
                self.assertEqual(status, 200)
                self.assertIn('"ok": true', text)
                self.assertEqual(len(launched), 1)
                self.assertEqual(launched[0][3:], ["-i", tmp, "--mode", "quest_app"])
                with mock.patch.object(dashboard.subprocess, "Popen", lambda command, **kw: launched.append(command) or FakeProcess()):
                    status, text = self.request(server, "/api/run", body={"id": "quest_app_hevc", "path": tmp})
                self.assertEqual(status, 200)
                self.assertEqual(launched[1][3:], ["-i", tmp, "--mode", "quest_app"])
        finally:
            server.shutdown()
            server.server_close()

if __name__ == "__main__":
    unittest.main()
