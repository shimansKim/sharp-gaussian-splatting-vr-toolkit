@echo off
chcp 65001 >nul
setlocal
title quest-native 앱 빌드
rem 더블클릭으로 Quest 3 앱(APK)을 만든다. 설명: docs/install-guide.md
rem 인수를 하나 주면(build.bat nopause) 끝에 멈추지 않는다(다른 bat·에이전트용).
cd /d "%~dp0"
call "%~dp0tools\qn_env.bat"

echo ==================================================
echo   quest-native 앱 빌드
echo ==================================================
echo.
echo [1/3] 필요한 설치물 확인
call "%~dp0tools\qn_check.bat"
if errorlevel 1 (
  echo.
  echo  빠진 것을 설치한 뒤 다시 실행하세요. check_env.bat이 자세히 확인하고 설치도 도와줍니다.
  goto :fail
)
echo  확인 완료

echo [2/3] 서명 키 확인
call "%~dp0tools\qn_signing.bat"
if errorlevel 1 goto :fail

echo [3/3] 빌드(처음에는 인터넷으로 부품을 받느라 몇 분 걸립니다)
> "%~dp0local.properties" echo sdk.dir=%ANDROID_HOME:\=/%
call "%~dp0gradlew.bat" -p "%~dp0." --project-cache-dir "%QN_BUILD_ROOT%\gradle-project-cache" assembleRelease
if errorlevel 1 goto :buildfail

echo.
echo ==================================================
echo   빌드 성공
echo   APK: %QN_APK%
echo   헤드셋에 설치하려면 install.bat을 실행하세요.
echo ==================================================
if "%~1"=="" pause
exit /b 0

:buildfail
echo.
echo ==================================================
echo   빌드 실패. 위쪽의 빨간 줄이나 "What went wrong" 아래를 보세요.
echo   - "Open-source notice check failed": docs/licenses.md 7절 목록과 실제 구성요소가 다릅니다.
echo   - "Could not resolve" / "Could not GET": 인터넷 연결을 확인하고 다시 실행하세요.
echo   - "No space left" / "not enough space": 디스크 공간을 비우세요.
echo   - 그 밖: 이 창의 내용을 복사해 개발 담당에게 보내 주세요.
echo ==================================================
:fail
if "%~1"=="" pause
exit /b 1
