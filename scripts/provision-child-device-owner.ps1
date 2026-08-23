param(
  [string]$Package = "family.nestly.app",
  [string]$Receiver = "family.nestly.app.NestlyDeviceAdmin"
)

$ErrorActionPreference = "Stop"

Write-Host "Checking ADB..."
adb get-state | Out-Null
if ($LASTEXITCODE -ne 0) { throw "No Android device is available through ADB." }

Write-Host "Provisioning Nestly as Android Device Owner..."
adb shell dpm set-device-owner "$Package/$Receiver"
if ($LASTEXITCODE -ne 0) {
  throw "Device Owner provisioning failed. The test handset normally needs to be factory-reset and have no existing managed account/device owner."
}

Write-Host "Device Owner provisioning succeeded."
adb shell dpm list-owners
