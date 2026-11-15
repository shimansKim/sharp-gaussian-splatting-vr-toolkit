"""Structural checks for the viewer's asynchronous layout-policy wiring.

The pure C++ tests exercise the policy; these checks cover its call sites without Android/OpenXR.
"""
from pathlib import Path
import unittest

SOURCE = (Path(__file__).resolve().parent.parent / "image_viewer.cpp").read_text(encoding="utf-8")


def section(start, end):
    return SOURCE.split(start, 1)[1].split(end, 1)[0]


class ViewerLayoutWiring(unittest.TestCase):
    def test_hud_lock_and_probe_guard(self):
        hud = section('bool DescribeHud(', 'void OnHudAction(')
        self.assertIn('lock.id = "layoutLock"', hud)
        self.assertIn('lock.enabled = cur_.probed', hud)
        self.assertIn('lock.row = 0', hud)
        action = section('void OnHudAction(', '// ------------------------------------------------------------------ ViewerApi')
        self.assertIn('if (!cur_.probed) return;', action)
        self.assertIn('ApplyResolvedLayout();', action)

    def test_probe_sniff_and_draw_use_current_policy(self):
        probe = section('void OnProbed(', 'void OnDecoded(')
        self.assertIn('ApplyResolvedLayout();', probe)
        decoded = section('void OnDecoded(', 'void OnDrawn(')
        self.assertIn('token == cur_.token && !cur_.sniffed', decoded)
        self.assertIn('(layoutLock_.Locked() || !cur_.layoutFromUser)', decoded)
        self.assertIn('pendingCrop_.w == cur_.srcW && pendingCrop_.h == cur_.srcH', decoded)
        self.assertIn('cur_.detection = refined;', decoded)
        self.assertIn('ApplyResolvedLayout();', decoded)
        drawn = section('void OnDrawn(', 'private:')
        self.assertIn('shownPic_.layout = cur_.layout;', drawn)
        resolve = section('void ApplyResolvedLayout()', 'bool shownValid()')
        self.assertIn('layoutLock_.Resolve(', resolve)

    def test_memory_is_not_overwritten_by_locked_choices(self):
        select = section('void SetLayout(Layout layout)', 'void CycleLayoutBy(')
        self.assertIn('if (layoutLock_.Locked())', select)
        self.assertIn('layoutLock_.Set(layout);', select)
        self.assertIn('} else {\n            layoutMemory_.Remember(', select)
        self.assertIn('GetPref("layout.lock")', SOURCE)
        self.assertIn('PutPref("layout.lock"', SOURCE)


if __name__ == '__main__':
    unittest.main()
