@echo off
rem Cinémathèque : met à jour depuis git, prépare et lance le serveur.
rem   start.bat             mise à jour + lancement
rem   start.bat --sans-maj  lancement sans git pull
rem   start.bat --sans-navigateur  sans ouvrir le navigateur (démarrage automatique)
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
rem le serveur ouvre le navigateur une fois prêt, sauf avec --sans-navigateur
set "CINE_OUVRIR=1"
echo.%* | find /i "--sans-navigateur" >nul && set "CINE_OUVRIR="
node scripts\prepare.mjs %*
rem 3 : déjà en marche (le navigateur a été ouvert sur la séance en cours)
if errorlevel 3 exit /b 0
if errorlevel 1 (
  echo   La préparation a échoué, voir ci-dessus.
  pause
  exit /b 1
)

call npm.cmd start
if errorlevel 1 pause
