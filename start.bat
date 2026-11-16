@echo off
rem Cinémathèque : met à jour depuis git, prépare et lance le serveur.
rem   start.bat             mise à jour + lancement
rem   start.bat --sans-maj  lancement sans git pull
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Cinémathèque

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js est introuvable. Installer Node 22 ou plus : winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)

echo.
echo   Cinémathèque : préparation
node scripts\prepare.mjs %*
if errorlevel 1 (
  echo   La préparation a échoué, voir ci-dessus.
  pause
  exit /b 1
)

call npm.cmd start
if errorlevel 1 pause
