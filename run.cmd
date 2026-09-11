@echo off
rem Double-click target. Windows opens .ps1 files in an editor rather than
rem running them, so this wrapper launches the menu properly.
rem
rem   run.cmd                     menu: run, build or publish
rem   run.cmd run                 debug mode
rem   run.cmd build               build the installer
rem   run.cmd publish             cut a release
rem   run.cmd -File C:\x.toml     debug mode, opening that file
rem
rem All argument handling lives in scripts\menu.ps1; batch just forwards.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\menu.ps1" %*
