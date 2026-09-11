<#
.SYNOPSIS
    Runs the TOML Editor desktop app in debug mode.

.DESCRIPTION
    Starts the Vite dev server and opens the Electron app against it, so the UI
    hot-reloads as you edit and DevTools is open from the start. A remote
    debugging port is exposed alongside, for attaching an external inspector.

    The dev server's port is derived from this folder's path, so it is the same
    every time and will not clash with other Svelte dev servers you have
    running. If another program has taken it, the next free port is used.

    Use -Browser to skip Electron and work in an ordinary browser instead --
    useful for the theme gallery, which the desktop window does not need.

.PARAMETER File
    Optional .toml file to open straight away.

.PARAMETER Browser
    Serve to a normal browser rather than launching the desktop app.

.PARAMETER NoDevTools
    Launch the app without opening DevTools.

.EXAMPLE
    .
un.ps1

.EXAMPLE
    .
un.ps1 -File C:	ools\config.toml

.EXAMPLE
    .
un.ps1 -Browser
#>
[CmdletBinding()]
param(
    [string]$File,
    [switch]$Browser,
    [switch]$NoDevTools
)

$ErrorActionPreference = 'Stop'

# Port range to pick from. Deliberately clear of the usual suspects
# (3000, 5173, 8080) so this never fights a default-configured dev server.
$PortRangeStart = 5200
$PortRangeSize = 700

function Write-Step {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor DarkGray
}

function Stop-WithMessage {
    param([string]$Message)
    Write-Host ''
    Write-Host "  $Message" -ForegroundColor Red
    Write-Host ''
    # Launched from the menu, the menu does the pausing.
    if (-not $env:TOML_EDITOR_NO_PAUSE) {
        Read-Host '  Press Enter to close' | Out-Null
    }
    exit 1
}

# A stable port for this folder: same project, same port, every time.
function Get-ProjectPort {
    param([string]$Seed)

    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
        $bytes = $md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Seed.ToLowerInvariant()))
    }
    finally {
        $md5.Dispose()
    }
    $value = [System.BitConverter]::ToUInt16($bytes, 0)
    return $PortRangeStart + ($value % $PortRangeSize)
}

# Asks Windows directly which ports are being listened on. Two approaches that
# look simpler are both wrong here: binding a test socket reports a busy port as
# free (a server on the IPv6 loopback leaves the IPv4 address bindable), and a
# timed connect attempt is a race that a cold process loses.
function Test-PortListening {
    param([int]$Port)

    $listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($null -ne $listening) {
        return $true
    }
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        return $false
    }

    # Very old Windows: fall back to connecting, with a timeout long enough
    # that a first-call DNS lookup cannot make a busy port look free.
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $handle = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if ($handle.AsyncWaitHandle.WaitOne(2000)) {
            try {
                $client.EndConnect($handle)
                return $true
            }
            catch { }
        }
        return $false
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ForServer {
    param([int]$Port, [int]$TimeoutSeconds = 90)

    # A raw TCP connect to the IPv4 loopback, which is exactly what the app will
    # do. Invoke-WebRequest is avoided here: it honours the system proxy, which
    # can swallow even a loopback request.
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $handle = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
            if ($handle.AsyncWaitHandle.WaitOne(500)) {
                try {
                    $client.EndConnect($handle)
                    return $true
                }
                catch { }
            }
        }
        catch { }
        finally { $client.Dispose() }
        Start-Sleep -Milliseconds 200
    }
    return $false
}

# Distinguishes "our editor is already up" from "something else has the port".
function Test-EditorResponding {
    param([int]$Port)

    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Port/" -TimeoutSec 3 -UseBasicParsing
        return $response.Content -like '*TOML Editor*'
    }
    catch {
        return $false
    }
}

# ---------------------------------------------------------------------------

if (-not $PSScriptRoot) {
    Stop-WithMessage 'Run this as a script file (scripts\run.ps1), not by pasting its contents.'
}
# This script lives in scripts/; everything it touches is one level up.
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Set-Location -LiteralPath $Root

Write-Host ''
Write-Host '  TOML Editor' -ForegroundColor Cyan
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithMessage 'Node.js was not found on your PATH. Install it from https://nodejs.org and try again.'
}

# Work out the URL to open before anything else, so a bad -File fails fast.
$openPath = '/'
if ($File) {
    if (-not (Test-Path -LiteralPath $File)) {
        Stop-WithMessage "No such file: $File"
    }
    $fullPath = (Resolve-Path -LiteralPath $File).Path
    if ([System.IO.Path]::GetExtension($fullPath) -notin '.toml', '.tml') {
        Stop-WithMessage "Not a TOML file: $fullPath"
    }
    $openPath = '/?file=' + [uri]::EscapeDataString($fullPath)
    Write-Step "Opening $fullPath"
}

$port = Get-ProjectPort -Seed $Root

