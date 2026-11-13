@echo off
rem PC unit tests of the image viewer's pure logic (image_logic.cpp). Needs Visual Studio 2022 (C++).
rem Output goes to %LOCALAPPDATA%\sharp-quest-native\image-tests, not into the repository.
setlocal
set "HERE=%~dp0"
set "OUT=%LOCALAPPDATA%\sharp-quest-native\image-tests"
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
cl /nologo /std:c++17 /EHsc /W4 /utf-8 /I "%HERE%..\.." "%HERE%image_logic_test.cpp" "%HERE%..\image_logic.cpp" /Fo"%OUT%\\" /Fe"%OUT%\image_logic_test.exe" || exit /b 1
"%OUT%\image_logic_test.exe"
exit /b %ERRORLEVEL%
