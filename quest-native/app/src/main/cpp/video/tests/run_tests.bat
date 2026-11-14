@echo off
rem PC geometry tests with real OpenXR headers. Build the APK once to populate the Gradle cache.
rem Optional first argument: OpenXR include directory (containing openxr/openxr.h).
setlocal
set "HERE=%~dp0"
set "OUT=%LOCALAPPDATA%\sharp-quest-native\video-tests"
set "XR_INCLUDE=%~1"
if not defined XR_INCLUDE for /d %%v in ("%USERPROFILE%\.gradle\caches\*") do for /d %%d in ("%%v\transforms\*") do if exist "%%d\transformed\openxr_loader_for_android-1.1.65\prefab\modules\headers\include\openxr\openxr.h" set "XR_INCLUDE=%%d\transformed\openxr_loader_for_android-1.1.65\prefab\modules\headers\include"
if not exist "%XR_INCLUDE%\openxr\openxr.h" (
  echo OpenXR headers not found. Pass the include directory as the first argument.
  exit /b 2
)
if not exist "%OUT%" mkdir "%OUT%"
set "VCVARS="
for %%e in (Community Professional Enterprise BuildTools) do (
  if not defined VCVARS if exist "%ProgramFiles%\Microsoft Visual Studio\2022\%%e\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%ProgramFiles%\Microsoft Visual Studio\2022\%%e\VC\Auxiliary\Build\vcvars64.bat"
)
if not exist "%VCVARS%" (
  echo Visual Studio C++ tools not found.
  exit /b 2
)
call "%VCVARS%" >nul 2>nul
where cl >nul 2>nul || exit /b 2
cl /nologo /std:c++17 /EHsc /W4 /utf-8 /I "%HERE%..\.." /I "%XR_INCLUDE%" "%HERE%video_layers_test.cpp" /Fo"%OUT%\\" /Fe"%OUT%\video_layers_test.exe" || exit /b 1
"%OUT%\video_layers_test.exe"
exit /b %ERRORLEVEL%
