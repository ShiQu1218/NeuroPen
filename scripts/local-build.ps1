param(
    [switch]$LocalStt,
    [switch]$Gpu,
    [switch]$Bundle
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
    $env:CARGO_TARGET_DIR = "C:\np-target"
}

$builtExePath = Join-Path $env:CARGO_TARGET_DIR "release\neuropen.exe"
$runningLocalBuild = Get-Process neuropen -ErrorAction SilentlyContinue | Where-Object {
    try {
        $_.Path -eq $builtExePath
    } catch {
        $false
    }
}

if ($runningLocalBuild) {
    throw "Close '$builtExePath' before rebuilding. The current test build is still running."
}

$tauriArgs = @(
    "run",
    "tauri",
    "--",
    "build"
)

if (-not $Bundle) {
    $tauriArgs += "--no-bundle"
}

if ($Gpu) {
    $tauriArgs += @("--features", "local-stt-gpu")
} elseif ($LocalStt) {
    $tauriArgs += @("--features", "local-stt")
}

Write-Host ("[build] Using CARGO_TARGET_DIR={0}" -f $env:CARGO_TARGET_DIR)
Write-Host ("[build] Running: npm {0}" -f ($tauriArgs -join " "))

& npm @tauriArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
