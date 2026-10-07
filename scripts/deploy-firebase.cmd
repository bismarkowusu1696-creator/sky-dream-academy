@echo off
setlocal
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI is not installed. Run: npm install -g firebase-tools
  exit /b 1
)
call npm install --prefix functions
if errorlevel 1 exit /b 1
firebase deploy --project skydream-academy --only functions,firestore:rules --non-interactive
if errorlevel 1 exit /b 1
firebase deploy --project skydream-academy --only firestore:indexes --non-interactive
if errorlevel 1 exit /b 1
echo Firebase backend deployment completed successfully.
