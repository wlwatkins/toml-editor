<#
.SYNOPSIS
    Builds the Windows installer.

.DESCRIPTION
    Type-checks, runs the unit suites, builds the SvelteKit bundle and packages
    it with Electron. The finished installer lands in release/.

    The packaging step stages under the OS temp directory rather than in the
    project: electron-builder renames a freshly unpacked ~200 MB directory into
    place, and a real-time scanner still holding those files makes that rename
    fail. See scripts/package.mjs.

.PARAMETER SkipChecks
    Skip svelte-check and the unit suites. Faster, but the artifact is unproven.

.PARAMETER Unpacked
    Produce release/win-unpacked only, without building the installer. Useful
    when you just want to run the packaged app.

.PARAMETER Reinstall
    Run npm install even if node_modules already exists.

.EXAMPLE
    scripts\build.ps1

.EXAMPLE
    scripts\build.ps1 -SkipChecks
#>
[CmdletBinding()]
param(
    [switch]$SkipChecks,
    [switch]$Unpacked,
    [switch]$Reinstall
)

$ErrorActionPreference = 'Stop'

if (-not $PSScriptRoot) {
    throw 'Run this as a script file, not by pasting its contents.'
}
. (Join-Path $PSScriptRoot 'common.ps1')

# This script lives in scripts/; everything it touches is one level up.
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Set-Location -LiteralPath $Root
$started = Get-Date

Write-Head 'TOML Editor - build'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithMessage 'Node.js was not found on your PATH. Install it from https://nodejs.org and try again.'
}

if ($Reinstall -or -not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
    Invoke-Checked 'Installing dependencies...' { npm install }
}

if ($SkipChecks) {
    Write-Warn 'Skipping type checks and tests (-SkipChecks).'
}
else {
    Invoke-Checked 'Type checking...' { npm run check }
    Invoke-Checked 'Running tests...' { npm test }
}

$version = Get-ProjectVersion -Root $Root

if ($Unpacked) {
    Invoke-Checked 'Building the app (unpacked)...' { npm run dist:dir }
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    Write-Host ''
    Write-Good "Built v$version in ${elapsed}s."
    Write-Step 'Unpacked app is in the staging directory named above.'
    Write-Host ''
    exit 0
}

Invoke-Checked 'Building the installer...' { npm run dist }

$installer = Get-InstallerPath -Root $Root -Version $version
if (-not (Test-Path -LiteralPath $installer)) {
    Stop-WithMessage "The build finished but $installer is missing."
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $installer).Length / 1MB, 1)
$elapsed = [int]((Get-Date) - $started).TotalSeconds

Write-Host ''
Write-Good "Built v$version in ${elapsed}s."
Write-Host "  $installer" -ForegroundColor Green
Write-Step "$sizeMb MB"
Write-Host ''
