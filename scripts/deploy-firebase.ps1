param()
$ErrorActionPreference = "Stop"
Write-Host "Checking SkyDream backend source..."
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  throw "Firebase CLI is not installed. Run: npm install -g firebase-tools"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required before deploying Cloud Functions."
}
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  Write-Host "Running full SkyDream local validation..."
  & node "scripts/validate-local.js"
  if ($LASTEXITCODE -ne 0) { throw "SkyDream validation failed. Firebase deployment was stopped safely." }

  Write-Host "Deploying Firebase functions, rules, and required indexes..."
  & firebase deploy --project skydream-academy --only "functions,firestore:rules,firestore:indexes"
  if ($LASTEXITCODE -ne 0) { throw "Firebase deployment did not complete. Check the error above." }
  Write-Host "Firebase deployment succeeded. Check indexing status in Firebase Console before testing newest-first messages."
} finally {
  Pop-Location
}
