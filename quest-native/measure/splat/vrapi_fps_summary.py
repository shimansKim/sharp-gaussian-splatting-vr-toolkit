"""Quest logcat 기록에서 fps 요약을 낸다(웹·Unity·네이티브 앱 공통 잣대 + 네이티브 실측판 자체 기록).

1) VrApi 줄(시스템, 모든 VR 앱):
   "FPS=72/72,Prd=45ms,Tear=0,Early=0,Stale=3,...,App=10.2ms,GD=0.5ms,CPU&GPU=12.1ms,..."
   - FPS=a/b: 실제 앱 프레임/디스플레이 주사율(1초 단위)
   - Stale: 그 1초 동안 앱 프레임이 늦어 이전 프레임을 재사용한 횟수(높을수록 끊김·떨림)
   - App / CPU&GPU: 앱 GPU 시간·CPU+GPU 시간(펌웨어에 따라 없을 수 있음)
2) QNSPLAT 줄(네이티브 실측판, 태그 QNSplat, splat/frame_log.h 형식):
   "QNSPLAT t=12.0 fps=71.9 hz=72 cpu_ms=4.1 gpu_ms=11.8 lc=3.1 ld=2.6 rc=3.0 rd=2.7 visL=... late=1 ..."
사용: python -I vrapi_fps_summary.py 로그.txt [건너뛸초=5]
"""
import re
import statistics
import sys


def pick(pattern, line):
    m = re.search(pattern, line)
    return float(m.group(1)) if m else None


def summarize_vrapi(lines, skip):
    rows = []
    for line in lines:
        m = re.search(r"FPS=(\d+)/(\d+)", line)
        if not m:
            continue
        rows.append({
            "fps": int(m.group(1)),
            "hz": int(m.group(2)),
            "stale": pick(r"Stale=(\d+)", line),
            "app": pick(r"App=([\d.]+)ms", line),
            "cpugpu": pick(r"CPU&GPU=([\d.]+)ms", line),
        })
    rows = rows[skip:]
    if not rows:
        return False
    fps = [r["fps"] for r in rows]
    hz = statistics.mode(r["hz"] for r in rows)
    print(f"[VrApi] 표본 {len(rows)}초 (앞 {skip}초 제외), 디스플레이 {hz}Hz")
    print(f"  fps 중앙값 {statistics.median(fps)}  평균 {statistics.mean(fps):.1f}  최저 {min(fps)}")
    print(f"  주사율을 지킨 초 비율 {sum(1 for x in fps if x >= hz - 1) / len(fps) * 100:.0f}%")
    for key, label in (("stale", "Stale(초당 재사용 프레임)"), ("app", "App GPU ms"), ("cpugpu", "CPU&GPU ms")):
        vals = [r[key] for r in rows if r[key] is not None]
        if vals:
            print(f"  {label}: 평균 {statistics.mean(vals):.1f}  최대 {max(vals):.1f}")
    return True


def summarize_qnsplat(lines, skip):
    rows = []
    for line in lines:
        i = line.find("QNSPLAT t=")
        if i < 0:
            continue
        kv = dict(tok.split("=", 1) for tok in line[i + 8:].split() if "=" in tok)
        rows.append(kv)
    rows = rows[skip:]
    if not rows:
        return False
    def nums(key):
        out = []
        for r in rows:
            try:
                out.append(float(r[key]))
            except (KeyError, ValueError):
                pass
        return out
    last = rows[-1]
    print(f"[QNSPLAT] 표본 {len(rows)}초 (앞 {skip}초 제외)  label={last.get('label')} splats={last.get('splats')} "
          f"eye={last.get('eye')} scale={last.get('scale')} fov={last.get('fov')} key={last.get('key')} hz={last.get('hz')}")
    fps = nums("fps")
    if fps:
        print(f"  fps 중앙값 {statistics.median(fps):.1f}  평균 {statistics.mean(fps):.1f}  최저 {min(fps):.1f}")
    for key, label in (("gpu_ms", "GPU ms(양 눈)"), ("lc", "왼눈 compute"), ("ld", "왼눈 draw"),
                       ("rc", "오른눈 compute"), ("rd", "오른눈 draw"), ("cpu_ms", "CPU ms"), ("late", "예산 초과 프레임/초")):
        vals = nums(key)
        if vals:
            print(f"  {label}: 평균 {statistics.mean(vals):.2f}  최대 {max(vals):.2f}")
    vis = nums("visL")
    if vis:
        print(f"  왼눈 보이는 splat 평균 {statistics.mean(vis):.0f}")
    return True


def summarize_final(lines):
    rows = [line[line.find("QNSPLAT_SUMMARY "):].strip() for line in lines if "QNSPLAT_SUMMARY " in line]
    for r in rows:
        print("[요약] " + r)
    return bool(rows)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    skip = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    found_v = summarize_vrapi(lines, skip)
    found_q = summarize_qnsplat(lines, skip)
    found_s = summarize_final(lines)
    if not (found_v or found_q or found_s):
        print("VrApi·QNSPLAT 줄이 없습니다. 앱이 VR 화면에 들어간 상태에서 기록했는지 확인하세요.")
        sys.exit(1)


if __name__ == "__main__":
    main()
