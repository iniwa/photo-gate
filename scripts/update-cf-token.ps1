# Cloudflare API トークンをローカルのトークンファイルへ安全に保存する。
#
# 使い方:
#   powershell -ExecutionPolicy Bypass -File scripts\update-cf-token.ps1
#
# - 入力は SecureString(マスク表示)なので、画面・コンソール履歴・
#   セッションログのどこにもトークン値が残らない。
# - 保存後に /user/tokens/verify で有効性を確認する(値は表示しない)。
# - トークンファイルの場所: %USERPROFILE%\.photo-gate-cf-token
#   (リポジトリ外。リポジトリにトークンを置かないこと。)

$ErrorActionPreference = 'Stop'

$tokenPath = Join-Path $env:USERPROFILE '.photo-gate-cf-token'

$secure = Read-Host -AsSecureString 'Cloudflare API トークンを貼り付けて Enter(表示されません)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Error '空の入力です。トークンを貼り付けてください。'
    exit 1
}

[IO.File]::WriteAllText($tokenPath, $token)
Write-Host "保存しました: $tokenPath"

try {
    $resp = Invoke-RestMethod -Uri 'https://api.cloudflare.com/client/v4/user/tokens/verify' `
        -Headers @{ Authorization = "Bearer $token" } -Method Get
    Write-Host "検証結果: success=$($resp.success) status=$($resp.result.status)"
    if (-not $resp.success -or $resp.result.status -ne 'active') { exit 1 }
} catch {
    Write-Host '検証結果: 無効なトークンです (401)。値を確認してください。'
    exit 1
}
