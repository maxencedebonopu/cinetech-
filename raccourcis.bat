@echo off
rem Cinémathèque : crée le raccourci du Bureau et, au choix, le démarrage automatique.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js est introuvable. Installer Node 22 ou plus : winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)
echo.
echo   Cinémathèque : raccourcis
echo.
echo     1  Bureau + démarrage automatique à l'ouverture de session
echo     2  Bureau seulement
echo     3  Retirer les raccourcis
echo.
choice /c 123 /n /m "  Choix [1, 2 ou 3] : "
if errorlevel 3 (node scripts\raccourcis.mjs --retirer) else if errorlevel 2 (node scripts\raccourcis.mjs --sans-demarrage) else (node scripts\raccourcis.mjs)
echo.
pause
