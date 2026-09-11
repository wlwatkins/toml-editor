<#
.SYNOPSIS
    The entry point behind run.cmd: a menu of the things you can do here.

.DESCRIPTION
    With no arguments it shows a menu and keeps showing it until you quit, so
    you can build and then publish without relaunching.

    With arguments it skips the menu:

        run.cmd run [args]        -> run.ps1
        run.cmd build [args]      -> build.ps1
        run.cmd publish [args]    -> publish.ps1
        run.cmd -File x.toml      -> run.ps1 -File x.toml

    The last form is there because that is how the launcher was documented
    before the menu existed.

.PARAMETER Action
    run, build, publish, or a switch belonging to run.ps1.

.PARAMETER Rest
    Everything else, forwarded to the chosen script untouched.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)] [string]$Action,
    [Parameter(ValueFromRemainingArguments = $true)] [string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'

if (-not $PSScriptRoot) {
    throw 'Run this as a script file, not by pasting its contents.'
}

# This script lives in scripts/; everything it touches is one level up.
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path


# The sub-scripts pause on failure so a double-clicked window stays readable.
# Launched from the menu that is the menu's job, so ask them not to.
$env:TOML_EDITOR_NO_PAUSE = '1'

# The host running this script, so a child gets the same PowerShell.
$psExe = try { (Get-Process -Id $PID).Path } catch { $null }
if (-not $psExe) { $psExe = 'powershell' }

function Invoke-Script {
    param([string]$Name, [string[]]$Arguments = @())

    $path = Join-Path $PSScriptRoot $Name
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Host ''
        Write-Host "  $Name is missing." -ForegroundColor Red
        Write-Host ''
        $global:LASTEXITCODE = 1
        return
    }

    # A child PowerShell rather than `& $path @Arguments`. Splatting an *array*
    # binds positionally, so a forwarded `-DryRun` would land on the first
    # positional parameter instead of being read as a switch. Passing them to a
    # native command puts them through the normal command-line parser.
    #
    # Nothing is returned on purpose: a function's success-stream output is its
    # return value, so returning the exit code here would swallow everything the
    # child printed. Callers read $LASTEXITCODE instead.
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $path @Arguments
}

# ---------------------------------------------------------------------------
# Non-interactive: a verb, or run.ps1 switches
# ---------------------------------------------------------------------------

if ($Action) {
    switch -Regex ($Action) {
        '^run$' { Invoke-Script 'run.ps1' $Rest; exit $LASTEXITCODE }
        '^build$' { Invoke-Script 'build.ps1' $Rest; exit $LASTEXITCODE }
        '^publish$' { Invoke-Script 'publish.ps1' $Rest; exit $LASTEXITCODE }
        '^menu$' { break }
        default { Invoke-Script 'run.ps1' (@($Action) + $Rest); exit $LASTEXITCODE }
    }
}

# ---------------------------------------------------------------------------
# The menu
# ---------------------------------------------------------------------------

$choices = @(
    @{ Key = '1'; Name = 'Run'; Detail = 'debug mode: dev server + app, DevTools open'; Script = 'run.ps1'; Arguments = @() }
    @{ Key = '2'; Name = 'Run in browser'; Detail = 'dev server only, opens your browser'; Script = 'run.ps1'; Arguments = @('-Browser') }
    @{ Key = '3'; Name = 'Build'; Detail = 'check, test and package the installer'; Script = 'build.ps1'; Arguments = @() }
    @{ Key = '4'; Name = 'Publish (dry run)'; Detail = 'show what a release would do, change nothing'; Script = 'publish.ps1'; Arguments = @('-DryRun') }
    @{ Key = '5'; Name = 'Publish'; Detail = 'bump, tag and release to GitHub'; Script = 'publish.ps1'; Arguments = @() }
)

function Show-Menu {
    $version = try {
        (Get-Content -Raw -LiteralPath (Join-Path $Root 'package.json') | ConvertFrom-Json).version
    }
    catch { $null }

    Write-Host ''
    Write-Host '  TOML Editor' -ForegroundColor Cyan -NoNewline
    if ($version) { Write-Host "  v$version" -ForegroundColor DarkGray } else { Write-Host '' }
    Write-Host ''

    foreach ($choice in $choices) {
        Write-Host '   [' -NoNewline -ForegroundColor DarkGray
        Write-Host $choice.Key -NoNewline -ForegroundColor Cyan
        Write-Host '] ' -NoNewline -ForegroundColor DarkGray
        Write-Host $choice.Name.PadRight(18) -NoNewline
        Write-Host $choice.Detail -ForegroundColor DarkGray
    }
    Write-Host '   [' -NoNewline -ForegroundColor DarkGray
    Write-Host 'Q' -NoNewline -ForegroundColor Cyan
    Write-Host '] ' -NoNewline -ForegroundColor DarkGray
    Write-Host 'Quit'
    Write-Host ''
}

try {
    $Host.UI.RawUI.WindowTitle = 'TOML Editor'
}
catch { }

for (;;) {
    Show-Menu
    $answer = (Read-Host '  Choose [1]').Trim()
    if (-not $answer) { $answer = '1' }

    if ($answer -match '^(q|quit|exit|0)$') {
        Write-Host ''
        break
    }

    $choice = $choices | Where-Object { $_.Key -eq $answer } | Select-Object -First 1
    if (-not $choice) {
        Write-Host ''
        Write-Host "  '$answer' is not one of the options." -ForegroundColor Yellow
        continue
    }

    Write-Host ''
    Write-Host "  -> $($choice.Name)" -ForegroundColor DarkGray

    Invoke-Script $choice.Script $choice.Arguments
    $code = $LASTEXITCODE

    Write-Host ''
    if ($code -and $code -ne 0) {
        Write-Host "  $($choice.Name) failed (exit code $code)." -ForegroundColor Red
    }
    else {
        Write-Host "  $($choice.Name) finished." -ForegroundColor Green
    }
    Read-Host '  Press Enter for the menu' | Out-Null
    Clear-Host
}
