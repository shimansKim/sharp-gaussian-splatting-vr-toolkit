import inspect
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import sharp_pipeline


class SharpPipelineTests(unittest.TestCase):
    def test_frame_assembly_accepts_an_optional_original_audio_source(self):
        parameters = inspect.signature(sharp_pipeline.stage_assemble_video_from_frames).parameters

        self.assertIn("audio_source", parameters)
        self.assertIn("audio_start_seconds", parameters)


class QuestAppHevcTests(unittest.TestCase):
    """--mode quest_app: Quest 앱용 HEVC 변환."""

    def cmd(self, key="nvenc", audio="copy", scale="scale=1:1", quality=24):
        return sharp_pipeline.build_quest_app_encode_cmd("ffmpeg", Path("in.mp4"), Path("out.mp4"), key, audio, scale, quality)

    def test_command_uses_hevc_hvc1_faststart_and_8bit_420(self):
        for key, codec in (("nvenc", "hevc_nvenc"), ("qsv", "hevc_qsv"), ("amf", "hevc_amf"), ("x265", "libx265")):
            cmd = self.cmd(key)
            self.assertEqual(cmd[cmd.index("-c:v") + 1], codec)
            self.assertEqual(cmd[cmd.index("-tag:v") + 1], "hvc1")
            self.assertEqual(cmd[cmd.index("-pix_fmt") + 1], "yuv420p")
            self.assertEqual(cmd[cmd.index("-movflags") + 1], "+faststart")
            self.assertEqual(cmd[-1], "out.mp4")

    def test_quality_is_substituted_for_every_encoder(self):
        for key in sharp_pipeline.HEVC_ENCODERS:
            cmd = self.cmd(key, quality=30)
            self.assertIn("30", cmd)
            self.assertFalse(any("{q}" in part for part in cmd))

    def test_audio_is_copied_or_reencoded_as_aac(self):
        copy = self.cmd(audio="copy")
        self.assertEqual(copy[copy.index("-c:a") + 1], "copy")
        aac = self.cmd(audio="aac")
        self.assertEqual(aac[aac.index("-c:a") + 1], "aac")
        self.assertIn("0:a:0?", copy)  # 소리가 없는 영상도 변환된다

    def test_scale_filter_never_exceeds_the_quest_app_limit(self):
        flt = sharp_pipeline.build_quest_app_scale_filter()
        self.assertIn("min(8192,iw)", flt)
        self.assertIn("min(4096,ih)", flt)
        self.assertIn("force_divisible_by=2", flt)
        self.assertEqual(sharp_pipeline.QUEST_APP_MAX_HEIGHT, 4096)
        self.assertLess(sharp_pipeline.QUEST_APP_MAX_HEIGHT, sharp_pipeline.QUEST3_MAX_HEIGHT)

    def test_auto_picks_the_first_working_hardware_encoder_then_cpu(self):
        tried = []

        def fake(ffmpeg, key, quality=24):
            tried.append(key)
            return key == "amf"

        self.assertEqual(sharp_pipeline.pick_hevc_encoder("ffmpeg", "auto", probe=fake), "amf")
        self.assertEqual(tried, ["nvenc", "qsv", "amf"])
        self.assertEqual(sharp_pipeline.pick_hevc_encoder("ffmpeg", "auto", probe=lambda *a, **k: False), "x265")

    def test_requested_encoder_falls_back_when_it_does_not_work(self):
        self.assertEqual(sharp_pipeline.pick_hevc_encoder("ffmpeg", "qsv", probe=lambda f, k, q=24: k == "qsv"), "qsv")
        self.assertEqual(sharp_pipeline.pick_hevc_encoder("ffmpeg", "nvenc", probe=lambda f, k, q=24: k == "amf"), "amf")
        self.assertEqual(sharp_pipeline.pick_hevc_encoder("ffmpeg", "x265", probe=lambda *a, **k: False), "x265")

    def test_cpu_encoder_is_never_probed(self):
        def boom(*args, **kwargs):
            raise AssertionError("x265 must not be probed")

        self.assertEqual(sharp_pipeline.pick_hevc_encoder("ffmpeg", "x265", probe=boom), "x265")

    def test_unique_output_path_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "a_quest_hevc.mp4"
            self.assertEqual(sharp_pipeline.unique_output_path(first), first)
            first.write_bytes(b"x")
            second = sharp_pipeline.unique_output_path(first)
            self.assertEqual(second.name, "a_quest_hevc_2.mp4")
            second.write_bytes(b"x")
            self.assertEqual(sharp_pipeline.unique_output_path(first).name, "a_quest_hevc_3.mp4")

    def test_cli_accepts_the_mode_and_options_and_keeps_existing_defaults(self):
        old = sys.argv
        try:
            sys.argv = ["sharp_pipeline.py", "-i", "x.mp4", "--mode", "quest_app", "--hevc-encoder", "x265", "--hevc-quality", "20"]
            args = sharp_pipeline.parse_arguments()
            self.assertEqual((args.mode, args.hevc_encoder, args.hevc_quality), ("quest_app", "x265", 20))
            sys.argv = ["sharp_pipeline.py", "-i", "x.mp4", "--mode", "optimize_quest3"]
            args = sharp_pipeline.parse_arguments()
            self.assertEqual((args.max_width, args.max_height), (8192, 4320))  # 기존 quest3_8k 설정은 그대로
        finally:
            sys.argv = old

    def test_quest_app_mode_runs_without_the_sharp_cli_and_makes_no_run_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "clip.mp4"
            video.write_bytes(b"x")
            calls = []
            fake_stage = lambda path, **kwargs: calls.append((path, kwargs)) or Path(tmp) / "clip_quest_hevc.mp4"
            sys_argv = sys.argv
            try:
                sys.argv = ["sharp_pipeline.py", "-i", str(video), "--mode", "quest_app"]
                args = sharp_pipeline.parse_arguments()
                with mock.patch.object(sharp_pipeline, "stage_optimize_for_quest_app", fake_stage), mock.patch.object(
                    sharp_pipeline, "get_sharp_cli", side_effect=AssertionError("SHARP CLI는 필요 없다")
                ):
                    sharp_pipeline.run_master_pipeline(args)
            finally:
                sys.argv = sys_argv
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], video.resolve())
            self.assertEqual(calls[0][1]["max_h"], sharp_pipeline.QUEST3_MAX_HEIGHT)  # 인자는 그대로 넘기고 단계에서 4096으로 줄인다
            self.assertFalse((Path(tmp) / "outputs").exists())

    def test_stage_clamps_the_requested_limits_to_the_app_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "clip.mp4"
            video.write_bytes(b"x")
            seen = {}

            def fake_run(cmd, cwd=None, check=True):
                seen["cmd"] = cmd
                Path(cmd[-1]).write_bytes(b"hevc")
                return 0

            with mock.patch.object(sharp_pipeline, "get_ffmpeg_exe", return_value="ffmpeg"), mock.patch.object(
                sharp_pipeline, "get_media_dimensions", return_value=(10240, 5120)
            ), mock.patch.object(sharp_pipeline, "get_video_fps", return_value=120.0), mock.patch.object(
                sharp_pipeline, "get_video_bitrate", return_value=None
            ), mock.patch.object(sharp_pipeline, "pick_hevc_encoder", return_value="x265"), mock.patch.object(
                sharp_pipeline, "run_cmd", fake_run
            ):
                out = sharp_pipeline.stage_optimize_for_quest_app(video, max_w=16384, max_h=8192)
            self.assertEqual(out.name, "clip_quest_hevc.mp4")
            vf = seen["cmd"][seen["cmd"].index("-vf") + 1]
            self.assertIn("min(8192,iw)", vf)
            self.assertIn("min(4096,ih)", vf)
            self.assertTrue(vf.endswith(",fps=60"))

    def test_stage_falls_back_to_cpu_and_aac_when_hardware_encoding_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "clip.mp4"
            video.write_bytes(b"x")
            attempts = []

            def fake_run(cmd, cwd=None, check=True):
                codec = cmd[cmd.index("-c:v") + 1]
                audio = cmd[cmd.index("-c:a") + 1]
                attempts.append((codec, audio))
                if codec == "hevc_nvenc":
                    return 1
                Path(cmd[-1]).write_bytes(b"hevc")
                return 0

            with mock.patch.object(sharp_pipeline, "get_ffmpeg_exe", return_value="ffmpeg"), mock.patch.object(
                sharp_pipeline, "get_media_dimensions", return_value=(3840, 1080)
            ), mock.patch.object(sharp_pipeline, "get_video_fps", return_value=30.0), mock.patch.object(
                sharp_pipeline, "get_video_bitrate", return_value=None
            ), mock.patch.object(sharp_pipeline, "pick_hevc_encoder", return_value="nvenc"), mock.patch.object(
                sharp_pipeline, "run_cmd", fake_run
            ):
                out = sharp_pipeline.stage_optimize_for_quest_app(video)
            self.assertEqual(attempts, [("hevc_nvenc", "copy"), ("hevc_nvenc", "aac"), ("libx265", "aac")])
            self.assertTrue(out.is_file())

    def test_choose_audio_keeps_only_codecs_quest_browser_plays(self):
        choose = sharp_pipeline.choose_quest_app_audio
        self.assertEqual(choose("aac"), "copy")
        self.assertEqual(choose("mp3"), "copy")
        self.assertEqual(choose(None), "copy")  # 소리 없는 입력은 그대로 변환된다
        for codec in ("ac3", "eac3", "dts", "truehd", "pcm_s16le", "opus", "flac"):
            self.assertEqual(choose(codec), "aac", codec)

    def test_probe_audio_codec_reads_the_first_audio_stream_name(self):
        def fake_run(cmd, **kw):
            return mock.Mock(returncode=0, stdout="ac3\n")

        with mock.patch.object(sharp_pipeline.subprocess, "run", fake_run):
            self.assertEqual(sharp_pipeline.probe_audio_codec(Path("in.mp4")), "ac3")
        with mock.patch.object(sharp_pipeline.subprocess, "run", lambda cmd, **kw: mock.Mock(returncode=0, stdout="")):
            self.assertIsNone(sharp_pipeline.probe_audio_codec(Path("in.mp4")))
        with mock.patch.object(sharp_pipeline.subprocess, "run", lambda cmd, **kw: mock.Mock(returncode=1, stdout="")):
            self.assertIsNone(sharp_pipeline.probe_audio_codec(Path("in.mp4")))

        def missing(cmd, **kw):
            raise FileNotFoundError("ffprobe")

        with mock.patch.object(sharp_pipeline.subprocess, "run", missing):
            self.assertIsNone(sharp_pipeline.probe_audio_codec(Path("in.mp4")))

    def run_stage_with_audio(self, audio_codec, encoder="x265"):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "clip.mp4"
            video.write_bytes(b"x")
            attempts = []

            def fake_run(cmd, cwd=None, check=True):
                attempts.append(cmd[cmd.index("-c:a") + 1])
                Path(cmd[-1]).write_bytes(b"hevc")
                return 0

            with mock.patch.object(sharp_pipeline, "get_ffmpeg_exe", return_value="ffmpeg"), mock.patch.object(
                sharp_pipeline, "get_media_dimensions", return_value=(3840, 1080)
            ), mock.patch.object(sharp_pipeline, "get_video_fps", return_value=30.0), mock.patch.object(
                sharp_pipeline, "get_video_bitrate", return_value=None
            ), mock.patch.object(sharp_pipeline, "pick_hevc_encoder", return_value=encoder), mock.patch.object(
                sharp_pipeline, "probe_audio_codec", return_value=audio_codec
            ), mock.patch.object(sharp_pipeline, "run_cmd", fake_run):
                sharp_pipeline.stage_optimize_for_quest_app(video)
            return attempts

    def test_stage_reencodes_non_aac_audio_instead_of_copying_it(self):
        # AC-3 같은 소리를 그대로 복사하면 Quest 앱에서 영상은 나와도 소리가 안 난다.
        self.assertEqual(self.run_stage_with_audio("ac3"), ["aac"])
        self.assertEqual(self.run_stage_with_audio("dts"), ["aac"])

    def test_stage_copies_aac_audio_and_tolerates_no_audio(self):
        self.assertEqual(self.run_stage_with_audio("aac"), ["copy"])
        self.assertEqual(self.run_stage_with_audio(None), ["copy"])

    def test_stage_raises_and_removes_partial_output_when_everything_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "clip.mp4"
            video.write_bytes(b"x")

            def fake_run(cmd, cwd=None, check=True):
                Path(cmd[-1]).write_bytes(b"partial")
                return 1

            with mock.patch.object(sharp_pipeline, "get_ffmpeg_exe", return_value="ffmpeg"), mock.patch.object(
                sharp_pipeline, "get_media_dimensions", return_value=(1920, 1080)
            ), mock.patch.object(sharp_pipeline, "get_video_fps", return_value=30.0), mock.patch.object(
                sharp_pipeline, "pick_hevc_encoder", return_value="x265"
            ), mock.patch.object(sharp_pipeline, "run_cmd", fake_run):
                with self.assertRaises(RuntimeError):
                    sharp_pipeline.stage_optimize_for_quest_app(video)
            self.assertFalse((Path(tmp) / "clip_quest_hevc.mp4").exists())

    def test_batch_skips_already_converted_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in ("a.mp4", "a_quest_hevc.mp4", "b_quest3_8k_3D_FSBS.mp4"):
                (Path(tmp) / name).write_bytes(b"x")
            seen = []
            args = sharp_pipeline.argparse.Namespace(max_width=8192, max_height=4320, hevc_quality=24, hevc_encoder="x265")
            with mock.patch.object(sharp_pipeline, "stage_optimize_for_quest_app", lambda path, **kw: seen.append(path.name) or path):
                sharp_pipeline.stage_batch_process_videos(Path(tmp), "quest_app", args, Path(tmp))
            self.assertEqual(seen, ["a.mp4"])

    def test_quest3_preset_is_documented_as_for_pc_streaming_players(self):
        doc = sharp_pipeline.stage_optimize_for_quest3.__doc__
        self.assertIn("4XVR", doc)
        self.assertIn("quest_app", doc)

if __name__ == "__main__":
    unittest.main()
