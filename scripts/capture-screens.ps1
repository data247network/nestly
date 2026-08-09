# Captures real screenshots from a connected phone for the "How it works" guide.
#
# Real device captures rather than mocked frames on purpose: the guide is shown
# to parents to persuade them to buy, so every screen in it has to be a screen
# the app actually renders. A mockup that drifts from the build is worse than no
# guide at all.
#
# Usage:
#   powershell -File scripts\capture-screens.ps1 -Serial RRCX206CLTN -Role parent

param(
  [Parameter(Mandatory = $true)][string]$Serial,
  [ValidateSet('parent', 'child')][string]$Role = 'parent',
  [string]$OutDir = "docs\screens"
)
# Deliberately not 'Stop': adb writes its transfer progress to stderr, and
# PowerShell 5.1 wraps native stderr in an ErrorRecord, so every successful
# `adb pull` would abort the script. Exit codes are checked instead.
$ErrorActionPreference = 'Continue'

$adb = "$env:USERPROFILE\.fbms-android\sdk\platform-tools\adb.exe"
$proj = Split-Path -Parent $PSScriptRoot
$out = Join-Path $proj (Join-Path $OutDir $Role)
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Shot([string]$name) {
  $target = Join-Path $out "$name.png"
  & $adb -s $Serial shell screencap -p /sdcard/_cap.png | Out-Null
  & $adb -s $Serial pull /sdcard/_cap.png $target | Out-Null
  & $adb -s $Serial shell rm /sdcard/_cap.png | Out-Null
  if (Test-Path $target) {
    Write-Host ("  captured {0} ({1} KB)" -f $name, [math]::Round((Get-Item $target).Length / 1KB))
  } else {
    Write-Host "  FAILED $name" -ForegroundColor Red
  }
}

function Tap([int]$x, [int]$y, [int]$waitMs = 1500) {
  & $adb -s $Serial shell input tap $x $y | Out-Null
  Start-Sleep -Milliseconds $waitMs
}

# Bottom tab bar, in device pixels on a 1080x2340 panel.
$tabY = 2124
$tabs = @{ home = 104; map = 278; limits = 452; hub = 626; reports = 800; devices = 975 }

Write-Host "Launching Nestly on $Serial ..."
# A sleeping display makes screencap return a solid black frame, which is
# indistinguishable from a crashed app until you look at the file. Wake and
# dismiss the keyguard first.
& $adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
Start-Sleep -Milliseconds 500
& $adb -s $Serial shell wm dismiss-keyguard | Out-Null
Start-Sleep -Milliseconds 500
& $adb -s $Serial shell svc power stayon usb | Out-Null

& $adb -s $Serial shell am force-stop family.nestly.app | Out-Null
& $adb -s $Serial shell am start -n family.nestly.app/.MainActivity | Out-Null
Start-Sleep -Seconds 7

# Guard: a black frame means the capture is worthless, so say so loudly rather
# than writing four useless PNGs into the guide.
& $adb -s $Serial shell screencap -p /sdcard/_probe.png | Out-Null
$probe = Join-Path $out '_probe.png'
& $adb -s $Serial pull /sdcard/_probe.png $probe | Out-Null
& $adb -s $Serial shell rm /sdcard/_probe.png | Out-Null
if ((Test-Path $probe) -and (Get-Item $probe).Length -lt 20KB) {
  Remove-Item $probe -Force
  throw "Screen appears to be off or blank on $Serial (probe frame was tiny). Unlock the phone and retry."
}
Remove-Item $probe -Force -ErrorAction SilentlyContinue

if ($Role -eq 'parent') {
  Shot '01-home'
  foreach ($t in @('map', 'limits', 'hub', 'reports', 'devices')) {
    Tap $tabs[$t] $tabY 1800
    Shot ("{0:d2}-{1}" -f (([array]::IndexOf(@('map','limits','hub','reports','devices'), $t)) + 2), $t)
  }
  # Limits scrolled down shows reminders, which sit below the routine list.
  Tap $tabs['limits'] $tabY 1500
  & $adb -s $Serial shell input swipe 540 1700 540 700 400 | Out-Null
  Start-Sleep -Milliseconds 1200
  Shot '07-reminders'
}
else {
  # The child app is one screen with three tabs, and a lock screen that
  # replaces all of it when a routine is running. The lock state can only be
  # produced by the parent, so it is captured separately when both phones are
  # attached — see -LockOnly.
  Shot '01-child-home'

  # Child tab bar sits under the header, not at the foot of the screen.
  $childTabY = 300
  Tap 700 $childTabY 1500   # "What's shared"
  Shot '03-child-notice'
  Tap 430 $childTabY 1500   # Notes
  Shot '04-child-notes'
  Tap 170 $childTabY 1200   # back to Status
}

Write-Host ""
Write-Host "Wrote $( (Get-ChildItem $out -Filter *.png).Count ) screens to $out"
