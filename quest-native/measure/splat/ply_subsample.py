"""SHARP PLY(binary_little_endian, float vertex 속성)에서 splat을 골라 작은 PLY를 만든다.

렌더러별 Quest 3 fps를 splat 수 단계(예: 1.18M / 600k / 400k / 200k)로 재기 위한 표본 생성기.
- 원본 헤더의 vertex 이외 요소(extrinsic 등)는 그대로 둔다.
- 고르는 방법: opacity(시그모이드 전) 상위 N개 = 기여가 큰 splat 우선. --random이면 균등 무작위.
사용: python -I ply_subsample.py 입력.ply 출력.ply 400000 [--random]
"""
import sys
import numpy as np


def read_header(f):
    lines = []
    while True:
        line = f.readline()
        if not line:
            raise ValueError("end_header 없음")
        lines.append(line)
        if line.strip() == b"end_header":
            return lines


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 3:
        print(__doc__)
        sys.exit(2)
    src, dst, n = args[0], args[1], int(args[2])
    use_random = "--random" in sys.argv
    with open(src, "rb") as f:
        header = read_header(f)
        body = f.read()

    # vertex 요소의 개수와 float 속성 목록
    count, props, in_vertex, vertex_line = 0, [], False, -1
    for i, line in enumerate(header):
        t = line.decode("ascii", "replace").split()
        if t[:2] == ["element", "vertex"]:
            count, in_vertex, vertex_line = int(t[2]), True, i
        elif t and t[0] == "element":
            in_vertex = False
        elif in_vertex and t[:2] == ["property", "float"]:
            props.append(t[2])
        elif in_vertex and t and t[0] == "property":
            raise ValueError("vertex에 float 이외 속성이 있음: " + line.decode())
    stride = 4 * len(props)
    verts = np.frombuffer(body[: count * stride], dtype="<f4").reshape(count, len(props))
    rest = body[count * stride:]

    n = min(n, count)
    if use_random:
        idx = np.sort(np.random.default_rng(0).choice(count, n, replace=False))
    else:
        op = verts[:, props.index("opacity")]
        idx = np.sort(np.argpartition(-op, n - 1)[:n])
    out = verts[idx]

    header[vertex_line] = f"element vertex {n}\n".encode("ascii")
    with open(dst, "wb") as f:
        f.writelines(header)
        f.write(out.astype("<f4").tobytes())
        f.write(rest)
    print(f"{src} -> {dst}: {count} -> {n} splats ({'random' if use_random else 'top opacity'})")


if __name__ == "__main__":
    main()
