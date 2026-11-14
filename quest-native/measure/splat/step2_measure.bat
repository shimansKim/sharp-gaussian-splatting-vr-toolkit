@echo off
rem Called by step2_app.bat: budget, scale, tag. ADB and OUT come from the caller.
rem Deliberately ASCII and label-free. Do not run this helper by itself.
echo   - splat budget %1, scale %2
"%ADB%" shell setprop debug.qnsplat.scale %2
"%ADB%" shell setprop debug.qnsplat.budget %1
powershell -NoProfile -Command "Start-Sleep -Seconds 12"
"%ADB%" logcat -c
"%ADB%" shell setprop debug.qnsplat.measure %3
powershell -NoProfile -Command "Start-Sleep -Seconds 33"
"%ADB%" logcat -d -s VrApi:I QNSplat:I QuestNative:I > "%OUT%\app_%3.txt"
python -I "%~dp0vrapi_fps_summary.py" "%OUT%\app_%3.txt" 3
exit /b 0
