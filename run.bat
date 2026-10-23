@echo off
setlocal
echo ========================================================
echo   Law.AI — Iniciando Servidor Node.js 22 & TypeScript 5
echo   Acesse: http://localhost:8000/
echo ========================================================
call npm run build
call npm start
pause

