# Distributing Nestly

## ⚠️ Read this first — the current signing key

`android/nestly-release.jks` was generated during the initial build so that a
**release-signed** APK existed to hand around. Its password is a placeholder and
is committed in plain text in `android/keystore.properties`:

```
storePassword=nestly-dev-2026
keyPassword=nestly-dev-2026
```

That is fine for internal demos and sideloading. It is **not** fine for Google
Play. Before publishing:

1. Generate a fresh keystore with a real secret (below).
2. Store the `.jks` and its passwords somewhere you will not lose them —
   a password manager, plus an offline backup.
3. Delete the placeholder keystore.

Losing a production signing key means you can never ship an update to anyone who
already installed a build signed with it. There is no recovery path.

---

## Why release signing matters

Debug-signed APKs are the single biggest cause of "app not installed" when
sideloading:

- Play Protect blocks them on most modern devices.
- Every machine has its own debug keystore, so an update signed by a different
  one fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.

`scripts/build-apk.ps1` prints the signing certificate after every build and
warns loudly if it sees a debug signature, so it is hard to ship one by
accident.

---

## Creating a keystore

```bash
keytool -genkeypair -v \
  -keystore android/nestly-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias nestly
```

`keytool` ships with the JDK — on this machine:
`~/.fbms-android/jdk17/jdk-17.0.20+8/bin/keytool.exe`.

Then copy `android/keystore.properties.example` to
`android/keystore.properties` and fill in the four values. `storeFile` is
resolved relative to `android/`.

When `keystore.properties` is absent, the release build simply stays unsigned
rather than failing, so a fresh clone can still run `assembleDebug`.

---

## Building

```bash
npm run android:apk:release     # release/Nestly-release.apk
npm run android:apk             # release/Nestly.apk (debug-signed)
```

Both refresh the web assets first (`vite build` + `cap sync android`).

### What the build script works around

1. **Path/sync interference.** Building in place can trip over OneDrive
   "files on-demand" placeholders, which are reparse points Gradle rejects with
   *"not a regular file"*. The script copies `android/` plus the Capacitor
   `node_modules` it references into `%TEMP%\nestly-apk-build` — copying
   materialises real files — and builds there.

2. **JDK version.** The globally installed JDK on this machine is 26, far too
   new for the Gradle 8.2 that Capacitor 6 ships. The script pins
   `JAVA_HOME` to the JDK 17 under `~/.fbms-android/jdk17`.

Override either with `-JavaHome` / `-SdkDir` if the toolchain moves.

---

## Installing

```bash
adb install -r release/Nestly-release.apk
```

Or copy the APK to the phone and open it — the user will need
"Install unknown apps" enabled for whichever app opens it.

Current build: `family.nestly.app`, versionCode 1, versionName 1.0,
minSdk 22 (Android 5.1), targetSdk 34 (Android 14), ~4.4 MB.

---

## Installing the two roles

Nestly needs the same APK on **both** phones. Each install asks once which phone
it is:

1. Sideload onto the parent's phone → "This is my phone".
2. Sideload onto the child's phone → "This is my child's phone".
3. On the child's phone, grant **Location**, **Nearby devices** (Bluetooth) and
   **Notifications**. The agent will not start without Bluetooth permission, and
   will not sample location without location permission.
   Then, from the child's home screen, complete the two extra prompts:
   - **Turn on web filtering** — Android's VPN consent dialog. Nothing is
     blocked until this is accepted.
   - **Allow screen-time reporting** — opens Settings › Usage access. Without
     it, per-app times are unavailable and the parent's report says so.
4. On the parent's phone, tap **Device → Scan**, with both phones close
   together. The child appears by name.

The child's phone shows a permanent "Nestly is on" notification while the agent
runs. That is required by Android for a foreground service, and it is also
deliberate — the child can always see the agent is running.

### Checking a build on a real phone

```bash
powershell -ExecutionPolicy Bypass -File scripts\verify-on-device.ps1
```

Installs over the top (app data preserved, so a paired phone stays paired) and
reports crashes, Nestly log lines, the foreground service state and the granted
runtime permissions. Pass `-Fresh` to wipe app data first — useful for testing
the first-run flow, destructive to an existing pairing.

### If the child device never appears

- **"This phone cannot act as a Bluetooth peripheral"** — a real hardware limit
  on some older or budget Android devices. That phone cannot be the child
  device; try the two roles the other way round.
- Bluetooth off, or Nearby-devices permission denied, on either phone.
- On Android 11 and below, scanning also needs Location switched on at the
  system level, not just granted to the app.

## Before Google Play

- [ ] New keystore with a real password, backed up
- [ ] Bump `versionCode` in `android/app/build.gradle` for every upload
- [ ] Build an **AAB** (`bundleRelease`) rather than an APK — Play requires it
- [ ] Data safety form: declare location, and declare that message content is
      *not* collected — the transparency notice in the app makes that a promise
- [ ] Privacy policy URL (mandatory for anything requesting location)
- [ ] `ACCESS_FINE_LOCATION` needs a written justification in the console
- [ ] If background location is added later, it needs separate review
- [ ] Families policy applies: the child-facing surface puts this app in scope
- [ ] Foreground-service types (`location`, `connectedDevice`) each need a
      declared justification from Android 14
- [ ] `BLUETOOTH_SCAN` is declared `neverForLocation`; keep it that way, or the
      scan becomes a location disclosure too
- [ ] **VpnService** requires a declared purpose. Play permits it for parental
      control, but the listing must say the VPN is used for content filtering
      and nothing else — no traffic is proxied or logged off-device
- [ ] **`PACKAGE_USAGE_STATS`** and **`QUERY_ALL_PACKAGES`** both need written
      justification; `QUERY_ALL_PACKAGES` is scrutinised hardest, and the only
      reason here is labelling the apps in the usage report
- [ ] Data safety: declare "App activity" and "Web browsing" as collected, and
      be precise that browsing means **domain names only**
- [ ] Never add an AccessibilityService for monitoring. It would make URL and
      content capture possible and is a reliable way to get the app removed
