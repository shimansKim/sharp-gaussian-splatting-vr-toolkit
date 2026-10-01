import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from scripts import video_to_vr_pipeline as pipeline


class VideoToVrPipelineTests(unittest.TestCase):
    def write_frame(self, directory: Path, frame_number: int) -> None:
        Image.new("RGB", (2, 2), color="black").save(
            directory / f"frame_{frame_number:06d}.png"
        )

    def test_find_resume_frame_returns_first_missing_or_invalid_frame(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            frames_dir = Path(temp_dir)
            self.write_frame(frames_dir, 1)
            self.write_frame(frames_dir, 2)
            (frames_dir / "frame_000003.png").write_bytes(b"incomplete")
            self.write_frame(frames_dir, 4)

            self.assertEqual(pipeline.find_resume_frame(frames_dir), 3)

    def test_stereo_frame_path_preserves_source_frame_order(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            frame_path = pipeline.stereo_frame_path(Path(temp_dir), 15258)

            self.assertEqual(frame_path.name, "015258_frame_015258.sbs.png")

    def test_complete_ply_rejects_interrupted_write(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            ply_path = Path(temp_dir) / "frame_000001.ply"
            ply_path.write_bytes(b"ply\n")

            self.assertFalse(pipeline.is_complete_ply(ply_path))

    def test_parse_args_accepts_parallel_stereo_worker_count(self):
        with patch(
            "sys.argv",
            ["video_to_vr_pipeline.py", "-i", "source.mp4", "--resume", "--render-workers", "4"],
        ):
            args = pipeline.parse_args()

        self.assertEqual(args.render_workers, 4)

    def test_batch_paths_keeps_frame_order_and_limit(self):
        frame_paths = [Path(f"frame_{number:06d}.png") for number in range(1, 6)]

        batches = list(pipeline.batch_paths(frame_paths, 2))

        self.assertEqual(
            batches,
            [frame_paths[0:2], frame_paths[2:4], frame_paths[4:5]],
        )


if __name__ == "__main__":
    unittest.main()
