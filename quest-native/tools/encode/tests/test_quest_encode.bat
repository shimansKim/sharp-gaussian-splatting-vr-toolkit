@echo off
chcp 65001 >nul
setlocal EnableExtensions
title quest_encode 시험
rem 합성 영상으로 quest_encode.bat을 시험한다(한글·공백 경로, 여러 파일, 건너뛰기·강제, 등급, HDR→SDR).
rem 약 1~3분 걸린다. ffmpeg가 필요하다. 통과하면 시험 폴더를 지운다.
set "QE_TEST_DIR=%~dp0."
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Join-Path $env:QE_TEST_DIR 'test_quest_encode.ps1'; & ([scriptblock]::Create([IO.File]::ReadAllText($p, [Text.Encoding]::UTF8))); exit $LASTEXITCODE"
set "RC=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %RC%
