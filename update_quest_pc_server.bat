@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title SHARP Quest PC 서버 업데이트

rem Quest 앱용 PC 서버 파일 두 개(scripts\quest_media_server.py, run_quest_pc_server.bat)만 GitHub의 최신본으로 바꾼다.
rem 다른 파일(직접 고친 대시보드 파일 등)은 건드리지 않는다. 이 두 파일을 직접 고쳤다면(스테이징한 것 포함) 덮어쓰지 않고 멈춘다.
rem 작업 폴더의 파일만 바꾸고 git 스테이징은 남기지 않는다.

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

rem 직접 고친 내용이 있으면 덮어쓰지 않는다. 작업 폴더·스테이징 모두 "저장소 기준본(HEAD)이거나 이미 최신본(origin/main)"이어야 한다.
set "DIRTY="
call :check "scripts/quest_media_server.py"
call :check "run_quest_pc_server.bat"
if defined DIRTY (
    echo 서버 파일을 직접 고친 내용이 있어 바꾸지 않았습니다. 덮어쓰면 고친 내용이 사라집니다.
    echo 개발 담당에게 알려 주세요.
    echo.
    pause
    exit /b 1
)

git restore --source origin/main --worktree -- scripts/quest_media_server.py run_quest_pc_server.bat
if errorlevel 1 (
    echo 서버 파일을 바꾸지 못했습니다. 개발 담당에게 위 메시지를 알려 주세요.
    echo.
    pause
    exit /b 1
)

echo.
echo 완료했습니다. 이제 run_quest_pc_server.bat를 다시 실행하세요.
echo (서버 창이 이미 열려 있으면 닫고 다시 실행해야 새 버전이 적용됩니다.)
echo.
pause
exit /b 0

:check
rem 작업 폴더 파일이 HEAD와 같거나 origin/main과 같으면 통과.
git diff --quiet HEAD -- %1
if not errorlevel 1 goto check_index
git diff --quiet origin/main -- %1
if errorlevel 1 set "DIRTY=1"
:check_index
rem 스테이징된 파일이 HEAD와 같거나 origin/main과 같으면 통과.
git diff --cached --quiet HEAD -- %1
if not errorlevel 1 goto :eof
git diff --cached --quiet origin/main -- %1
if errorlevel 1 set "DIRTY=1"
goto :eof
