@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Quest 3 영상 변환
rem 영상 파일(여러 개)을 이 bat 위에 끌어다 놓으면 docs/encoding-guide.md 권장값으로 변환한다.
rem 권장값 표: 같은 폴더의 quest_presets.csv. 결과: 원본 옆 "<이름>_q3_<형식>.mp4" (원본은 그대로).
rem 이미 권장 범위인 파일도 다시 만들려면: quest_encode.bat /force 파일...
rem 묻지 않고 돌리려면(시험용) 환경 변수 QE_TIER, QE_ENCODER, QE_FORCE, QE_LAYOUT, QE_NONINTERACTIVE, QE_NOPAUSE.
rem quest_encode.ps1에는 한국어가 있어 UTF-8로 읽어 실행한다(PowerShell 5.1의 -File은 BOM 없는 파일을 ANSI로 읽음).
set "QE_DIR=%~dp0"
set "QE_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Join-Path $env:QE_DIR 'quest_encode.ps1'; & ([scriptblock]::Create([IO.File]::ReadAllText($p, [Text.Encoding]::UTF8))); exit $LASTEXITCODE"
set "RC=%ERRORLEVEL%"
if not defined QE_NOPAUSE pause
exit /b %RC%
