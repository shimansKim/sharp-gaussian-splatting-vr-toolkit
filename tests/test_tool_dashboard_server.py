import unittest

from scripts import tool_dashboard_server as dashboard


class ToolDashboardServerTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
