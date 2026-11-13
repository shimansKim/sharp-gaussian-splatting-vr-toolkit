@echo off
rem splat 측정 도구(offscreen_bench, sharp_pack_check)를 NDK로 빌드한다. APK와 별개다.
rem 출력: %LOCALAPPDATA%\sharp-quest-native\<체크아웃 폴더 이름>\splat-tools
chcp 65001 >nul
setlocal
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "NDK=%ANDROID_HOME%\ndk\28.1.13356709"
set "CMAKE=%ANDROID_HOME%\cmake\3.22.1\bin\cmake.exe"
set "NINJA=%ANDROID_HOME%\cmake\3.22.1\bin\ninja.exe"
for %%I in ("%~dp0..\..\..") do set "CHECKOUT=%%~nxI"
if not defined QN_TOOLS_DIR set "QN_TOOLS_DIR=%LOCALAPPDATA%\sharp-quest-native\%CHECKOUT%\splat-tools"
set "SRC=%~dp0..\..\app\src\main\cpp\splat\tools"

if not exist "%NDK%" (echo [오류] NDK 28.1.13356709가 없습니다: %NDK% & goto :fail)
if not exist "%CMAKE%" (echo [오류] CMake 3.22.1이 없습니다: %CMAKE% & goto :fail)

"%CMAKE%" -S "%SRC%" -B "%QN_TOOLS_DIR%" -G Ninja -DCMAKE_MAKE_PROGRAM="%NINJA%" ^
  -DCMAKE_TOOLCHAIN_FILE="%NDK%\build\cmake\android.toolchain.cmake" -DANDROID_ABI=arm64-v8a ^
  -DANDROID_PLATFORM=android-32 -DANDROID_STL=c++_static -DCMAKE_BUILD_TYPE=Release >nul
if errorlevel 1 (echo [오류] CMake 설정 실패 & goto :fail)
"%CMAKE%" --build "%QN_TOOLS_DIR%"
if errorlevel 1 (echo [오류] 빌드 실패 & goto :fail)
echo 도구: %QN_TOOLS_DIR%\offscreen_bench, %QN_TOOLS_DIR%\sharp_pack_check
endlocal & exit /b 0

:fail
endlocal & exit /b 1
