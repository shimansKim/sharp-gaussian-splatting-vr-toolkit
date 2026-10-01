# SHARP Gaussian Splatting VR Toolkit

Apple SHARP를 Windows에서 실행해 **이미지/영상 -> Gaussian Splatting PLY -> SBS/VR 영상**까지 실험할 수 있게 묶은 로컬 툴킷입니다.

이 프로젝트의 목표는 복잡한 명령어를 몰라도 BAT 파일과 HTML 대시보드만으로 다음 작업을 따라 할 수 있게 만드는 것입니다.

- 이미지 1장 또는 이미지 폴더를 Apple SHARP로 3D Gaussian Splatting `.ply` 생성
- 생성된 `.ply`를 일반 MP4 또는 좌우 SBS 양안 MP4로 렌더링
- 일반 영상을 프레임별 `.ply`로 변환한 뒤 VR SBS 영상으로 조립
- YouTube/Quest 3에서 테스트한 3D/VR180 업로드용 변환 BAT 제공
- Quest 3 브라우저에서 PLY를 확인하는 Spark + Three.js + WebXR 뷰어 제공
- 처음 쓰는 PC를 위한 환경 확인/설치 BAT 제공

## GitHub 배포 정책

이 저장소에는 Apple SHARP 모델 checkpoint, 입력 이미지, 변환 결과물, 가상환경, Node 패키지, 빌드 결과물을 포함하지 않습니다.

- Apple SHARP 코드는 `ml-sharp` 서브모듈로 연결합니다.
- Apple 모델 checkpoint는 첫 실행 시 Apple 경로에서 자동 다운로드되며, 로컬 Torch cache에 저장됩니다.
- 모델 사용 전 `ml-sharp/LICENSE_MODEL`을 확인해야 합니다. Apple 모델은 연구 목적 라이선스입니다.
- 이 프로젝트에서 추가한 SHARP stereo 렌더링 변경분은 `patches/ml-sharp-stereo-render.patch`에 보관합니다.

서브모듈까지 함께 받은 뒤 패치를 적용하려면 다음을 실행합니다.

```powershell
git submodule update --init --recursive
git -C ml-sharp apply ..\patches\ml-sharp-stereo-render.patch
```

## 다운로드

GitHub에서 받을 때는 서브모듈까지 함께 받는 것을 권장합니다.

```powershell
git clone --recurse-submodules https://github.com/shimansKim/sharp-gaussian-splatting-vr-toolkit.git
cd sharp-gaussian-splatting-vr-toolkit
```

이미 일반 clone을 했다면 다음 명령으로 서브모듈을 받을 수 있습니다.

```powershell
git submodule update --init --recursive
```

## 라이선스 및 주의

- Apple SHARP 코드와 모델은 Apple의 원본 저장소와 모델 라이선스를 따릅니다.
- `ml-sharp/LICENSE_MODEL`을 반드시 확인하세요. Apple SHARP 모델은 연구 목적 라이선스입니다.
- 이 프로젝트는 Windows 실행 자동화, WebXR 실험 뷰어, YouTube/VR 변환 파이프라인을 묶은 래퍼 툴킷입니다.
- 상업적 사용, 재배포, 모델 포함 배포 전에는 Apple SHARP와 Google Spatial Media 등 upstream 라이선스를 별도로 확인하세요.

## 빠른 시작

처음 받았다면 아래 순서대로 실행하세요.

```text
1. run_setup_environment.bat
2. run_tool_dashboard.bat
3. 대시보드에서 원하는 작업 실행
```

가장 단순한 이미지 변환 흐름은 다음과 같습니다.

```text
inputs 폴더에 이미지 넣기
-> run_predict.bat 실행
-> outputs 폴더에서 .ply 확인
-> run_webxr_demo.bat 또는 render_stereo_video.bat 실행
```

영상에서 VR SBS 영상을 만들려면 영상 파일을 `video_to_vr_pipeline.bat` 위에 드래그합니다. 먼저 `video_to_vr_pipeline_test_5frames.bat`로 5프레임 테스트를 권장합니다.

## 폴더 구조

