"""Keep the shared agent skills and Claude copies byte-for-byte identical."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ("sharp-worktree-pr", "sharp-quest-native-verify")


class SkillMirrorTests(unittest.TestCase):
    def test_skill_files_match(self):
        for name in SKILLS:
            with self.subTest(skill=name):
                source = ROOT / ".agents" / "skills" / name
                mirror = ROOT / ".claude" / "skills" / name
                self.assertTrue((source / "SKILL.md").is_file())
                self.assertTrue((mirror / "SKILL.md").is_file())
                source_files = {p.relative_to(source) for p in source.rglob("*") if p.is_file()}
                mirror_files = {p.relative_to(mirror) for p in mirror.rglob("*") if p.is_file()}
                self.assertEqual(source_files, mirror_files)
                for path in sorted(source_files & mirror_files):
                    with self.subTest(path=str(path)):
                        self.assertEqual((source / path).read_bytes(), (mirror / path).read_bytes())


if __name__ == "__main__":
    unittest.main()
