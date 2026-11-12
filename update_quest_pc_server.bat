@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title SHARP Quest PC 서버 업데이트

rem Quest 앱용 PC 서버에 필요한 파일만 GitHub의 최신본으로 바꾼다.
rem   서버: scripts\quest_media_server.py, run_quest_pc_server.bat
rem   PC 버튼 지정 페이지(/settings/bindings): scripts\quest_bindings_page.html, scripts\quest_bindings_page.js, quest-app\src\core\bindings.js
rem 다른 파일(직접 고친 대시보드 파일 등)은 건드리지 않는다.
rem 이 파일들을 직접 고쳤다면(스테이징한 것 포함) 덮어쓰지 않고 멈춘다. "직접 고친 것"은 지금 내용이 저장소에 올라간 적 있는 어느 버전과도 다른 경우다
rem (예전에 이 BAT로 받은 옛 최신본은 직접 고친 것이 아니므로 바꾼다). 작업 폴더의 파일만 바꾸고 git 스테이징은 남기지 않는다.
rem 이 BAT 자신도 직접 고치지 않았다면 최신으로 바꾼다(실행 중에는 덮지 않고, 맨 끝 한 줄에서 옮긴다).

set "FILES=scripts/quest_media_server.py run_quest_pc_server.bat scripts/quest_bindings_page.html scripts/quest_bindings_page.js quest-app/src/core/bindings.js"
set "SELF=update_quest_pc_server.bat"

echo ================================================================
echo  Quest PC 서버를 최신으로 바꿉니다
echo ================================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
    echo git을 찾지 못했습니다. Git for Windows를 설치한 뒤 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
    echo 이 폴더는 git 저장소가 아니라 자동으로 바꿀 수 없습니다.
    echo.
    pause
    exit /b 1
)

echo 최신 버전을 내려받는 중입니다...
git fetch origin main
if errorlevel 1 (
    echo 내려받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

echo 바꿔도 되는지 확인하는 중입니다...
set "DIRTY="
for %%f in (%FILES%) do call :check "%%f"
if not defined DIRTY goto restore
rem (괄호 블록 밖에서 출력한다: 파일 이름 뒤 "(스테이징)"의 괄호가 블록을 깨지 않게)
echo.
echo 서버 파일을 직접 고친 내용이 있어 바꾸지 않았습니다. 덮어쓰면 고친 내용이 사라집니다.
echo 직접 고친 파일:%DIRTY%
echo 개발 담당에게 알려 주세요.
echo.
pause
exit /b 1

:restore

git restore --source origin/main --worktree -- %FILES%
if errorlevel 1 (
    echo 서버 파일을 바꾸지 못했습니다. 개발 담당에게 위 메시지를 알려 주세요.
    echo.
    pause
    exit /b 1
)

rem 이 BAT 자신: 직접 고치지 않았고 최신과 다르면 새 내용을 옆 파일에 받아 둔다(옮기기는 맨 끝에서).
set "SELFNEW="
set "DIRTY="
call :check "%SELF%"
if not defined DIRTY call :prepare_self

echo.
echo 완료했습니다. 이제 run_quest_pc_server.bat를 다시 실행하세요.
echo (서버 창이 이미 열려 있으면 닫고 다시 실행해야 새 버전이 적용됩니다.)
echo.
pause
rem 이 줄은 한 번에 읽혀 실행된다: 자기 자신을 새 내용으로 옮긴 뒤 곧바로 끝낸다(뒤의 줄을 더 읽지 않는다).
if defined SELFNEW (move /y "%SELFNEW%" "%~f0" >nul 2>nul & exit /b 0)
exit /b 0

rem ── 이하 도우미 ────────────────────────────────────────────────────────────

:check
rem %1(경로)의 작업 폴더 파일·스테이징된 파일이 저장소에 올라간 적 있는 버전이면 통과, 아니면 DIRTY에 경로를 붙인다. 파일이 없으면 통과.
rem 줄 끝 변환(core.autocrlf) 설정에 따라 저장소 내용과 작업 파일의 해시가 달라질 수 있어, 변환한 해시와 그대로의 해시 중 하나라도 맞으면 통과.
set "HASH="
set "RAW="
if exist "%~1" for /f %%h in ('git hash-object -- "%~1"') do set "HASH=%%h"
if exist "%~1" for /f %%h in ('git hash-object --no-filters -- "%~1"') do set "RAW=%%h"
if not defined HASH goto check_index
call :known "%~1" "%HASH%"
if not defined KNOWN call :known "%~1" "%RAW%"
if not defined KNOWN set "DIRTY=%DIRTY% %~1"
:check_index
set "HASH="
for /f "tokens=2" %%h in ('git ls-files -s -- "%~1"') do set "HASH=%%h"
if defined HASH (
    call :known "%~1" "%HASH%"
    if not defined KNOWN set "DIRTY=%DIRTY% %~1[스테이징]"
)
goto :eof

:known
rem 내용 해시 %2가 HEAD 또는 origin/main 이력의 어느 버전과 같으면 KNOWN=1.
set "KNOWN="
for /f %%b in ('git rev-parse -q --verify "HEAD:%~1" 2^>nul') do if /i "%%b"=="%~2" set "KNOWN=1"
if defined KNOWN goto :eof
for /f %%c in ('git rev-list origin/main -- "%~1"') do (
    for /f %%b in ('git rev-parse -q --verify "%%c:%~1" 2^>nul') do if /i "%%b"=="%~2" set "KNOWN=1"
)
goto :eof

:prepare_self
set "LATEST="
for /f %%b in ('git rev-parse -q --verify "origin/main:%SELF%" 2^>nul') do set "LATEST=%%b"
if not defined LATEST goto :eof
set "CURRENT="
set "CURRENTRAW="
for /f %%h in ('git hash-object -- "%SELF%"') do set "CURRENT=%%h"
for /f %%h in ('git hash-object --no-filters -- "%SELF%"') do set "CURRENTRAW=%%h"
if /i "%CURRENT%"=="%LATEST%" goto :eof
if /i "%CURRENTRAW%"=="%LATEST%" goto :eof
git cat-file blob origin/main:%SELF% > "%SELF%.new"
if errorlevel 1 (
    del /q "%SELF%.new" >nul 2>nul
    goto :eof
)
set "SELFNEW=%~dp0%SELF%.new"
goto :eof