- `ml-sharp/`: Apple SHARP GitHub 저장소 서브모듈
- `tools/spatial-media/`: YouTube VR 메타데이터 주입용 Google Spatial Media 서브모듈
- `.venv/`: Python 가상환경, GitHub에는 포함하지 않음
- `inputs/`: 변환할 이미지/테스트 영상을 넣는 곳, GitHub에는 포함하지 않음
- `outputs/`: 생성된 `.ply`, 이미지, 영상 결과물이 저장되는 곳, GitHub에는 포함하지 않음
- `scripts/`: PowerShell/Python 실행 스크립트
- `webxr-spark-demo/`: Quest/WebXR PLY 뷰어
- `patches/`: `ml-sharp`에 적용하는 로컬 패치

## 확인된 실행 환경

- GPU: NVIDIA GeForce RTX 4080
- Python: 3.13.11
- PyTorch: 2.8.0+cu128
- CUDA 인식: 정상
- CUDA Toolkit: 12.8, `nvcc` 렌더링 테스트 통과
- Visual Studio 2022 C++ Build Tools: 설치됨
- SHARP CLI: 정상 설치

## 가장 쉬운 사용법

1. 변환하고 싶은 이미지를 아래 폴더에 넣습니다.

```text
inputs
```

2. 아래 BAT 파일을 더블클릭합니다.

```text
run_predict.bat
```

3. 결과는 아래 폴더 안에 시간별 하위 폴더로 생성됩니다.

```text
outputs
```

예를 들어 `outputs\20260507-010000\image.ply` 같은 식으로 저장됩니다.

## BAT 파일 설명

아래 표는 프로젝트 루트에 있는 주요 BAT 파일의 용도입니다.

| BAT 파일 | 입력/실행 방식 | 주요 용도 | 결과/비고 |
| --- | --- | --- | --- |
| `run_pipeline.bat` | 더블클릭 또는 파일/폴더 드래그 | **영상/이미지/PLY 어디서든 원하는 출력까지 처리하는 통합 마스터 파이프라인** | FPS, 카메라 궤적, 렌더링 시간, 이어하기(Resume), YouTube 3D 주입 등 옵션 지원 |
| `run_tool_dashboard.bat` | 더블클릭 | 주요 BAT 도구를 설명과 함께 실행하는 HTML 대시보드 실행 | 파일 선택이 필요한 도구는 Windows 파일 선택창으로 경로를 넘김 |
| `run_setup_environment.bat` | 더블클릭 | 처음 쓰는 PC에서 필요한 환경을 점검하고 프로젝트 의존성을 설치 | Git/Python/Node/ffmpeg 확인, `.venv`, SHARP, WebXR 패키지 준비 |
| `check_env.bat` | 더블클릭 | Python, PyTorch, CUDA, GPU, SHARP CLI 상태 확인 | 문제가 생겼을 때 먼저 실행 |
| `run_predict.bat` | 더블클릭 | `inputs` 폴더의 이미지들을 SHARP로 `.ply` 변환 | `outputs\날짜시간` 폴더에 저장 |
| `run_predict_drag_image_here.bat` | 이미지 파일/폴더 드래그 | 특정 이미지나 이미지 폴더만 `.ply` 변환 | 드래그한 대상 기준으로 처리 |
| `run_predict_render.bat` | 더블클릭 | `.ply` 생성과 SHARP 자체 `.mp4` 렌더링을 함께 실행 | CUDA Toolkit, Visual Studio C++ 환경 필요 |
| `run_predict_render_drag_image_here.bat` | 이미지 파일/폴더 드래그 | 지정 대상만 `.ply` 생성과 SHARP 자체 `.mp4` 렌더링을 함께 실행 | 입력 파일/폴더 기준으로 별도 출력 폴더 생성 |
| `render_ply_video.bat` | `.ply` 파일/폴더 드래그 또는 더블클릭 | 기존 `.ply`를 경로·길이 선택 일반 `.mp4`로 렌더링 | 대시보드에서 파일/폴더, 카메라 경로, PLY당 길이 선택 |
| `render_stereo_video.bat` | `.ply` 파일/폴더 드래그 또는 더블클릭 | 기존 `.ply`를 경로·길이 선택 좌우 SBS `.mp4`로 렌더링 | 기본 IPD `0.064`, 기본 길이 4초 |
| `video_to_vr_pipeline.bat` | 영상 파일 드래그 | 영상 -> 프레임 -> `.ply` -> SBS 프레임 -> VR SBS `.mp4` 전체 파이프라인 | 시간이 오래 걸리고 디스크를 많이 사용 |
| `video_to_vr_pipeline_60fps.bat` | 60fps 영상 파일 드래그 | 전체 영상 -> VR SBS `.mp4` 파이프라인을 60fps로 실행 | 30fps 대비 처리 시간/디스크 사용량이 약 2배 |
| `video_to_vr_pipeline_test_5frames.bat` | 더블클릭 또는 영상 파일 드래그 | 30초 지점부터 5프레임만 빠르게 파이프라인 테스트 | 전체 실행 전 상태 확인용 |
| `make_youtube_3d_fpa.bat` | SBS 3D `.mp4` 파일 드래그 | YouTube/Quest에서 잘 나온 3D 업로드용 MP4 생성 | FPA `frame-packing=3`, SAR `1:2`, DAR `16:9` 적용 |
| `make_youtube_vr180_canvas.bat` | SBS 3D `.mp4` 파일 드래그 | YouTube VR180 스타일 테스트 파일 생성 | 7680x4320 캔버스와 VR180-like 메타데이터 적용 |
| `refresh_splat_list.bat` | 더블클릭 | WebXR/Spark 데모가 볼 `.ply` 목록 갱신 | `webxr-spark-demo\public\splats`와 `manifest.json` 갱신 |
| `run_webxr_demo.bat` | 더블클릭 | 로컬 HTTPS WebXR/Spark 데모 서버 실행 | PC/Quest 브라우저에서 접속 |
| `run_webxr_demo_tunnel.bat` | 더블클릭 | Quest 3 HTTPS 문제 우회용 터널 실행 | 출력되는 HTTPS 주소를 Quest 브라우저에서 사용 |

