// 하네스 검증용 짧은 샘플 영상을 ffmpeg로 만든다(저장소에 영상을 두지 않는다. *.mp4는 .gitignore 대상).
// 사용: node dev/make-sample-videos.mjs   →  dev/samples/*.mp4 (https://localhost:5173/dev/media-test.html?src=/dev/samples/<이름>)
// 왼눈은 일반 테스트 화면, 오른눈은 색을 반전해 눈 순서를 눈으로 구별한다. 움직이는 빨간 막대로 프레임 갱신을 확인한다.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'samples');
mkdirSync(out, { recursive: true });

/** [파일 이름, 눈 하나의 가로, 세로, 배치(sbs|tb|mono), 코덱] */
const SAMPLES = [
  ['sample_VR180_SBS.mp4', 1024, 1024, 'sbs', 'h264'],
  ['sample_360_mono.mp4', 2048, 1024, 'mono', 'h264'],
  ['sample_360_TB.mp4', 1024, 512, 'tb', 'h264'],
  ['sample_FSBS.mp4', 960, 540, 'sbs', 'h264'],
  ['sample_HSBS.mp4', 960, 1080, 'sbs', 'h264'],
  ['sample_flat.mp4', 1280, 720, 'mono', 'h264'],
  ['sample_VR180_SBS_vp9.webm', 1024, 1024, 'sbs', 'vp9'],
];

for (const [name, w, h, layout, codec] of SAMPLES) {
  const src = `testsrc2=size=${w}x${h}:rate=30,drawbox=x='mod(t*160,iw)':y=0:w=40:h=40:color=red:t=fill`;
  const filter =
    layout === 'mono'
      ? '[0:v]format=yuv420p[v]'
      : `[0:v]split[a][b];[b]negate[c];${layout === 'sbs' ? '[a][c]hstack' : '[a][c]vstack'}=inputs=2,format=yuv420p[v]`;
  const enc = codec === 'vp9' ? ['-c:v', 'libvpx-vp9', '-b:v', '2M', '-deadline', 'realtime'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart'];
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-t', '8', '-filter_complex', filter, '-map', '[v]', ...enc, join(out, name)];
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  console.log(result.status === 0 ? `만듦: dev/samples/${name}` : `실패: ${name}`);
}
