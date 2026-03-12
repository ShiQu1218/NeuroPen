param(
    [switch]$RequireGpuToolchain
)

$ErrorActionPreference = "Stop"

$expectedNodeVersion = [Version]"24.14.0"
$expectedNodeMajor = 24
$expectedNpmVersion = [Version]"11.9.0"
$expectedNpmMajor = 11
$expectedRustVersion = [Version]"1.93.1"

function Write-Check {
    param(
        [string]$Label,
        [string]$Message
    )

    Write-Host ("[check] {0}: {1}" -f $Label, $Message)
}

function Parse-Version {
    param([string]$RawValue)

    $normalized = $RawValue.Trim()
    if ($normalized.StartsWith("v")) {
        $normalized = $normalized.Substring(1)
    }
    return [Version]$normalized
}

function Parse-RustVersion {
    param([string]$RawValue)

    $parts = $RawValue.Trim().Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
    if ($parts.Length -lt 2) {
        throw "Unable to parse Rust version from '$RawValue'."
    }
    return [Version]$parts[1]
}

if ($env:OS -ne "Windows_NT") {
    throw "NeuroPen development is supported on Windows only."
}
Write-Check "OS" "Windows detected"

$nodeVersion = Parse-Version (node -v)
if ($nodeVersion.Major -ne $expectedNodeMajor -or $nodeVersion -lt $expectedNodeVersion) {
    throw "Node.js $expectedNodeVersion or newer within major $expectedNodeMajor is required. Found $nodeVersion."
}
Write-Check "Node.js" $nodeVersion.ToString()

$npmVersion = Parse-Version (npm -v)
if ($npmVersion.Major -ne $expectedNpmMajor -or $npmVersion -lt $expectedNpmVersion) {
    throw "npm $expectedNpmVersion or newer within major $expectedNpmMajor is required. Found $npmVersion."
}
Write-Check "npm" $npmVersion.ToString()

$rustcVersion = Parse-RustVersion (rustc -V)
if ($rustcVersion -ne $expectedRustVersion) {
    throw "rustc $expectedRustVersion is required by rust-toolchain.toml. Found $rustcVersion."
}
Write-Check "rustc" $rustcVersion.ToString()

$cargoVersion = Parse-RustVersion (cargo -V)
if ($cargoVersion -ne $expectedRustVersion) {
    throw "cargo $expectedRustVersion is required by rust-toolchain.toml. Found $cargoVersion."
}
Write-Check "cargo" $cargoVersion.ToString()

if (-not (Test-Path "package-lock.json")) {
    throw "package-lock.json is required. Use npm ci instead of npm install."
}
Write-Check "Lockfile" "package-lock.json present"

$vulkanSdk = $env:VULKAN_SDK
if ([string]::IsNullOrWhiteSpace($vulkanSdk)) {
    if ($RequireGpuToolchain) {
        throw "VULKAN_SDK is not set. Install the Vulkan SDK before GPU builds."
    }
    Write-Check "Vulkan SDK" "Not configured (CPU/local-cloud builds remain available)"
} elseif (-not (Test-Path $vulkanSdk)) {
    throw "VULKAN_SDK points to '$vulkanSdk', but that path does not exist."
} else {
    Write-Check "Vulkan SDK" $vulkanSdk
}

Write-Check "Result" "Environment looks consistent"
