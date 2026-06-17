@echo off
setlocal

REM Wrapper to run provider distribution service from Task Scheduler
set "PROJECT_DIR=C:\Users\Hp\Desktop\Projects\NIBTera-MicroCredit"
set "LOG_DIR=%PROJECT_DIR%\logs"

	if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
	if not exist "%PROJECT_DIR%\dist" mkdir "%PROJECT_DIR%\dist"

	rem Create a unique run-specific log filename to avoid file locks
	set "RUN_ID=%RANDOM%"
	set "RUN_LOG=%LOG_DIR%\scheduler-output-%RUN_ID%.log"
	set "TMP_LOG=C:\Temp\provider-distribution-run-%RUN_ID%.log"
	set "LOCK_DIR=%LOG_DIR%\provider-distribution.lock"

	echo [%date% %time%] Task started (pid=%PROCESSID%) >> "%RUN_LOG%"
	rem Also write a fallback marker to C:\Temp for Task Scheduler visibility
	if not exist "C:\Temp" mkdir "C:\Temp"
	echo [%date% %time%] Task started (pid=%PROCESSID%) >> "%TMP_LOG%"

	rem Prevent multiple instances (common cause of Task Scheduler manual-run errors)
	2>nul mkdir "%LOCK_DIR%"
	if errorlevel 1 (
		echo [%date% %time%] Another instance appears to be running. Exiting. >> "%RUN_LOG%"
		echo [%date% %time%] Another instance appears to be running. Exiting. >> "%TMP_LOG%"
		exit /b 0
	)

cd /d "%PROJECT_DIR%"

REM Build worker if missing
	if not exist "%PROJECT_DIR%\dist\worker.cjs" (
		echo [%date% %time%] Building worker bundle... >> "%RUN_LOG%"
		call npm run build:worker >> "%RUN_LOG%" 2>&1
		echo [%date% %time%] Build finished. >> "%RUN_LOG%"
	)

	echo [%date% %time%] Launching provider distribution one-off... >> "%RUN_LOG%"
	echo [%date% %time%] Launching provider distribution one-off... >> "%TMP_LOG%"
	"C:\Program Files\nodejs\node.exe" "%PROJECT_DIR%\dist\worker.cjs" provider-distribution >> "%RUN_LOG%" 2>&1
	if %ERRORLEVEL% neq 0 echo [%date% %time%] Worker exited with code %ERRORLEVEL% >> "%TMP_LOG%"

	rem If the worker exits, release the lock
	2>nul rmdir "%LOCK_DIR%"

endlocal
