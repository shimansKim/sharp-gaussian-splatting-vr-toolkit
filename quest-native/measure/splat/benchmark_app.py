"""Record one native PLY A/B condition without clearing global logcat or deleting device files.

The app must already have the PLY open. This command changes only the explicitly named debug
properties. They persist until cleared and the app restarted; it does not install, launch, stop,
recenter, or change proximity-sensor automation. Obtain the shared-device lease before running.
"""
from __future__ import annotations
import argparse
import csv
import json
import math
import os
from pathlib import Path
import re
import statistics
import subprocess
import time

KNOBS = {'budget', 'scale', 'fov', 'key', 'hz', 'stereo', 'draw', 'half', 'probe', 'minc', 'acut', 'sd2', 'maxpx', 'pose'}


def summarize(text: str) -> dict:
    rows = [dict(re.findall(r'(\w+)=([^\s]+)', line.split('QNSPLAT ', 1)[1]))
            for line in text.splitlines() if 'QNSPLAT t=' in line]
    # -T 1 may include one old line; a one-second window can straddle the start as well.
    rows = rows[2:]
    if not rows:
        raise ValueError('No measured QNSPLAT windows after warm-up; app may not be rendering')
    config_keys = ('splats', 'eye', 'scale', 'fov', 'key', 'stereo', 'draw', 'half', 'probe', 'minc', 'acut', 'sd2', 'maxpx', 'pose', 'sampler')
    config = {k: rows[-1].get(k) for k in config_keys}
    if any(any(r.get(k) != config[k] for k in config_keys) for r in rows):
        raise ValueError('Settings changed inside the measured interval; repeat after settling')
    result = {'one_second_windows': len(rows), 'config': config,
              'note': 'Percentiles below describe one-second window averages, not individual frames.'}
    for k in ('fps', 'gpu_ms', 'lc', 'ld', 'rc', 'rd'):
        values = sorted(float(r[k]) for r in rows)
        result[k] = {'median': statistics.median(values), 'min': min(values), 'max': max(values),
                     'p95': values[min(len(values)-1, math.ceil(len(values)*0.95)-1)]}
    result['valid'] = True
    result['invalid_reasons'] = []
    for eye in ('visL', 'visR'):
        visible = [int(r[eye]) for r in rows if eye in r]
        if visible:
            result[eye + '_range'] = [min(visible), max(visible)]
            if max(visible) - min(visible) > max(100, 0.20 * max(visible)):
                result['valid'] = False
                result['invalid_reasons'].append(eye + ' changed by >20%; viewpoint/culling changed, do not compare FPS')
    result['gpu_over_budget_frames'] = sum(int(r.get('late', 0)) for r in rows)
    vr = [l for l in text.splitlines() if 'VrApi' in l and 'FPS=' in l]
    result['vrapi_lines'] = len(vr)
    result['vrapi_stale_sum'] = sum(int(x) for l in vr for x in re.findall(r',Stale=(\d+)', l))
    temps = [float(x) for l in vr for x in re.findall(r',Temp=([\d.]+)C', l)]
    if temps:
        result['temperature_c_range'] = [min(temps), max(temps)]
    return result


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--serial', required=True)
    p.add_argument('--out', type=Path, required=True, help='New directory for this run (never overwritten)')
    p.add_argument('--seconds', type=float, default=120)
    p.add_argument('--settle', type=float, default=20)
    p.add_argument('--set', action='append', default=[], metavar='KNOB=VALUE')
    p.add_argument('--capture', action='store_true', help='Save the compositor screenshot after measuring')
    p.add_argument('--adb', default=str(Path(os.environ.get('ANDROID_HOME', Path(os.environ.get('LOCALAPPDATA', ''))/'Android'/'Sdk'))/'platform-tools'/'adb.exe'))
    args = p.parse_args()
    if args.seconds < 6 or args.settle < 2:
        p.error('Use seconds >= 6 and settle >= 2')
    settings = {}
    for item in args.set:
        k, sep, v = item.partition('=')
        if not sep or k not in KNOBS or not re.fullmatch(r'\d+(?:\.\d+)?', v):
            p.error('Invalid --set value: ' + item)
        settings[k] = v
    args.out.mkdir(parents=True, exist_ok=False)
    def adb(*argv: str, binary: bool = False):
        return subprocess.check_output([args.adb, '-s', args.serial, *argv], text=not binary, encoding=None if binary else 'utf-8')
    pid = adb('shell', 'pidof', 'com.sharp.questnative').strip()
    if not pid.isdigit():
        raise RuntimeError('Expected one running native app process')
    before = {k: adb('shell', 'getprop', 'debug.qnsplat.'+k).strip() for k in KNOBS}
    metadata = {'settings_requested': settings, 'properties_before': before,
                'seconds': args.seconds, 'settle_seconds': args.settle, 'pid': pid,
                'started_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'device_build': adb('shell', 'getprop', 'ro.build.fingerprint').strip()}
    (args.out/'run.json').write_text(json.dumps(metadata, indent=2)+'\n', encoding='utf-8')
    if 'pose' in settings:
        adb('shell', 'setprop', 'debug.qnsplat.benchpid', pid)
        # Snapshot the current full-scene fit before a concurrent budget change can replace its bounds.
        # The caller should first open/load the full scene when switching fixed-view modes.
        adb('shell', 'setprop', 'debug.qnsplat.pose', settings['pose'])
        time.sleep(2)
    for k, v in settings.items():
        adb('shell', 'setprop', 'debug.qnsplat.'+k, v)
    time.sleep(args.settle)
    with (args.out/'log.txt').open('wb') as log:
        proc = subprocess.Popen([args.adb, '-s', args.serial, 'logcat', '--pid='+pid, '-v', 'threadtime', '-T', '1',
                                 '-s', 'QNSplat:I', 'VrApi:I'], stdout=log, stderr=subprocess.STDOUT)
        try:
            time.sleep(args.seconds)
            if proc.poll() is not None:
                raise RuntimeError('adb logcat ended early; see log.txt')
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
    if args.capture:
        (args.out/'screen.png').write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    text = (args.out/'log.txt').read_text(encoding='utf-8', errors='replace')
    rows = [dict(re.findall(r'(\w+)=([^\s]+)', line.split('QNSPLAT ', 1)[1]))
            for line in text.splitlines() if 'QNSPLAT t=' in line]
    if rows:
        with (args.out/'windows.csv').open('w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]), extrasaction='raise')
            writer.writeheader()
            writer.writerows(rows)
    result = summarize(text)
    # Budget=0 means all input splats; otherwise the requested cap must not be exceeded.
    if settings.get('budget') and int(settings['budget']) and int(result['config']['splats']) > int(settings['budget']):
        result['valid'] = False
        result['invalid_reasons'].append('Requested budget not applied; loader may still be working')
    for k, v in settings.items():
        if k in result['config'] and k != 'budget' and result['config'][k] is not None:
            if abs(float(result['config'][k]) - float(v)) > 0.011:
                result['valid'] = False
                result['invalid_reasons'].append(f'Requested {k}={v} not applied: {result["config"][k]}')
    (args.out/'summary.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result, indent=2), flush=True)
    return 0 if result['valid'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
