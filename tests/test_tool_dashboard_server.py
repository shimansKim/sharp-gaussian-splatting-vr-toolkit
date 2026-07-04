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

    def test_optional_file_tools_accept_a_path(self):
        tool = dashboard.TOOLS_BY_ID["render_stereo_video"]

        command = dashboard.build_launch_command(tool, r"C:\demo\scene.ply")

        self.assertEqual(command[-1], r"C:\demo\scene.ply")

    def test_tool_catalog_exposes_safe_input_modes(self):
        modes = {tool.id: tool.input_mode for tool in dashboard.TOOLS}

        self.assertEqual(modes["setup_environment"], "none")
        self.assertEqual(modes["run_predict"], "none")
        self.assertEqual(modes["run_predict_drag_image_here"], "file_or_folder_required")
        self.assertEqual(modes["video_to_vr_pipeline"], "file_required")
        self.assertEqual(modes["video_to_vr_pipeline_test_5frames"], "file_optional")


if __name__ == "__main__":
    unittest.main()
