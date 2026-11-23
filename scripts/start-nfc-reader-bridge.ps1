$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
$bridge = Join-Path $PSScriptRoot 'nfc-reader-bridge.mjs'
$logDirectory = Join-Path $env:LOCALAPPDATA 'PATTS-POS'
$stdout = Join-Path $logDirectory 'nfc-reader-bridge.log'
$stderr = Join-Path $logDirectory 'nfc-reader-bridge-error.log'

function Get-BridgeStatus {
    try {
        return Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status' -Headers @{ 'X-PATTS-Bridge' = 'patts-emulator-v1' } -TimeoutSec 1
    }
    catch {
        return $null
    }
}

$status = Get-BridgeStatus
if (-not $status) {
    New-Item -ItemType Directory -Force $logDirectory | Out-Null
    Start-Process -FilePath $node -ArgumentList $bridge -WorkingDirectory $projectRoot `
        -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr

    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 250
        $status = Get-BridgeStatus
    } while (-not $status -and [DateTime]::UtcNow -lt $deadline)
}

if (-not $status) {
    throw "The NFC-X bridge did not start. Check $stderr"
}

if ($status.connected) {
    Write-Host "NFC-X bridge ready: $($status.reader)"
} else {
    Write-Host 'NFC-X bridge ready; connect the reader to this PC.'
}
