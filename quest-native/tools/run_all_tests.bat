@echo off
chcp 65001 >nul
setlocal
title quest-native 시험 한 번에
rem 헤드셋 없이 할 수 있는 시험을 모두 돌리고 보고서 한 장을 만든다(tools/run_all_tests.ps1).
rem   빈 폴더에서 처음부터 빌드, JVM 단위 시험, image·splat C++ PC 시험, 오픈소스 고지 검사, APK 요약
rem 보고서 위치를 정하려면: run_all_tests.bat -Report "C:\경로\report.txt"
rem C++ PC 시험에는 Visual Studio 2022(C++)가 필요하다. 없으면 그 부분만 건너뛴다.
call "%~dp0qn_env.bat"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_all_tests.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo  모든 시험 통과) else (echo  실패한 시험이 있습니다. 위 보고서를 보세요.)
if "%~1"=="" pause
exit /b %RC%
