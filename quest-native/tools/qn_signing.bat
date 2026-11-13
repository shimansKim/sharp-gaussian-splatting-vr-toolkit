@echo off
rem 사이드로드용 서명 키를 이 PC에 한 번 만든다(docs/release.md). qn_env.bat을 먼저 call한 뒤 부른다.
rem 위치: %USERPROFILE%\.sharp-quest-native\release.keystore, signing.properties (저장소 밖)
rem 이미 있으면 아무것도 하지 않는다. 종료 코드 0 = 준비됨.
setlocal
if exist "%QN_KEY_DIR%\signing.properties" if exist "%QN_KEY_DIR%\release.keystore" exit /b 0
if not exist "%JAVA_HOME%\bin\keytool.exe" (
  echo  [오류] keytool이 없습니다: %JAVA_HOME%\bin\keytool.exe
  exit /b 1
)
if not exist "%QN_KEY_DIR%" mkdir "%QN_KEY_DIR%"
set "PW="
for /f %%P in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "PW=%%P"
if not defined PW (
  echo  [오류] 서명 키 비밀번호를 만들지 못했습니다.
  exit /b 1
)
echo  이 PC의 서명 키를 처음 만듭니다: %QN_KEY_DIR%\release.keystore
"%JAVA_HOME%\bin\keytool.exe" -genkeypair -keystore "%QN_KEY_DIR%\release.keystore" -storetype PKCS12 ^
  -alias sharpquest -keyalg RSA -keysize 2048 -validity 10000 -storepass %PW% -keypass %PW% ^
  -dname "CN=SHARP Quest Native sideload, O=personal" >nul 2>&1
if errorlevel 1 (
  echo  [오류] keytool이 서명 키를 만들지 못했습니다.
  exit /b 1
)
set "KS=%QN_KEY_DIR%\release.keystore"
> "%QN_KEY_DIR%\signing.properties" (
  echo # quest-native sideload signing key of this PC. Keep this folder; do not commit it.
  echo storeFile=%KS:\=/%
  echo storePassword=%PW%
  echo keyAlias=sharpquest
  echo keyPassword=%PW%
)
echo  서명 키를 만들었습니다. 이 폴더(%QN_KEY_DIR%^)를 지우지 마세요.
echo  다른 PC에서 빌드한 앱으로 바꿀 때는 헤드셋에서 앱을 한 번 지워야 합니다(docs/install-guide.md).
exit /b 0
