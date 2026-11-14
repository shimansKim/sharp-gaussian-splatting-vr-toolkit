"""Keep the shared agent skills and Claude copies byte-for-byte identical."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SkillMirrorTests(unittest.TestCase):
    def test_skill_files_match(self):
        source = ROOT / ".agents" / "skills"
        mirror = ROOT / ".claude" / "skills"
        self.assertTrue(source.is_dir())
        self.assertTrue(mirror.is_dir())
        source_dirs = {p.name for p in source.iterdir() if p.is_dir()}
        mirror_dirs = {p.name for p in mirror.iterdir() if p.is_dir()}
        self.assertTrue(source_dirs, "No skills found")
        self.assertEqual(source_dirs, mirror_dirs)
        source_files = {p.relative_to(source) for p in source.rglob("*") if p.is_file()}
        mirror_files = {p.relative_to(mirror) for p in mirror.rglob("*") if p.is_file()}
        self.assertEqual(source_files, mirror_files)
        for name in sorted(source_dirs):
            with self.subTest(skill=name):
                self.assertIn(Path(name) / "SKILL.md", source_files)
        for path in sorted(source_files & mirror_files):
            with self.subTest(path=str(path)):
                self.assertEqual((source / path).read_bytes(), (mirror / path).read_bytes())


if __name__ == "__main__":
    unittest.main()
