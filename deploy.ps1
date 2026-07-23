# One-command deploy: rebuild EVERY served branch, verify, commit, and push to GitHub Pages.
# Usage:  ./deploy.ps1            (uses a default commit message)
#         ./deploy.ps1 "message"  (custom commit message)
#
# How publishing works (read this before "fixing" it):
#   * build.js writes each branch to dist/<slug>/ (git-ignored, for the mini-PC)
#     AND to the COMMITTED root folder <slug>/ — the latter is what GitHub Pages
#     actually serves at /<slug>/. dist/ can NEVER reach Pages.
#   * So publishing = build every served branch, then `git add -A && push`.
#   * The set of served branches is derived from branches.json (any branch whose
#     publicUrl is on the domain, i.e. not localhost). Add a branch there and it
#     is deployed automatically — nothing here to update.

param([string]$msg = "Update Basic by JMSI app")

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# Served branches = every branches.json entry NOT served from localhost.
$cfg   = Get-Content (Join-Path $PSScriptRoot 'branches.json') -Raw | ConvertFrom-Json
$slugs = @($cfg.PSObject.Properties | Where-Object { $_.Value.publicUrl -notmatch 'localhost' } | ForEach-Object { $_.Name })
# Build Fairview first: as the default branch it also emits _bundle.js /
# BASIC_by_JMSI_System.html, which `node test.js` runs against.
$slugs = @('fairview') + @($slugs | Where-Object { $_ -ne 'fairview' })

Write-Host ("1/3  Building " + $slugs.Count + " served branch(es): " + ($slugs -join ', ')) -ForegroundColor Cyan
foreach ($s in $slugs) {
  node build.js --branch=$s
  if ($LASTEXITCODE -ne 0) { throw "Build failed for branch '$s'." }
}

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
