@echo off
rem 빌드에 필요한 설치물과 디스크 공간을 확인한다. qn_env.bat을 먼저 call한 뒤 부른다.
rem   call qn_check.bat           : 빠진 것만 알린다(build.bat이 씀)
rem   call qn_check.bat full      : 모두 보여 주고, sdkmanager가 있으면 설치할지 묻는다(check_env.bat이 씀)
rem 종료 코드: 0 = 빌드 가능, 1 = 빠진 것이 있음
setlocal EnableDelayedExpansion
set "MODE=%~1"
set "BAD=0"
set "SDKPKGS="

rem ---- JDK
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" (
  if "%MODE%"=="full" echo  [있음] JDK: %JAVA_HOME%
  goto :jdk_ok
)
echo  [없음] JDK 17 이상
echo         Android Studio를 설치하면 함께 들어옵니다: https://developer.android.com/studio
echo         또는 Temurin 17을 설치하세요: https://adoptium.net
echo         설치한 뒤 이 창을 닫고 다시 실행하세요.
set "BAD=1"
:jdk_ok

rem ---- Android SDK
if exist "%ANDROID_HOME%\" (
  if "%MODE%"=="full" echo  [있음] Android SDK: %ANDROID_HOME%
  goto :sdk_ok
)
echo  [없음] Android SDK: %ANDROID_HOME%
echo         Android Studio를 설치하고 한 번 실행하면 이 위치에 SDK가 생깁니다.
echo         다른 곳에 있으면 환경 변수 ANDROID_HOME에 그 경로를 넣으세요.
set "BAD=1"
goto :disk
:sdk_ok

call :need "platforms\%QN_PLATFORM%" "SDK Platform %QN_PLATFORM%" "platforms;%QN_PLATFORM%"
call :need "ndk\%QN_NDK%" "NDK %QN_NDK%" "ndk;%QN_NDK%"
call :need "cmake\%QN_CMAKE%" "CMake %QN_CMAKE%" "cmake;%QN_CMAKE%"
call :need "platform-tools\adb.exe" "Platform-Tools·adb" "platform-tools"
set "BT="
for /d %%D in ("%ANDROID_HOME%\build-tools\3*") do set "BT=%%~nxD"
if defined BT (
  if "%MODE%"=="full" echo  [있음] Build-Tools !BT!
) else (
  echo  [없음] Build-Tools
  set "SDKPKGS=!SDKPKGS! "build-tools;%QN_BUILD_TOOLS%""
  set "BAD=1"
)

if not defined SDKPKGS goto :disk
set "SDKMANAGER="
for %%S in ("%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat") do if exist "%%~S" set "SDKMANAGER=%%~S"
if not defined SDKMANAGER for /d %%D in ("%ANDROID_HOME%\cmdline-tools\*") do if exist "%%~D\bin\sdkmanager.bat" set "SDKMANAGER=%%~D\bin\sdkmanager.bat"
echo.
echo  빠진 SDK 구성요소:!SDKPKGS!
if not defined SDKMANAGER (
  echo  설치 방법: Android Studio ^> Settings ^> Languages ^& Frameworks ^> Android SDK
  echo           "SDK Platforms"에서 Android 16(API 36^), "SDK Tools"에서 "Show Package Details"를 켜고
  echo           NDK %QN_NDK%, CMake %QN_CMAKE%, Build-Tools, Platform-Tools를 고른 뒤 Apply.
  goto :disk
)
if not "%MODE%"=="full" (
  echo  check_env.bat을 실행하면 바로 설치할 수 있습니다.
  goto :disk
)
choice /c YN /m " 지금 sdkmanager로 설치할까요? (인터넷 필요, 몇 GB) [Y=예 / N=아니오]"
if errorlevel 2 goto :disk
echo  라이선스에 동의하고 설치합니다...
(for /l %%i in (1,1,30) do @echo y) | call "%SDKMANAGER%" --sdk_root="%ANDROID_HOME%" --licenses >nul
call "%SDKMANAGER%" --sdk_root="%ANDROID_HOME%" --install !SDKPKGS!
if errorlevel 1 (
  echo  [실패] sdkmanager 설치가 끝나지 않았습니다. 위 메시지를 확인하세요.
) else (
  echo  설치를 마쳤습니다. 다시 확인합니다.
  endlocal & call "%~f0" full & exit /b
)

:disk
rem ---- 디스크: 빌드 출력이 놓이는 드라이브(최소 2GB, 권장 5GB)
set "DRIVE=%QN_BUILD_ROOT:~0,1%"
set "FREE="
for /f %%G in ('powershell -NoProfile -Command "[math]::Floor((Get-PSDrive %DRIVE%).Free/1GB)"') do set "FREE=%%G"
if not defined FREE goto :done
if %FREE% LSS 2 (
  echo  [부족] %DRIVE%: 드라이브 남은 공간 %FREE%GB. 빌드에는 2GB 이상 필요합니다. 파일을 지워 공간을 만드세요.
  set "BAD=1"
  goto :done
)
if %FREE% LSS 5 (
  echo  [주의] %DRIVE%: 드라이브 남은 공간 %FREE%GB. 처음 빌드는 5GB 정도를 씁니다.
  goto :done
)
if "%MODE%"=="full" echo  [있음] %DRIVE%: 드라이브 남은 공간 %FREE%GB

:done
endlocal & exit /b %BAD%

:need
rem %1 = ANDROID_HOME 아래 경로, %2 = 이름, %3 = sdkmanager 패키지
if exist "%ANDROID_HOME%\%~1" (
  if "%MODE%"=="full" echo  [있음] %~2
  exit /b 0
)
echo  [없음] %~2
set "SDKPKGS=!SDKPKGS! "%~3""
set "BAD=1"
exit /b 0
