<#
    Shared helpers for build.ps1 and publish.ps1.

    run.ps1 deliberately does not use these: it is the double-click entry point
    and stays self-contained so it cannot be broken by a missing sibling file.
#>

function Write-Head {
    param([string]$Text)
    Write-Host ''
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ''
}

function Write-Step {
    param([string]$Text)
    Write-Host "  $Text" -ForegroundColor DarkGray
}

function Write-Good {
    param([string]$Text)
    Write-Host "  $Text" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Text)
    Write-Host "  $Text" -ForegroundColor Yellow
}

function Stop-WithMessage {
    param([string]$Text, [switch]$NoPause)
    Write-Host ''
    Write-Host "  $Text" -ForegroundColor Red
    Write-Host ''
    # The menu does its own pausing, and sets this so the window is not stopped
    # twice on the way out.
    if (-not $NoPause -and -not $env:TOML_EDITOR_NO_PAUSE -and $Host.Name -eq 'ConsoleHost') {
        Read-Host '  Press Enter to close' | Out-Null
    }
    exit 1
}

<#
    Runs a native command and stops the script if it fails. Native commands do
    not raise terminating errors, so without this every call needs its own
    $LASTEXITCODE check and one will eventually be forgotten.
#>
function Invoke-Checked {
    param(
        [Parameter(Mandatory)] [string]$What,
        [Parameter(Mandatory)] [scriptblock]$Command
    )
    Write-Step $What
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Stop-WithMessage "$What failed (exit code $LASTEXITCODE). See the output above."
    }
}

<# Returns the version currently in package.json. #>
function Get-ProjectVersion {
    param([string]$Root)
    $packageFile = Join-Path $Root 'package.json'
    if (-not (Test-Path -LiteralPath $packageFile)) {
        Stop-WithMessage "No package.json found in $Root"
    }
    return (Get-Content -Raw -LiteralPath $packageFile | ConvertFrom-Json).version
}

function Get-InstallerPath {
    param([string]$Root, [string]$Version)
    # No spaces: GitHub rewrites them in asset names, and electron-updater
    # downloads whatever latest.yml says, which electron-builder derives from
    # artifactName in package.json. The three have to agree.
    return Join-Path $Root "release/TOML-Editor-Setup-$Version.exe"
}

<#
    Runs a command that is allowed to fail, returning its output and exit code
    instead of raising. Native commands write to stderr for ordinary conditions
    ("no tags yet"), and under $ErrorActionPreference = 'Stop' PowerShell turns
    that into a terminating error.
#>
function Invoke-Quiet {
    param(
        [Parameter(Mandatory)] [string]$Exe,
        [Parameter(ValueFromRemainingArguments)] [string[]]$Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = (& $Exe @Arguments 2>&1 | Out-String).Trim()
        return [pscustomobject]@{ Text = $output; ExitCode = $LASTEXITCODE; Ok = ($LASTEXITCODE -eq 0) }
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-GitQuiet {
    param([Parameter(ValueFromRemainingArguments)] [string[]]$Arguments = @())
    return Invoke-Quiet -Exe 'git' -Arguments $Arguments
}
