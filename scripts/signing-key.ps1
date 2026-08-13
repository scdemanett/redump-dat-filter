# Resolve the minisign updater signing key + password into the environment so release
# builds sign the updater `.sig` without an interactive prompt. Dot-source, then call:
#
#   . (Join-Path $PSScriptRoot 'signing-key.ps1')
#   Initialize-SigningKey -WorkspaceRoot $workspace
#
# Private key: loaded from .tauri/redump-dat-filter.key (gitignored) unless already in env.
# Password precedence (first hit wins):
#   1. $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD already set (e.g. a CI secret).
#   2. 1Password CLI — `op read` of $env:REDUMP_DAT_FILTER_OP_PASSWORD_REF
#      (set this to your op://… item), using $env:OP_SERVICE_ACCOUNT_TOKEN.
#      A secret *reference* is not sensitive (it's a pointer); the secret never hits disk.
#   3. Gitignored plaintext fallback file .tauri/redump-dat-filter.key.pass.
#
# A missing key file is not an error here (Tauri just produces an unsigned build); the
# package script decides whether to require it.

function Initialize-SigningKey {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$WorkspaceRoot)

    $keyFile = Join-Path $WorkspaceRoot '.tauri\redump-dat-filter.key'
    if ((Test-Path $keyFile) -and [string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY)) {
        $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $keyFile -Raw)
    }

    # 1. Already provided (CI secret / explicit export) — nothing to do.
    if (-not [string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
        return
    }

    # 2. 1Password service account.
    $opRef = if ($env:REDUMP_DAT_FILTER_OP_PASSWORD_REF) {
        $env:REDUMP_DAT_FILTER_OP_PASSWORD_REF
    } else {
        # Override via REDUMP_DAT_FILTER_OP_PASSWORD_REF if your item path differs.
        'op://Development/Redump DAT Filter/h45hpkrdaxawvnuhnk62iutvge'
    }

    if (-not (Get-Command op -ErrorAction SilentlyContinue)) {
        Write-Host "1Password CLI (op) not on PATH; skipping 1Password lookup." -ForegroundColor DarkYellow
    } elseif ([string]::IsNullOrEmpty($env:OP_SERVICE_ACCOUNT_TOKEN)) {
        Write-Host "OP_SERVICE_ACCOUNT_TOKEN not set in this shell; skipping 1Password lookup (restart the terminal if it was set recently)." -ForegroundColor DarkYellow
    }

    if ((Get-Command op -ErrorAction SilentlyContinue) -and
        -not [string]::IsNullOrEmpty($env:OP_SERVICE_ACCOUNT_TOKEN)) {
        try {
            $pw = (& op read $opRef 2>$null)
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrEmpty($pw)) {
                $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ([string]$pw).TrimEnd("`r", "`n")
                Write-Host "Signing-key password loaded from 1Password ($opRef)." -ForegroundColor DarkGray
                return
            }
            Write-Host "1Password: could not read $opRef (op exit $LASTEXITCODE); trying file fallback." -ForegroundColor DarkYellow
        } catch {
            Write-Host "1Password lookup failed ($($_.Exception.Message)); trying file fallback." -ForegroundColor DarkYellow
        }
    }

    # 3. Gitignored plaintext fallback.
    $passFile = Join-Path $WorkspaceRoot '.tauri\redump-dat-filter.key.pass'
    if (Test-Path $passFile) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content $passFile -Raw).TrimEnd("`r", "`n")
    }
}
