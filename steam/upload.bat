@echo off
rem Upload the packaged build to Steam. Requires steamcmd (Steamworks SDK: tools\ContentBuilder\builder\steamcmd.exe).
rem Usage: steam\upload.bat <steam_username>
cd /d %~dp0
steamcmd.exe +login %1 +run_app_build "%~dp0app_build.vdf" +quit