if (Test-PortListening -Port $port) {
    if (Test-EditorResponding -Port $port) {
        Write-Step "Already running on port $port - opening that instead."
        Start-Process "http://localhost:$port$openPath"
        Write-Host ''
        exit 0
    }

    $taken = $port
    $port = $null
    foreach ($candidate in ($taken + 1)..($taken + 40)) {
        if (-not (Test-PortListening -Port $candidate)) {
            $port = $candidate
            break
        }
    }
    if (-not $port) {
        Stop-WithMessage "Ports $taken to $($taken + 40) are all in use. Close something and try again."
    }
    Write-Step "Port $taken is in use by another program, falling back to $port."
}

if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
    Write-Step 'Installing dependencies (first run only, this takes a minute)...'
    npm install
    if ($LASTEXITCODE -ne 0) {
        Stop-WithMessage 'npm install failed. See the output above.'
    }
}

# Name the window after the port, so several of these are tellable apart.
try { $Host.UI.RawUI.WindowTitle = "TOML Editor (debug) - port $port" } catch { }

# Vite is invoked directly rather than through `npm run dev -- ...` because
# PowerShell swallows the `--` separator, so npm would eat the flags instead of
# forwarding them. This is the same thing the `dev` script runs.
$vite = Join-Path $Root 'node_modules/vite/bin/vite.js'
if (-not (Test-Path -LiteralPath $vite)) {
    Stop-WithMessage 'Vite is not installed. Delete node_modules and run this again to reinstall.'
}

if ($Browser) {
    Write-Host "  Serving on " -NoNewline
    Write-Host "http://localhost:$port" -ForegroundColor Green
    Write-Step 'Your browser will open shortly. Press Ctrl+C here to stop the server.'
    Write-Host ''

    # --strictPort makes Vite fail loudly rather than drift to another port
    # behind our back, which would leave the browser on a dead URL.
    node $vite dev --port $port --strictPort --open $openPath
    if ($LASTEXITCODE -ne 0) {
        Stop-WithMessage "The dev server exited with code $LASTEXITCODE. See the output above."
    }
    Write-Host ''
    Write-Step 'Server stopped.'
    Write-Host ''
    exit 0
}

# ---------------------------------------------------------------------------
# Debug mode: dev server + the Electron app pointed at it.
# ---------------------------------------------------------------------------

$electron = Join-Path $Root 'node_modules/electron/dist/electron.exe'
if (-not (Test-Path -LiteralPath $electron)) {
    Stop-WithMessage 'Electron is not installed. Run "npm install" and try again.'
}

$inspectPort = $port + 1
while (Test-PortListening -Port $inspectPort) { $inspectPort++ }

Write-Host "  Dev server   " -NoNewline
Write-Host "http://localhost:$port" -ForegroundColor Green
Write-Host "  Inspector    " -NoNewline
Write-Host "http://localhost:$inspectPort" -ForegroundColor Green
Write-Step 'The app window opens once the dev server is up. Edits reload live.'
Write-Step 'Close the window, or press Ctrl+C here, to stop both.'
Write-Host ''

# --host 127.0.0.1 pins Vite to the IPv4 loopback. Left to itself it binds
# whatever "localhost" resolves to, which can be ::1 only -- and then the app,
# asking for 127.0.0.1, gets connection refused.
$server = Start-Process -FilePath 'node' `
    -ArgumentList @($vite, 'dev', '--port', $port, '--strictPort', '--host', '127.0.0.1') `
    -WorkingDirectory $Root -NoNewWindow -PassThru

try {
    # Wait for Vite to actually answer. Loading the window sooner leaves it on an
    # ERR_CONNECTION_REFUSED page, which does not retry by itself.
    if (-not (Wait-ForServer -Port $port)) {
        Stop-WithMessage 'The dev server did not come up. See the output above.'
    }

    # 127.0.0.1 rather than localhost: Vite binds the IPv4 loopback, while
    # Chromium may resolve "localhost" to ::1 and get connection refused.
    $env:TOML_EDITOR_DEV_URL = "http://127.0.0.1:$port/"
    if ($NoDevTools) { $env:TOML_EDITOR_NO_DEVTOOLS = '1' }

    $appArgs = @($Root, "--remote-debugging-port=$inspectPort")
    if ($fullPath) { $appArgs += $fullPath }

    # electron.exe is a GUI-subsystem binary, so the call operator does not wait
    # for it -- the script would race on to the finally block and kill the dev
    # server out from under the app. Start it and wait on the process itself.
    $app = Start-Process -FilePath $electron -ArgumentList $appArgs `
        -WorkingDirectory $Root -NoNewWindow -PassThru
    $app.WaitForExit()
    $appExit = $app.ExitCode
}
finally {
    Remove-Item Env:\TOML_EDITOR_DEV_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\TOML_EDITOR_NO_DEVTOOLS -ErrorAction SilentlyContinue
    if ($server -and -not $server.HasExited) {
        Write-Step 'Stopping the dev server...'
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
}

if ($appExit -ne 0) {
    Stop-WithMessage "The app exited with code $appExit. See the output above."
}

Write-Host ''
Write-Step 'Stopped.'
Write-Host ''
