# Installs the release APK onto an attached Android device and checks the parts
# that only exist on real hardware: the plugin loading, the foreground service,
# and the BLE advertiser actually starting.
#
# Non-destructive by default - `adb install -r` keeps existing app data, so a
# phone already paired stays paired. Pass -Fresh to wipe it first.
#
#   powershell -ExecutionPolicy Bypass -File scripts\verify-on-device.ps1

param([switch]$Fresh)
$ErrorActionPreference = "Stop"

$proj = Split-Path -Parent $PSScriptRoot
$adb = "$env:USERPROFILE\.fbms-android\sdk\platform-tools\adb.exe"
$apk = "$proj\release\Nestly-release.apk"
$pkg = "family.nestly.app"

if (-not (Test-Path $adb)) { throw "adb not found at $adb" }
if (-not (Test-Path $apk)) { throw "No APK at $apk - run the release build first." }

$devices = & $adb devices | Select-String "\tdevice$"
if (-not $devices) { throw "No device attached. Enable USB debugging and reconnect." }
Write-Host "Device: $($devices -join ', ')"

if ($Fresh) {
  Write-Host "Clearing app data (-Fresh)..." -ForegroundColor Yellow
  & $adb shell pm clear $pkg | Out-Null
}

Write-Host "Installing $(Split-Path -Leaf $apk)..."
& $adb install -r $apk
if ($LASTEXITCODE -ne 0) { throw "Install failed." }

# A fresh logcat buffer keeps the check to this run rather than history.
& $adb logcat -c
& $adb shell am start -n "$pkg/.MainActivity" | Out-Null
Start-Sleep -Seconds 6

Write-Host ""
Write-Host "=== crashes / plugin errors ===" -ForegroundColor Cyan
$log = & $adb logcat -d -t 400 2>&1 | Out-String
$bad = $log -split "`n" | Select-String -Pattern "FATAL EXCEPTION|AndroidRuntime.*$pkg|NestlyLink.*[Ee]rror|Capacitor.*[Ee]rror"
if ($bad) { $bad | Select-Object -First 12 } else { Write-Host "none" -ForegroundColor Green }

Write-Host ""
Write-Host "=== Nestly / BLE log lines ===" -ForegroundColor Cyan
$log -split "`n" | Select-String -Pattern "Nestly|BluetoothLeAdvertiser|BtGatt" | Select-Object -First 12

Write-Host ""
Write-Host "=== foreground service ===" -ForegroundColor Cyan
$svc = & $adb shell dumpsys activity services $pkg 2>&1 | Out-String
if ($svc -match "NestlyForegroundService") {
  Write-Host "running" -ForegroundColor Green
  ($svc -split "`n" | Select-String "isForeground|foregroundServiceType") | Select-Object -First 3
} else {
  Write-Host "not running (expected unless this phone is set up as the CHILD)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== web filter (VpnService) ===" -ForegroundColor Cyan
$pkgInfo = & $adb shell dumpsys package $pkg 2>&1 | Out-String
if ($pkgInfo -match "NestlyFilterService") {
  Write-Host "declared with BIND_VPN_SERVICE" -ForegroundColor Green
} else {
  Write-Host "NOT DECLARED - filtering cannot start" -ForegroundColor Red
}
# Be precise. Matching the package name anywhere in `dumpsys connectivity` is a
# false positive - it appears for unrelated reasons and reported "tunnel is up"
# when nothing was running. A real tunnel means our service is alive AND a tun
# interface is UP. `tunl0` is a stock IPIP device and never counts.
$svcRunning = (& $adb shell dumpsys activity services $pkg 2>&1 | Out-String) -match "NestlyFilterService"
$links = & $adb shell ip -o link 2>&1 | Out-String
$tunUp = ($links -split "`n" | Where-Object { $_ -match "tun" -and $_ -notmatch "tunl0" -and $_ -match "state UP|UP," }).Count -gt 0

if ($svcRunning -and $tunUp) {
  Write-Host "tunnel established and filtering" -ForegroundColor Green
} elseif ($svcRunning) {
  Write-Host "service running but no tun interface - establish() likely failed" -ForegroundColor Yellow
} else {
  Write-Host "not running (needs the child to accept the VPN prompt)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== usage access (special permission) ===" -ForegroundColor Cyan
$ops = & $adb shell "cmd appops get $pkg GET_USAGE_STATS" 2>&1 | Out-String
if ($ops -match "allow") {
  Write-Host "granted" -ForegroundColor Green
} else {
  Write-Host "not granted - per-app screen time unavailable until the child" -ForegroundColor Yellow
  Write-Host "  turns it on in Settings > Usage access" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== runtime permissions ===" -ForegroundColor Cyan
& $adb shell dumpsys package $pkg 2>&1 |
  Select-String -Pattern "ACCESS_FINE_LOCATION: granted|BLUETOOTH_SCAN: granted|BLUETOOTH_CONNECT: granted|BLUETOOTH_ADVERTISE: granted|POST_NOTIFICATIONS: granted"

Write-Host ""
Write-Host "Done. The app is on the device - drive it by hand for the rest." -ForegroundColor Green
