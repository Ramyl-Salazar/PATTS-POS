$ErrorActionPreference = 'Stop'

$emulator = 'C:\Users\rmvsa\AppData\Local\Android\Sdk\emulator\emulator.exe'
$adb = 'C:\Users\rmvsa\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$avdName = 'PATTS_SM_X110'

& "$PSScriptRoot\start-nfc-reader-bridge.ps1"

$emulatorConnected = & $adb devices | Select-String '^emulator-\d+\s+device$'
if (-not $emulatorConnected) {
    # Keep the emulator window visible because it is the interactive test tablet.
    Start-Process -FilePath $emulator -ArgumentList @('-avd', $avdName)
}

& $adb -e wait-for-device

$deadline = [DateTime]::UtcNow.AddMinutes(3)
do {
    $bootComplete = (& $adb -e shell getprop sys.boot_completed 2>$null).Trim()
    if ($bootComplete -eq '1') {
        Write-Host "$avdName is ready at 800x1340 / 213 dpi."
        exit 0
    }
    Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $deadline)

throw "$avdName did not finish booting within three minutes."
