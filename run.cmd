@echo off
rem Double-click target. Windows opens .ps1 files in an editor rather than
rem running them, so this wrapper launches run.ps1 properly.
rem Any arguments are passed through, e.g.  run.cmd -File C:\tools\config.toml
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
