@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title quest-native 헤드셋에 설치
rem USB로 연결한 Quest에 앱을 설치하고 실행한다. 먼저 build.bat. 설명: docs/install-guide.md
rem 인수를 하나 주면(install.bat nopause) 끝에 멈추지 않는다.
cd /d "%~dp0"
call "%~dp0tools\qn_env.bat"
set "NOPAUSE=%~1"

echo ==================================================
echo   quest-native 헤드셋에 설치
echo ==================================================
if not exist "%QN_ADB%" (
  echo  [오류] adb가 없습니다: %QN_ADB%
  echo         check_env.bat을 실행해 Platform-Tools를 설치하세요.
  goto :fail
)
if not exist "%QN_APK%" (
  echo  [오류] 아직 만든 앱이 없습니다: %QN_APK%
  echo         build.bat을 먼저 실행하세요.
  goto :fail
)
"%QN_ADB%" start-server >nul 2>&1

:detect
set "N=0"
set "UNAUTH=0"
set "OFFLINE=0"
for /f "skip=1 tokens=1,2" %%A in ('call "%QN_ADB%" devices') do (
  if "%%B"=="device" (
    set /a N+=1
    set "DEV!N!=%%A"
  )
  if "%%B"=="unauthorized" set /a UNAUTH+=1
  if "%%B"=="offline" set /a OFFLINE+=1
)
if %N% GEQ 1 goto :pick
echo.
if %UNAUTH% GEQ 1 (
  echo  [허용 필요] 헤드셋이 연결됐지만 이 PC를 아직 허용하지 않았습니다.
  echo   1. 헤드셋을 쓰세요. "USB 디버깅을 허용하시겠습니까?" 창이 떠 있습니다.
  echo   2. "이 컴퓨터에서 항상 허용"에 체크하고 [허용]을 누르세요.
  echo   창이 없으면 USB 케이블을 뺐다가 다시 꽂으세요.
) else if %OFFLINE% GEQ 1 (
  echo  [연결 불안정] 헤드셋이 offline으로 보입니다. 케이블을 다시 꽂거나 헤드셋을 다시 켜세요.
) else (
  echo  [연결 없음] 헤드셋이 보이지 않습니다.
  echo   - 헤드셋이 켜져 있고, USB 케이블로 PC에 연결돼 있나요? 충전 전용 케이블은 안 됩니다.
  echo   - 헤드셋의 개발자 모드가 켜져 있나요? 휴대폰 Meta Horizon 앱 ^> 기기 ^> 헤드셋 설정 ^> 개발자 모드
  echo   - 다른 USB 포트나 다른 케이블도 시도해 보세요.
)
echo.
choice /c RQ /m " 다시 확인(R) / 끝내기(Q)"
if errorlevel 2 goto :fail
goto :detect

:pick
set "SERIAL=!DEV1!"
if %N% EQU 1 goto :install
echo.
echo  기기가 %N%대 연결돼 있습니다. 설치할 기기 번호를 고르세요.
for /l %%i in (1,1,%N%) do (
  set "S=!DEV%%i!"
  set "M="
  for /f "delims=" %%m in ('call "%QN_ADB%" -s !S! shell getprop ro.product.model 2^>nul') do set "M=%%m"
  echo   %%i. !S!  !M!
)
set "CH="
set /p "CH= 번호: "
if not defined CH goto :pick
set "SERIAL="
for /l %%i in (1,1,%N%) do if "!CH!"=="%%i" set "SERIAL=!DEV%%i!"
if not defined SERIAL goto :pick

:install
echo.
echo  설치 중: !SERIAL!
set "LOG=%TEMP%\qn-install.log"
"%QN_ADB%" -s !SERIAL! install -r -g "%QN_APK%" > "%LOG%" 2>&1
findstr /c:"Success" "%LOG%" >nul && goto :launch
type "%LOG%"
echo.
findstr /c:"INSTALL_FAILED_UPDATE_INCOMPATIBLE" /c:"signatures do not match" "%LOG%" >nul && goto :sigmismatch
findstr /c:"INSTALL_FAILED_VERSION_DOWNGRADE" "%LOG%" >nul && goto :downgrade
findstr /c:"INSUFFICIENT_STORAGE" "%LOG%" >nul && (
  echo  [공간 부족] 헤드셋 저장 공간이 모자랍니다. 헤드셋에서 안 쓰는 앱이나 파일을 지운 뒤 다시 실행하세요.
  goto :fail
)
findstr /c:"no devices" /c:"device offline" /c:"not found" "%LOG%" >nul && (
  echo  [연결 끊김] 설치 중에 연결이 끊겼습니다. 케이블을 확인하고 다시 실행하세요.
  goto :fail
)
echo  [설치 실패] 위 메시지를 복사해 개발 담당에게 보내 주세요.
goto :fail

:sigmismatch
echo  [서명이 다름] 헤드셋에 다른 PC에서 만든(서명이 다른) 같은 앱이 이미 있습니다.
echo  기존 앱을 지워야 새 앱을 설치할 수 있습니다.
echo  지우면 앱 안의 설정·최근 목록·보관함·버튼 배정이 사라집니다. 헤드셋에 넣어 둔 PLY·영상·사진 파일은 그대로입니다.
choice /c YN /m " 기존 앱을 지우고 다시 설치할까요? [Y=예 / N=아니오]"
if errorlevel 2 goto :fail
"%QN_ADB%" -s !SERIAL! uninstall %QN_PKG%
goto :install

:downgrade
echo  [더 새 판이 있음] 헤드셋에 이 APK보다 버전이 높은 앱이 있습니다.
choice /c YN /m " 그래도 이 판으로 바꿀까요? [Y=예 / N=아니오]"
if errorlevel 2 goto :fail
"%QN_ADB%" -s !SERIAL! install -r -d -g "%QN_APK%" > "%LOG%" 2>&1
findstr /c:"Success" "%LOG%" >nul && goto :launch
type "%LOG%"
goto :fail

:launch
echo  설치 완료. 앱을 실행합니다.
"%QN_ADB%" -s !SERIAL! shell am start -n %QN_ACTIVITY% >nul 2>&1
echo.
echo ==================================================
echo   헤드셋을 쓰면 앱이 열려 있습니다.
echo   다음부터는 헤드셋의 앱 목록 ^> "알 수 없는 출처"에서 "SHARP VR Native"를 실행하세요.
echo   처음에는 목록 패널의 [폴더 고르기]로 파일이 있는 폴더를 허용하세요.
echo   문제가 생기면: "%QN_ADB%" -s !SERIAL! logcat -s QuestNative
echo ==================================================
if not defined NOPAUSE pause
exit /b 0

:fail
if not defined NOPAUSE pause
exit /b 1
