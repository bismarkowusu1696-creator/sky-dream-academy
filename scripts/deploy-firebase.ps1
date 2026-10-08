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
  foreach ($path in @(
    "functions/security-hardening-loader.js",
    "functions/enterprise-admin-loader.js",
    "functions/academic-portal-loader.js",
    "functions/registration-desk-operations.js"
  )) {
    & node --check $path
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $path" }
  }
  & node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"
  if ($LASTEXITCODE -ne 0) { throw "Invalid firestore.indexes.json" }

  Write-Host "Deploying Firebase functions, rules, and required indexes..."
  & firebase deploy --project skydream-academy --only "functions,firestore:rules,firestore:indexes"
  if ($LASTEXITCODE -ne 0) { throw "Firebase deployment did not complete. Check the error above." }
  Write-Host "Firebase deployment succeeded. Check indexing status in Firebase Console before testing newest-first messages."
} finally {
  Pop-Location
}
