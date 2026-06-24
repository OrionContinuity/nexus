@echo off
rem Double-click to open the NEXUS DevOps panel (GitHub + Supabase buttons).
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0devops-gui.ps1"
