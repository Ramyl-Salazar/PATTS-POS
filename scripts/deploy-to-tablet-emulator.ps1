$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
$adb = 'C:\Users\rmvsa\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$javaHome = 'C:\Program Files\Android\Android Studio\jbr'
$apk = 'C:\Users\rmvsa\AppData\Local\PATTS-POS\android-studio-build\app\outputs\apk\debug\app-debug.apk'

& "$PSScriptRoot\start-tablet-emulator.ps1"

Push-Location $projectRoot
try {
    & $node 'build.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }

    & $node 'node_modules/@capacitor/cli/bin/capacitor' 'sync' 'android'
    if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }

    $env:JAVA_HOME = $javaHome
    Push-Location 'android'
    try {
        & '.\gradlew.bat' ':app:assembleDebug'
        if ($LASTEXITCODE -ne 0) { throw 'Android debug build failed.' }
    }
    finally {
        Pop-Location
    }

    & $adb -e install -r $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }

    & $adb -e shell am start -W -n 'ph.edu.patts.offlinepos/.MainActivity'
    if ($LASTEXITCODE -ne 0) { throw 'PATTS launch failed.' }
}
finally {
    Pop-Location
}