### `run_tool_dashboard.bat`

프로젝트의 주요 BAT 도구를 브라우저에서 보기 좋게 정리해 보여주는 로컬 HTML 대시보드를 실행합니다.

주요 기능:

- 각 BAT의 용도, 입력 방식, 결과 위치, 주의사항 확인
- 더블클릭형 BAT는 대시보드에서 바로 실행
- 파일/폴더가 필요한 BAT는 Windows 파일 선택창으로 경로를 선택한 뒤 실행
- 영상 -> VR 파이프라인처럼 오래 걸리는 작업은 경고와 함께 표시
- Quest/WebXR 관련 도구와 YouTube 변환 도구를 작업 흐름별로 구분

실행 방법:

```text
run_tool_dashboard.bat
```

브라우저가 열리면 대시보드에서 원하는 작업 카드를 선택하면 됩니다.

### `run_setup_environment.bat`

처음 사용하는 PC에서 프로젝트 실행에 필요한 환경을 순서대로 준비합니다.

진행하는 내용:

- Git, Python, Node.js, ffmpeg, CUDA Toolkit, Visual Studio C++ Build Tools 상태 확인
- `inputs`, `outputs` 폴더 생성
- `ml-sharp`, `tools/spatial-media` 서브모듈 갱신
- SHARP stereo 렌더링 패치 적용
- `.venv` 생성
- PyTorch CUDA 12.8, SHARP requirements, SHARP CLI 설치
- WebXR/Spark 뷰어용 `npm install`
- SHARP CLI와 CUDA 인식 상태 최종 확인

실행 방법:

```text
run_setup_environment.bat
```

주의:

- CUDA Toolkit과 Visual Studio Build Tools는 설치 시간이 오래 걸릴 수 있습니다.
- 일부 설치는 관리자 승인이나 터미널 재시작이 필요할 수 있습니다.
- Apple SHARP 모델 checkpoint는 저장소에 포함하지 않으며, 첫 SHARP 실행 시 자동 다운로드됩니다.

### `check_env.bat`

