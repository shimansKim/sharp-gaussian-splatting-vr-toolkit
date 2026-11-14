@echo off
rem 2단계: 실측판 APK로 실제 VR 화면의 fps와 GPU 시간을 잰다.
rem 사용: SHARP PLY 파일을 이 bat 위에 끌어다 놓고, 안내가 나오면 헤드셋을 쓴다.
rem bat이 splat 수(118만/60만/40만/20만)와 해상도 배율을 adb로 바꾸며 30초씩 잰다. 그동안 머리를 천천히 좌우로 돌린다.
rem 결과: measurements\app_*.txt, measurements\app_metrics.csv 와 화면 요약.
chcp 65001 >nul
setlocal
set PYTHONIOENCODING=utf-8
rem call :label 과 goto 는 쓰지 않는다: 한글이 든 UTF-8 bat에서 cmd가 label 위치를 잘못 찾는다
rem ("The system cannot find the batch label specified", 줄 중간부터 실행). 조건별 측정은 step2_measure.bat.
set "PAUSE=pause"
if not "%~2"=="" set "PAUSE=ver >nul"
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
for %%I in ("%~dp0..\..\..") do set "CHECKOUT=%%~nxI"
if not defined QN_BUILD_ROOT set "QN_BUILD_ROOT=%LOCALAPPDATA%\sharp-quest-native\%CHECKOUT%"
set "APK=%QN_BUILD_ROOT%\app\outputs\apk\release\app-release.apk"
set "PKG=com.sharp.questnative"
set "FILES=/sdcard/Android/data/%PKG%/files"
set "PLY=%~1"
rem 이름에 공백·한글이 있어도 되도록 기기에는 scene.ply 로 넣는다.
set "PLYNAME=scene.ply"
set "OUT=%~dp0measurements"
if "%PLY%"=="" (echo [안내] SHARP PLY 파일을 이 bat 위에 끌어다 놓으세요. & %PAUSE% & exit /b 1)
if not exist "%PLY%" (echo [오류] 파일이 없습니다: %PLY% & %PAUSE% & exit /b 1)
"%ADB%" get-state 1>nul 2>nul || (echo [오류] Quest가 연결돼 있지 않습니다. USB 디버깅을 허용했는지 확인하세요. & %PAUSE% & exit /b 1)
if not exist "%OUT%" mkdir "%OUT%"

if not exist "%APK%" (
  echo APK가 없어 먼저 빌드합니다...
  call "%~dp0..\..\build.bat" nopause || (%PAUSE% & exit /b 1)
)

echo [1/4] 설치하고 PLY를 앱 폴더에 넣습니다...
"%ADB%" install -r -g "%APK%" || (echo [오류] 설치 실패 & %PAUSE% & exit /b 1)
"%ADB%" shell am force-stop %PKG%
"%ADB%" shell mkdir -p %FILES%/ply
"%ADB%" shell "rm -f %FILES%/ply/*.ply %FILES%/qnsplat_metrics.csv"
"%ADB%" push "%PLY%" %FILES%/ply/%PLYNAME% >nul || (echo [오류] PLY 복사 실패 & %PAUSE% & exit /b 1)
for %%P in (budget scale fov key hz recenter measure) do "%ADB%" shell setprop debug.qnsplat.%%P "''"

echo [2/4] 앱을 시작하고 PLY를 엽니다(qn.open). 지금 헤드셋을 쓰세요(20초 기다림).
"%ADB%" shell am start -n %PKG%/.core.QnActivity --es qn.open "file://%FILES%/ply/%PLYNAME%" >nul
powershell -NoProfile -Command "Start-Sleep -Seconds 20"
"%ADB%" shell setprop debug.qnsplat.recenter 1

echo [3/4] 측정: 조건마다 30초. 머리를 천천히 좌우로 돌리며 장면을 보세요.
call "%~dp0step2_measure.bat" 0 1.0 b0_s100
call "%~dp0step2_measure.bat" 600000 1.0 b600k_s100
call "%~dp0step2_measure.bat" 400000 1.0 b400k_s100
call "%~dp0step2_measure.bat" 200000 1.0 b200k_s100
call "%~dp0step2_measure.bat" 0 0.8 b0_s080
call "%~dp0step2_measure.bat" 0 0.6 b0_s060

echo [4/4] 앱 기록(CSV)을 가져옵니다...
"%ADB%" pull %FILES%/qnsplat_metrics.csv "%OUT%\app_metrics.csv" >nul 2>nul && echo   %OUT%\app_metrics.csv
"%ADB%" logcat -d -s QuestNative:* > "%OUT%\app_questnative_log.txt"
echo.
echo ===== 요약 =====
findstr "QNSPLAT_SUMMARY" "%OUT%\app_b*.txt"
echo 원본 기록: %OUT%\app_*.txt

endlocal
if "%~2"=="" pause
