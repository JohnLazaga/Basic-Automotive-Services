# One-command deploy: rebuild, verify, commit, and push to GitHub Pages.
# Usage:  ./deploy.ps1            (uses a default commit message)
#         ./deploy.ps1 "message"  (custom commit message)
param([string]$msg = "Update Basic by JMSI app")

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "1/4  Building..." -ForegroundColor Cyan
node build.js
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

# The build writes each branch to dist/<slug>/ (git-ignored, for the mini-PC).
# GitHub Pages, however, serves the COMMITTED root folder <slug>/ — so the built
# app must be copied there or the live site never changes. Sync the branch(es)
# this deploy built into their served root folders before committing.
Write-Host "1b/4  Publishing built app into served folder(s)..." -ForegroundColor Cyan
$slug = "fairview"                               # deploy.ps1 builds the default (Fairview) branch
$src  = Join-Path $PSScriptRoot "dist/$slug"
$dst  = Join-Path $PSScriptRoot $slug
if (-not (Test-Path $src)) { throw "Build output '$src' not found - cannot publish." }
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
Write-Host "  Synced dist/$slug -> $slug/  (this is what GitHub Pages serves)" -ForegroundColor Green

Write-Host "2/4  Testing..." -ForegroundColor Cyan
node test.js
if ($LASTEXITCODE -ne 0) { throw "Acceptance tests failed - not deploying." }

Write-Host "3/4  Publishing to GitHub..." -ForegroundColor Cyan
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