현재 SHARP 실행 환경을 확인합니다.

확인하는 내용:

- Python 버전
- PyTorch 버전
- CUDA 사용 가능 여부
- 인식된 GPU 이름
- SHARP CLI 실행 가능 여부

문제가 생겼을 때 먼저 이 파일을 실행하면 됩니다.

### `run_predict.bat`

기본 변환 실행 파일입니다.

```text
inputs 폴더의 이미지들
-> SHARP 변환
-> outputs 폴더에 .ply 저장
```

평소에는 이 파일만 쓰면 됩니다.

### `run_predict_drag_image_here.bat`

이미지 파일 또는 이미지 폴더를 이 BAT 파일 위에 드래그해서 실행할 수 있습니다.

사용 예:

- `photo.jpg`를 BAT 위에 드래그
- 이미지 여러 개가 들어있는 폴더를 BAT 위에 드래그

결과는 자동으로 `outputs` 아래에 저장됩니다.

### `run_predict_render.bat`

`.ply` 생성과 함께 SHARP의 렌더 기능도 실행합니다.

주의:

- 렌더 기능은 CUDA GPU를 사용합니다.
- PyTorch가 CUDA를 인식하는 것과 별개로, `gsplat` 렌더링에는 NVIDIA CUDA Toolkit의 `nvcc`가 필요할 수 있습니다.
- 이 프로젝트에서는 `run_predict_render.bat`가 CUDA Toolkit 12.8과 Visual Studio C++ 빌드 환경을 자동으로 잡은 뒤 실행합니다.
- 첫 실행은 `gsplat` CUDA 확장 빌드 때문에 1-3분 정도 더 걸릴 수 있습니다. 한 번 성공하면 이후에는 캐시를 사용합니다.
- 기본 `.ply` 생성만 필요하면 `run_predict.bat`를 쓰는 편이 좋습니다.

### `render_ply_video.bat`

이미 만들어진 `.ply` 파일을 SHARP 자체 렌더러로 `.mp4` 영상으로 바꿉니다.

사용법:

- `.ply` 파일 또는 `.ply` 폴더를 `render_ply_video.bat` 위에 드래그합니다.
- 아무것도 드래그하지 않고 실행하면 `outputs` 폴더에서 가장 최근 `.ply`를 자동으로 골라 렌더링합니다.

대시보드에서는 PLY 파일/폴더 선택, 카메라 경로, PLY당 MP4 길이를 함께 설정할 수 있습니다. 직접 실행 시에는 `render_ply_video.bat "입력경로" swipe 3`처럼 경로와 길이를 뒤에 지정할 수 있습니다.

결과는 `outputs\render_날짜시간` 폴더에 저장됩니다.

### `render_stereo_video.bat`

이미 만들어진 `.ply` 파일을 VR용 좌우 양안 영상으로 렌더링합니다.

기본 출력은 좌안과 우안을 한 프레임 안에 좌우로 붙인 SBS, 즉 Side-by-Side `.mp4`입니다.

사용법:

- `.ply` 파일 또는 `.ply` 폴더를 `render_stereo_video.bat` 위에 드래그합니다.
- 아무것도 드래그하지 않고 실행하면 `outputs` 폴더에서 가장 최근 `.ply`를 자동으로 골라 렌더링합니다.

대시보드에서는 PLY 파일/폴더 선택, 카메라 경로, PLY당 SBS MP4 길이를 함께 설정할 수 있습니다. 직접 실행 시에는 `render_stereo_video.bat "입력경로" rotate 4`처럼 지정할 수 있습니다.

결과는 `outputs\stereo_날짜시간` 폴더에 저장됩니다.

기본 영상 길이는 4초입니다. 카메라는 기존 궤적을 4초 동안 천천히 이동합니다.

기본 IPD는 `0.064`입니다. 이는 64mm 기준이며, 필요하면 PowerShell에서 직접 조절할 수 있습니다.

### `video_to_vr_pipeline.bat`

일반 영상을 VR용 SBS 영상으로 변환하는 실험용 전체 파이프라인입니다.

처리 순서:

