# Build signed Tauri release artifacts for the current platform.
# Loads the updater signing key from .tauri/ (+ 1Password password) like SaveVault.

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot

. (Join-Path $PSScriptRoot 'signing-key.ps1')
Initialize-SigningKey -WorkspaceRoot $workspace

if ([string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY)) {
    Write-Error "Missing TAURI_SIGNING_PRIVATE_KEY. Generate with:`n  npx tauri signer generate -w .tauri/redump-dat-filter.key"
}

if ([string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
    Write-Host "Warning: TAURI_SIGNING_PRIVATE_KEY_PASSWORD is empty (ok only if the key has no password)." -ForegroundColor DarkYellow
}

Set-Location $workspace
npm run tauri -- build @args
