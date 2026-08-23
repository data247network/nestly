# Nestly child-device protection

Nestly's strong uninstall protection requires Android Enterprise **Device Owner** provisioning. The legacy Device Admin receiver remains only as a compatibility/tamper signal and must not be described as uninstall-proof.

## What the child experiences

When Nestly is provisioned as Device Owner, it can enter Android LockTask mode. During a protected tamper/uninstall flow the child sees a full-screen Nestly safety surface:

> **Nestly is protected. Please call your parent to continue.**

The app records the tamper event locally and uploads it through the existing child-sync path when connectivity is available. The parent notification is generated from the normal tamper notification pipeline.

## Provisioning

Device Owner is an Android Enterprise management state. It is not something an ordinary app can silently grant itself after installation. For development/testing, provision a dedicated test handset before handing the device to the child.

A typical ADB test sequence after a factory reset is:

```text
adb shell dpm set-device-owner family.nestly.app/.NestlyDeviceAdmin
```

The exact provisioning method should be validated against the Android version and OEM used for release. Production provisioning should use the appropriate Android Enterprise/managed-device flow rather than asking the child to make Nestly Device Owner after normal setup.

## Enforcement model

1. `NestlyDeviceOwner.isDeviceOwner()` verifies the management state.
2. `configure()` allowlists Nestly for LockTask and disables LockTask escape features.
3. `lock()` starts Android LockTask from the Nestly activity.
4. The TypeScript `src/platform/safety-lock.ts` bridge exposes status/configure/lock/unlock to the child UI.
5. If Device Owner is unavailable, the UI must report limited protection rather than claiming uninstall prevention.

## Important limitation

Device Owner provisioning normally requires a managed-device provisioning step and, depending on the provisioning route, a fresh/factory-reset device. This is an Android platform security boundary. Nestly must not attempt to bypass it or hide itself from Android Settings.