```text
입력 영상
-> 30fps 기준 PNG 프레임 추출
-> 각 프레임을 SHARP로 .ply 변환
-> 각 .ply를 좌우 양안 SBS PNG로 렌더
-> SBS PNG 목록을 ffmpeg concat list로 바로 인코딩
-> vr_sbs.mp4 생성
```

사용법:

- 영상 파일을 `video_to_vr_pipeline.bat` 위에 드래그합니다.
- 결과는 `outputs\video_vr_날짜시간` 폴더에 저장됩니다.

생성되는 중간 폴더:

```text
01_frames        원본 영상에서 추출한 PNG 프레임
02_ply           SHARP가 만든 프레임별 .ply
03_stereo_frames 프레임별 좌우 양안 SBS PNG
stereo_frames.ffconcat ffmpeg 인코딩용 프레임 목록
vr_sbs.mp4       최종 VR SBS 영상
```

주의:

- 이 파이프라인은 프레임마다 SHARP 추론을 수행하므로 매우 오래 걸리고 디스크를 많이 사용합니다.
- 30fps 영상 10초는 300장의 이미지, 300개의 `.ply`, 300장의 SBS PNG를 만듭니다.
- `03_stereo_frames` 이미지를 다시 `04_encode_frames`에 복사하지 않고, 목록 파일로 직접 인코딩합니다.
- 먼저 짧은 영상 또는 `--max-frames` 옵션으로 테스트하는 것을 권장합니다.

### `video_to_vr_pipeline_60fps.bat`

`video_to_vr_pipeline.bat`와 같은 전체 파이프라인을 60fps로 실행합니다.

사용법:

- 60fps 영상 파일을 `video_to_vr_pipeline_60fps.bat` 위에 드래그합니다.
- 내부적으로 `scripts\video_to_vr_pipeline.py --fps 60`을 실행합니다.

주의:

- 30fps 대비 처리할 프레임 수가 2배입니다.
- `.ply`, SBS PNG, 처리 시간, 디스크 사용량도 거의 2배로 늘어납니다.

중간에 디스크 공간 부족 등으로 멈췄다면, 같은 결과 폴더를 지정하여 재개할 수 있습니다. 아래 방식은 이미 완성된 PLY를 다시 추론하지 않고, SBS 프레임으로 렌더한 PLY는 즉시 삭제해 공간을 돌려받습니다. `--repair-frames-from`에는 손상되었거나 누락된 첫 프레임 번호를 넣습니다.

```text
video_to_vr_pipeline_60fps.bat "입력영상.mp4" --output-dir "outputs\video_vr_YYYYMMDD-HHMMSS" --resume --repair-frames-from 15258 --delete-ply-after-render --render-workers 4 --ply-batch-size 1000
```

재개 모드는 먼저 최대 1,000개 PNG의 PLY를 한 프로세스에서 연속 생성한 뒤, 그 배치의 SBS 프레임을 병렬 렌더하고 성공한 PLY만 삭제합니다. PLY 추론은 GPU 메모리 사용량이 크므로 기본적으로 한 프로세스로 유지하고, `--render-workers`는 상대적으로 가벼운 SBS 렌더에만 적용합니다.

### `make_youtube_3d_fpa.bat`

이미 만들어진 좌우 SBS 3D `.mp4`를 YouTube/Quest 업로드용 3D 영상으로 다시 인코딩합니다.

이 프로젝트에서 YouTube/Quest 테스트 결과가 가장 좋았던 설정을 고정해둔 BAT입니다.

적용되는 설정:

- H.264 FPA `frame-packing=3`
- `sample_aspect_ratio = 1:2`
- `display_aspect_ratio = 16:9`
- 오디오는 재인코딩하지 않고 그대로 복사

사용법:

- SBS 3D `.mp4` 파일을 `make_youtube_3d_fpa.bat` 위에 드래그합니다.
- 결과는 입력 파일과 같은 폴더에 `입력파일명_youtube3d_fpa_dar16x9.mp4` 이름으로 저장됩니다.
- 같은 이름의 출력 파일이 이미 있으면 `_2`, `_3`처럼 자동으로 새 이름을 붙입니다.

예:

