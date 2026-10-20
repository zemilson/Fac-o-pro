@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale Node.js LTS para executar o gerador.
  pause
  exit /b 1
)

node tools\license-admin\server.cjs
if errorlevel 1 pause
