@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem Quest의 진단 결과(JSON·MD)를 PC로 가져온다. 시험 영상은 가져오지 않는다.
rem   가져오는 곳: 이 폴더의 diag-results\<날짜-시각>\   (저장소에 올라가지 않음)

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
set "DIR=/sdcard/Android/data/com.sharp.questnative/files/diagnostics"

"%ADB%" get-state >nul 2>&1
if errorlevel 1 (
  echo [오류] Quest가 연결돼 있지 않습니다.
  if "%~1"=="" pause
  exit /b 1
)
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%T"
set "DEST=%~dp0diag-results\%STAMP%"
rem 경로를 "...\"로 끝내면 \" 가 따옴표 이스케이프로 읽혀 adb가 폴더 이름에 따옴표를 붙인다(2026-11-14 실기기). 끝에 \를 붙이지 않는다.
mkdir "%DEST%"
set COUNT=0
for /f "delims=" %%F in ('"%ADB%" shell ls %DIR%/*.json %DIR%/*.md %DIR%/*.txt 2^>nul') do (
  "%ADB%" pull "%%F" "%DEST%" >nul && set /a COUNT+=1
)
if "%COUNT%"=="0" (
  echo [주의] 가져온 결과 파일이 없습니다. 앱에서 진단을 먼저 실행하세요.
) else (
  echo 결과 %COUNT%개를 가져왔습니다: %DEST%
  if exist "%DEST%\latest.md" echo 요약: %DEST%\latest.md
)
if "%~1"=="" pause
exit /b 0