```text
vr_sbs_offset_1p0_full.mp4
-> vr_sbs_offset_1p0_full_youtube3d_fpa_dar16x9.mp4
```

## PowerShell로 직접 실행하기

BAT 대신 PowerShell에서 직접 실행할 수도 있습니다.

```powershell
cd <프로젝트 폴더>
.\scripts\predict.ps1
```

특정 이미지 하나만 변환:

```powershell
.\scripts\predict.ps1 -InputPath "C:\path\to\image.jpg"
```

특정 폴더를 변환:

```powershell
.\scripts\predict.ps1 -InputPath "C:\path\to\image_folder"
```

출력 폴더를 직접 지정:

```powershell
.\scripts\predict.ps1 -InputPath "C:\path\to\image.jpg" -OutputPath "C:\path\to\output"
```

렌더까지 실행:

```powershell
.\scripts\predict.ps1 -Render
```

단, PowerShell에서 직접 `-Render`를 실행할 때는 `nvcc`와 Visual Studio C++ 환경이 현재 터미널에 잡혀 있어야 합니다. 보통은 `run_predict_render.bat`를 사용하는 것이 더 편합니다.

스테레오 SBS 영상 렌더:

```powershell
.\scripts\with_cuda_env.bat powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\render_stereo_ply.ps1 -InputPath "C:\path\to\scene.ply"
```

좌안/우안 개별 영상까지 함께 만들기:

```powershell
.\scripts\with_cuda_env.bat powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\render_stereo_ply.ps1 -InputPath "C:\path\to\scene.ply" -Layout both
```

IPD 조절 예:

```powershell
.\scripts\with_cuda_env.bat powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\render_stereo_ply.ps1 -InputPath "C:\path\to\scene.ply" -Ipd 0.06
```

영상 길이 조절 예:

```powershell
.\scripts\with_cuda_env.bat powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\render_stereo_ply.ps1 -InputPath "C:\path\to\scene.ply" -DurationSeconds 6
```

영상 전체 파이프라인을 5프레임만 테스트:

```powershell
.\scripts\with_cuda_env.bat .\.venv\Scripts\python.exe .\scripts\video_to_vr_pipeline.py -i "C:\path\to\input.mp4" --max-frames 5
```

영상 전체 파이프라인을 전체 프레임으로 실행:

```powershell
.\scripts\with_cuda_env.bat .\.venv\Scripts\python.exe .\scripts\video_to_vr_pipeline.py -i "C:\path\to\input.mp4"
```

## 첫 실행 시 참고

첫 예측 실행 때 SHARP 모델 체크포인트가 자동 다운로드됩니다.

다운로드 위치:

```text
%USERPROFILE%\.cache\torch\hub\checkpoints\sharp_2572gikvuh.pt
```

이미 한 번 다운로드가 완료되어 있으면 다음 실행부터는 다시 받지 않습니다.

## 품질 관련 참고

SHARP는 단일 이미지에서 3D Gaussian Splatting을 만드는 도구입니다.

잘 맞는 용도:

- 이미지 한 장을 3DGS로 빠르게 변환해보기
- 원본 시점 근처에서 살짝 움직이는 view synthesis
- Spark나 Quest 3에서 3DGS 실험용 데이터 만들기

한계:

- 사진에 보이지 않는 뒤쪽 영역을 정확히 복원하지는 못합니다.
- 카메라를 크게 옆이나 뒤로 돌리면 깨지거나 어색할 수 있습니다.
- 진짜 고품질 공간 복원은 여러 장 사진이나 영상 기반 3DGS가 더 좋습니다.

## 현재 smoke test 결과

SHARP 저장소의 예시 이미지로 실제 변환 테스트를 완료했습니다.

생성된 파일:

```text
outputs\smoke_test\teaser.ply
```

확인된 내용:

- CUDA 장치로 inference 실행
- RTX 4080 인식 정상
- `.ply` 저장 성공

## Spark + WebXR VR 데모

SHARP로 만든 `.ply`를 Spark + Three.js + WebXR로 보는 최소 데모가 들어 있습니다.

데모 폴더:

