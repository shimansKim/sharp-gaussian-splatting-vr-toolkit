@echo off
chcp 65001 >nul
setlocal
title quest-native 로그 모으기
rem 헤드셋에서 무언가 안 될 때 실행한다. 앱 로그를 파일로 저장하고 그 폴더를 연다.
rem 그 파일을 개발 담당에게 보내면 된다(docs/device-checklist.md).
call "%~dp0qn_env.bat"
if not exist "%QN_ADB%" (
  echo  [오류] adb가 없습니다. check_env.bat을 실행하세요.
  pause
  exit /b 1
)
set "OUT=%LOCALAPPDATA%\sharp-quest-native\device-logs"
if not exist "%OUT%" mkdir "%OUT%"
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%T"
set "FILE=%OUT%\quest-native-%TS%.txt"
echo  헤드셋 로그를 저장합니다...
"%QN_ADB%" logcat -d -v time QuestNative:V QNSplat:V VrApi:I AndroidRuntime:E libc:F DEBUG:F *:S > "%FILE%" 2>&1
if errorlevel 1 (
  echo  [실패] 헤드셋이 연결돼 있는지 확인하세요. install.bat의 안내와 같습니다.
  pause
  exit /b 1
)
echo  저장했습니다: %FILE%
explorer "%OUT%"
pause
exit /b 0
