import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("line_endings", Path(__file__).resolve().parents[1] / "scripts/check_line_endings.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class LineEndingTests(unittest.TestCase):
    def test_styles(self):
        for data, expected in [(b'a\nb\n', 'LF'), (b'a\r\nb\r\n', 'CRLF'),
                               (b'a\r\nb\n', 'mixed'), (b'a', 'none'), (b'a\0\n', 'binary')]:
            with self.subTest(expected=expected):
                self.assertEqual(checker.style(data), expected)

    def test_git_comparison(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def git(*args):
                return subprocess.check_output(['git', '-C', tmp, *args], stderr=subprocess.DEVNULL).strip().decode()
            git('init', '-q')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'user.name', 'Test')
            git('config', 'core.autocrlf', 'false')
            original = {'changed.txt': b'a\r\nb\r\n', 'mixed.txt': b'a\nb\n',
                        'unchanged.txt': b'a\n', 'deleted.txt': b'a\n', 'binary.bin': b'\0\r\n'}
            for name, content in original.items():
                (root / name).write_bytes(content)
            git('add', '.')
            git('commit', '-qm', 'base')
            base = git('rev-parse', 'HEAD')
            (root / 'changed.txt').write_bytes(b'a\nb\n')
            (root / 'mixed.txt').write_bytes(b'a\r\nb\n')
            (root / 'unchanged.txt').write_bytes(b'c\n')
            (root / 'deleted.txt').unlink()
            (root / 'new.txt').write_bytes(b'a\r\nb\n')
            (root / 'binary.bin').write_bytes(b'\0\n')
            git('add', '-A')
            git('commit', '-qm', 'head')
            previous = os.getcwd()
            try:
                os.chdir(tmp)
                self.assertEqual(checker.violations(base, 'HEAD'), [
                    ('changed.txt', 'CRLF', 'LF'), ('mixed.txt', 'LF', 'mixed')])
            finally:
                os.chdir(previous)


if __name__ == '__main__':
    unittest.main()
