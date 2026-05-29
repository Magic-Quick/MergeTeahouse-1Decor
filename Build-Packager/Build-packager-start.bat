@echo off
chcp 65001 >nul
echo =============================================
echo Build Package Tool v1.0.2
echo =============================================
echo.
echo Используйте файл Build-packager-config.txt для настройки параметров сборки.
echo Запускаем сборку с текущими настройками...
echo.
powershell -ExecutionPolicy Bypass -Command "& '%~dp0Build-packager-v1.0.2.ps1'"
echo.
pause