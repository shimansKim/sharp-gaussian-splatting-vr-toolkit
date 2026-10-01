import tempfile
import unittest
from pathlib import Path

try:
    from scripts.concat_folder_videos import build_concat_command, collect_video_paths
except ModuleNotFoundError:
    build_concat_command = None
    collect_video_paths = None


class ConcatFolderVideosTests(unittest.TestCase):
    def test_collect_video_paths_uses_natural_order_and_skips_depth_and_output(self):
        self.assertIsNotNone(collect_video_paths)

        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            for name in (
                "frame_10.mp4",
                "frame_2.mp4",
                "frame_1.mp4",
                "frame_2.depth.mp4",
                "SHARP_merged.mp4",
                "SHARP_merged_20260901-120000.mp4",
                "notes.txt",
            ):
                (folder / name).touch()

            videos = collect_video_paths(folder, folder / "SHARP_merged.mp4")

        self.assertEqual([video.name for video in videos], ["frame_1.mp4", "frame_2.mp4", "frame_10.mp4"])

    def test_build_concat_command_stream_copies_the_selected_videos(self):
        self.assertIsNotNone(build_concat_command)

        command = build_concat_command(Path(r"C:\temp\concat.txt"), Path(r"C:\temp\merged.mp4"))

        self.assertEqual(command[:7], ["ffmpeg", "-hide_banner", "-y", "-f", "concat", "-safe", "0"])
        self.assertIn("-c", command)
        self.assertEqual(command[command.index("-c") + 1], "copy")
        self.assertEqual(command[-1], r"C:\temp\merged.mp4")


if __name__ == "__main__":
    unittest.main()
