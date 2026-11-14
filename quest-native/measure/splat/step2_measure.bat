@echo off
rem step2_app.bat 이 조건마다 부른다(따로 실행하지 않는다). ADB, OUT 은 부르는 쪽에서 정한다.
rem %1 = splat 상한(0 = 전체), %2 = 해상도 배율, %3 = 이름표. label·goto 없음(step2_app.bat 첫머리 참고).
echo   - splat 상한 %1, 배율 %2
"%ADB%" shell setprop debug.qnsplat.scale %2
"%ADB%" shell setprop debug.qnsplat.budget %1
powershell -NoProfile -Command "Start-Sleep -Seconds 12"
"%ADB%" logcat -c
"%ADB%" shell setprop debug.qnsplat.measure %3
powershell -NoProfile -Command "Start-Sleep -Seconds 33"
"%ADB%" logcat -d -s VrApi:I QNSplat:I QuestNative:I > "%OUT%\app_%3.txt"
python -I "%~dp0vrapi_fps_summary.py" "%OUT%\app_%3.txt" 3
exit /b 0