```text
webxr-spark-demo
```

실행 BAT:

```text
run_webxr_demo.bat
```

Quest 3에서 WebXR가 HTTPS를 요구할 때 쓰는 터널 BAT:

```text
run_webxr_demo_tunnel.bat
```

현재 데모가 로딩하는 파일:

```text
webxr-spark-demo\public\splats\sharp-output.ply
```

다른 `.ply`를 보고 싶으면 원하는 파일을 위 경로에 `sharp-output.ply` 이름으로 덮어쓴 뒤 데모를 새로고침하면 됩니다.

여러 `.ply`를 하나씩 넘겨보려면 아래 파일을 실행해서 최신 결과 목록을 갱신하세요.

```text
refresh_splat_list.bat
```

이 BAT는 `outputs` 아래의 최신 `.ply` 최대 30개를 `webxr-spark-demo\public\splats`로 복사하고 `manifest.json`을 만듭니다.

데모 화면에서는:

- `Prev` / `Next` 버튼으로 이전/다음 파일 보기
- 드롭다운으로 파일 직접 선택
- 키보드 `[` / `]` 또는 좌/우 화살표로 이전/다음 파일 보기
- Quest 컨트롤러의 왼쪽 primary 버튼으로 이전, 오른쪽 primary 버튼으로 다음 파일 보기

### PC에서 확인

```powershell
cd <프로젝트 폴더>\webxr-spark-demo
npm run dev
```

브라우저에서 아래 주소를 엽니다.

```text
https://localhost:5173
```

개발용 self-signed 인증서를 쓰기 때문에 브라우저가 인증서 경고를 보여줄 수 있습니다. PC 브라우저에서는 VR 기기가 없어서 `VR NOT SUPPORTED`가 보일 수 있습니다. 일반 3DGS 렌더가 보이면 정상입니다.

### Quest 3에서 확인

PC와 Quest 3가 같은 네트워크에 있어야 합니다.

PC LAN 주소 예:

```text
https://<PC의 LAN IP>:5173
```

절차:

1. PC에서 `run_webxr_demo.bat`를 실행합니다.
2. Quest 3 브라우저를 엽니다.
3. Quest 3 브라우저에서 `https://<PC의 LAN IP>:5173`에 접속합니다.
4. `ENTER VR` 버튼이 보이면 눌러서 VR 모드에 들어갑니다.

### Quest 3 조작

- 시점 방향: Quest 3 헤드 트래킹 기본 동작 사용
- 왼쪽 조이스틱 좌/우: 좌/우 이동
- 왼쪽 조이스틱 앞/뒤: 앞/뒤 이동
- 오른쪽 조이스틱 좌/우: 좌/우 회전
- 왼쪽 그립 버튼: 아래로 이동
- 오른쪽 그립 버튼: 위로 이동
- 왼쪽 검지 트리거: 줌아웃처럼 뒤로 이동
- 오른쪽 검지 트리거: 줌인처럼 앞으로 이동

### 화면 품질 참고

데모에는 SHARP 단일 이미지 결과를 보기 좋게 하기 위한 기본 보정이 들어 있습니다.

- Spark `focalAdjustment`를 높여 splat이 조금 더 또렷하게 보이도록 조정
- 너무 넓게 퍼지는 splat을 줄이기 위해 `maxStdDev` 조정
- 디버그 축 제거
- WebXR 성능을 위해 WebGL antialias 비활성화

그래도 단일 이미지 SHARP 결과는 원본 사진에 없던 옆/뒤 영역이 깨져 보일 수 있습니다. 이건 뷰어 문제가 아니라 단일 이미지 3DGS의 한계일 수 있습니다.

### Quest 3 점 깜빡임/화면 밖 artifact 진단

Quest 3에서 브라우저 밖까지 점이 깜빡이는 것처럼 보이면, 앱 UI 문제가 아니라 Quest Browser/WebXR/WebGL 합성 레이어 또는 GPU 드라이버와 Spark shader 경로의 조합 문제일 수 있습니다.

아래 순서로 원인을 나눠서 확인하세요.

1. 안전 모드로 접속

