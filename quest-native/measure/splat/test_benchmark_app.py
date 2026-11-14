"""Offline parser tests; no adb calls or headset needed."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('benchmark_app', Path(__file__).with_name('benchmark_app.py'))
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


def line(fps=72, scale='0.75', late=0):
    return (f'I QNSplat : QNSPLAT t=1 fps={fps} gpu_ms=11 lc=2 ld=3 rc=3 rd=3 '
            f'splats=400000 eye=1260x1320 scale={scale} fov=0 key=16 stereo=1 draw=3 half=0 probe=0 '
            f'minc=0 acut=4 sd2=4.36 maxpx=2048 late={late} label=scene\n')


class BatchTests(unittest.TestCase):
    def test_control_batches_are_ascii_crlf_and_label_free(self):
        for name in ('step2_app.bat', 'step2_measure.bat'):
            data = Path(__file__).with_name(name).read_bytes()
            text = data.decode('ascii')
            self.assertNotIn('\n', text.replace('\r\n', ''))
            self.assertNotIn('call :', text.lower())
            self.assertFalse(any(line.startswith(':') for line in text.splitlines()))
            self.assertNotIn('rm -f', text)

    def test_for_assignments_are_quoted(self):
        text = Path(__file__).with_name('step2_app.bat').read_text(encoding='ascii')
        self.assertIn('("stereo=1" "draw=3"', text)
        self.assertIn('("%%~P")', text)
        self.assertIn('qnsplat_bench_scene.ply', text)


class ParserTests(unittest.TestCase):
    def test_discards_start_windows(self):
        result = bench.summarize(line(1)+line(2)+line(70, late=3)+line(72, late=2))
        self.assertEqual(result['one_second_windows'], 2)
        self.assertEqual(result['fps']['median'], 71)
        self.assertEqual(result['gpu_over_budget_frames'], 5)

    def test_rejects_mixed_conditions(self):
        with self.assertRaises(ValueError):
            bench.summarize(line()*3 + line(scale='0.6'))

    def test_rejects_visibility_jump(self):
        stable = line().replace('label=scene', 'visL=1170000 visR=1170000 label=scene')
        jump = line().replace('label=scene', 'visL=130000 visR=390000 label=scene')
        result = bench.summarize(stable*3 + jump)
        self.assertFalse(result['valid'])
        self.assertEqual(len(result['invalid_reasons']), 2)

    def test_requires_windows(self):
        with self.assertRaises(ValueError):
            bench.summarize('no render\n')

    def test_compositor_stale_and_temperature(self):
        result = bench.summarize(line()*4 + 'I VrApi : FPS=72/72,Stale=2,Temp=48.0C/0.0C\n')
        self.assertEqual(result['vrapi_stale_sum'], 2)
        self.assertEqual(result['temperature_c_range'], [48, 48])


if __name__ == '__main__':
    unittest.main()
