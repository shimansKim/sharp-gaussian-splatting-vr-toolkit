@echo off
chcp 65001 >nul
setlocal
title quest-native 준비 확인
rem 새 PC에서 처음 한 번 실행한다. 빌드에 필요한 설치물을 확인하고, 빠진 SDK 구성요소는 설치할지 묻는다.
rem 설명: docs/install-guide.md
call "%~dp0tools\qn_env.bat"
echo ==================================================
echo   quest-native 준비 확인
echo ==================================================
echo  필요한 것: JDK 17 이상, Android SDK(Platform %QN_PLATFORM%, NDK %QN_NDK%, CMake %QN_CMAKE%,
echo            Build-Tools, Platform-Tools), 빌드할 드라이브에 5GB 정도
echo.
call "%~dp0tools\qn_check.bat" full
if errorlevel 1 (
  echo.
  echo  빠진 것이 있습니다. 위 안내대로 설치한 뒤 이 파일을 다시 실행하세요.
) else (
  echo.
  echo  모두 준비됐습니다. build_and_install.bat을 실행하세요.
)
pause
exit /b 0
