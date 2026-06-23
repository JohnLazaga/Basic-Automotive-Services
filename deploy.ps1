# One-command deploy: rebuild, verify, commit, and push to GitHub Pages.
# Usage:  ./deploy.ps1            (uses a default commit message)
#         ./deploy.ps1 "message"  (custom commit message)
param([string]$msg = "Update Basic by JMSI app")

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "1/3  Building..." -ForegroundColor Cyan
node build.js
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

Write-Host "2/3  Testing..." -ForegroundColor Cyan
node test.js
if ($LASTEXITCODE -ne 0) { throw "Acceptance tests failed - not deploying." }

Write-Host "3/3  Publishing to GitHub..." -ForegroundColor Cyan
git add -A
# commit only if there are staged changes
$pending = git status --porcelain
if ([string]::IsNullOrWhiteSpace($pending)) {
  Write-Host "Nothing changed - working tree clean." -ForegroundColor Yellow
} else {
  git commit -m $msg
  git push
  Write-Host "Done. GitHub Pages will refresh in ~1 minute." -ForegroundColor Green
}