```text
https://<PC의 LAN IP>:5173/?safe
```

현재 `?safe`는 단순 저품질 모드가 아니라 Quest용 foveated quality 모드입니다. 시선 중심부는 더 높은 품질로 두고, 주변부와 멀리 있는 splat은 LoD/foveation으로 줄입니다.

- pixel ratio를 기본 안전 모드보다 높게 사용
- Spark LoD 사용
- 시선 중심부 cone 안쪽은 더 많은 splat 유지
- 주변부/뒤쪽/먼 거리 splat 부담 감소
- 너무 큰 splat 반경은 제한해서 흰 점 artifact 완화

아주 가벼운 저부하 모드가 필요하면 아래 주소를 사용하세요.

```text
https://<PC의 LAN IP>:5173/?lite
```

`?safe`에서 약간의 흰 점 깜빡임이 남을 수 있지만, `?lite`보다 중심부 품질을 더 높게 보도록 조정되어 있습니다.

2. splat 비활성 진단 모드로 접속

```text
https://<PC의 LAN IP>:5173/?nosplat
```

이 모드에서도 브라우저 밖 점 깜빡임이 보이면 Spark나 `.ply`보다 WebXR/브라우저/Quest 렌더링 환경 문제일 가능성이 큽니다.

3. `?nosplat`에서는 괜찮고 기본 모드에서만 깜빡이면 `?safe`를 기본으로 사용하거나 `.ply`를 SuperSplat에서 압축/정리한 뒤 다시 테스트하는 편이 좋습니다.

주의:

- WebXR는 보통 HTTPS 같은 secure context를 요구합니다.
- `run_webxr_demo.bat`는 HTTPS 개발 서버를 띄우지만, 개발용 self-signed 인증서라 브라우저에서 인증서 경고가 나올 수 있습니다.
- Quest 3 브라우저에서 인증서 경고가 뜨면 고급/계속 진행을 선택해야 합니다. 그래도 WebXR가 막히면 터널 방식으로 접속하세요.
- Quest 3에서 `webxr needs https`, `VR NOT SUPPORTED`, 인증서 오류가 계속 보이면 `run_webxr_demo_tunnel.bat`를 실행하세요.
- 터널 BAT가 출력하는 `https://...` 주소를 Quest 3 브라우저에 입력하면 공개 HTTPS 주소로 접속할 수 있습니다.
- 데스크톱 Codex 인앱 브라우저에서 `VR NOT SUPPORTED`가 뜨는 것은 정상입니다.

## 렌더링 오류 참고

아래 메시지가 나오면 `.ply` 생성은 가능하지만, SHARP의 `.mp4` 렌더링 단계에 필요한 CUDA Toolkit이 없는 상태입니다.

```text
gsplat: No CUDA toolkit found. gsplat will be disabled.
AttributeError: 'NoneType' object has no attribute 'CameraModelType'
```

이 경우에는 `run_predict.bat`로 `.ply`만 생성하면 됩니다. Spark나 SuperSplat에서 3DGS를 볼 목적이라면 `.mp4` 렌더링은 필수가 아닙니다.

`.mp4` 렌더링까지 사용하려면 NVIDIA CUDA Toolkit과 Visual Studio C++ 빌드 도구가 필요합니다. 현재 프로젝트에는 CUDA Toolkit 12.8과 RTX 4080용 `TORCH_CUDA_ARCH_LIST=8.9` 설정을 잡아주는 `scripts\with_cuda_env.bat`가 포함되어 있습니다.

확인 완료된 실행 파일:

```text
run_predict_render.bat
render_ply_video.bat
render_stereo_video.bat
video_to_vr_pipeline.bat
```

추가로, Windows에서 `gsplat 1.5.3`이 MSVC에 맞지 않는 컴파일 옵션을 넘기는 문제가 있어 현재 가상환경의 아래 파일을 Windows용으로 패치했습니다.

```text
.venv\Lib\site-packages\gsplat\cuda\_backend.py
```

가상환경을 새로 만들거나 `gsplat`을 재설치하면 이 패치가 사라질 수 있습니다. 그 경우 다시 렌더 테스트가 필요합니다.
