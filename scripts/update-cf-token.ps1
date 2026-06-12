# Save a Cloudflare API token to the local token file, safely.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\update-cf-token.ps1
#
# - Input is read as a SecureString (masked), so the token value never
#   appears on screen, in console history, or in session logs.
# - After saving, the token is verified against /user/tokens/verify
#   (the value itself is never printed).
# - Token file location: %USERPROFILE%\.photo-gate-cf-token
#   (outside the repository; never commit token values).
#
# ASCII only: Windows PowerShell 5.1 reads BOM-less scripts as ANSI,
# which corrupts non-ASCII literals and broke a previous version.

$ErrorActionPreference = 'Stop'

$tokenPath = Join-Path $env:USERPROFILE '.photo-gate-cf-token'

$secure = Read-Host -AsSecureString 'Paste the Cloudflare API token and press Enter (input is hidden)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host 'ERROR: empty input. Paste the token and try again.'
    exit 1
}

[IO.File]::WriteAllText($tokenPath, $token)
Write-Host "Saved to: $tokenPath"

try {
    $resp = Invoke-RestMethod -Uri 'https://api.cloudflare.com/client/v4/user/tokens/verify' `
        -Headers @{ Authorization = "Bearer $token" } -Method Get
    Write-Host ("Verify: success={0} status={1}" -f $resp.success, $resp.result.status)
    if (-not $resp.success -or $resp.result.status -ne 'active') { exit 1 }
    exit 0
} catch {
    Write-Host 'Verify: INVALID token (401). Check the value and try again.'
    exit 1
}
