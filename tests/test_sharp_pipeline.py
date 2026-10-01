import inspect
import unittest

from scripts import sharp_pipeline


class SharpPipelineTests(unittest.TestCase):
    def test_frame_assembly_accepts_an_optional_original_audio_source(self):
        parameters = inspect.signature(sharp_pipeline.stage_assemble_video_from_frames).parameters

        self.assertIn("audio_source", parameters)
        self.assertIn("audio_start_seconds", parameters)


if __name__ == "__main__":
    unittest.main()
