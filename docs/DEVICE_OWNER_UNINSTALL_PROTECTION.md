# Nestly Android Device Owner Protection

## Goal

On a managed child phone, attempting to remove or disable Nestly must not silently bypass the parent's safety policy. The child should be placed into the Nestly safety lock and shown:

> Nestly is protected. Please call your parent to continue.

The parent-controlled recovery path must be explicit.

## Enforcement model

### Production: Device Owner

Use Android Enterprise Device Owner provisioning for child-owned hardware. The native Android layer should use `DevicePolicyManager` and LockTask for the managed experience.

The provisioning flow must be explicit and documented. Device Owner is not something a normal app can quietly grant itself after ordinary installation.

### Compatibility: Device Admin

Keep `NestlyDeviceAdmin` only as a fallback for older/manual installations. It can add uninstall friction, but it cannot guarantee uninstall prevention because the user can deactivate a legacy device administrator in Android Settings.

UI copy must therefore distinguish:

- **Protected** — Device Owner is active.
- **Limited protection** — only legacy Device Admin is active.
- **Unprotected** — no device-management protection is active.

## Required native behaviour

1. Detect whether Nestly is Device Owner.
2. Detect whether Nestly is an active legacy Device Admin.
3. Expose the protection state to the Capacitor/WebView layer.
4. When protection/tamper is detected:
   - persist a local tamper event immediately;
   - switch the child experience to the safety lock screen;
   - call `DevicePolicyManager.lockNow()` when authorised;
   - enter LockTask when the app is configured as the Device Owner and lock-task allowlisted;
   - prevent ordinary navigation away from the safety surface while the protection state is unresolved.
5. Synchronise the tamper event through `child-sync` when online.
6. Reuse the existing parent notification pipeline for the `tamper` event.

## Important Android limitation

A standard app cannot reliably intercept every system uninstall gesture before Android handles it. Therefore the implementation should not promise an impossible “catch every uninstall tap” mechanism. The guaranteed enforcement comes from Device Owner provisioning and managed-device policy, not from a JavaScript overlay or ordinary Device Admin callback.

## Parent recovery

The parent can authorise recovery from the parent app. The child screen should not reveal service credentials or privileged database operations. The recovery command should be authenticated through the existing child-device secret / cloud command mechanism and should be time-bound and auditable.

## Test matrix

- Device Owner active → attempt uninstall/remove protection → device remains managed, Nestly safety lock shown, parent alerted.
- Legacy Device Admin only → disable admin → tamper event generated and parent alerted; UI clearly states that uninstall prevention is not guaranteed.
- No protection → UI shows limited protection and onboarding recommends Device Owner provisioning.
- Offline tamper → event remains in local queue and synchronises after reconnection.
- Reboot → Device Owner protection and safety state survive reboot.
- Parent recovery → authorised command clears tamper state and returns the child device to normal policy state.
