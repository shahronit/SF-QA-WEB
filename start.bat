@echo off
title QA Studio
echo ==========================================
echo   QA Studio - Starting...
echo ==========================================
echo.

cd /d "%~dp0"

:: Check Node.js for frontend build
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Node.js not found - skipping frontend build.
    echo        Using existing static/ files if available.
    goto :skip_build
)

:: Build frontend
echo [1/3] Building frontend...
cd frontend
call npm install --silent 2>nul
call npm run build
if %errorlevel% neq 0 (
    echo [WARN] Frontend build failed - using existing static/ files.
    cd ..
    goto :skip_build
)
cd ..

:: Copy build output to backend/static
echo [2/3] Copying to backend...
if exist backend\static rmdir /s /q backend\static
xcopy frontend\dist backend\static /e /i /q >nul

:skip_build

:: Check Python venv
if not exist backend\venv (
    echo [INFO] Creating Python virtual environment...
    cd backend
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
    cd ..
) else (
    call backend\venv\Scripts\activate.bat
)

:: Start server
echo.
echo [3/3] Starting server on http://localhost:8080
echo.
echo ==========================================
echo   Open http://localhost:8080 in browser
echo   Press Ctrl+C to stop
echo ==========================================
echo.
cd backend
uvicorn main:app --host 0.0.0.0 --port 8080
