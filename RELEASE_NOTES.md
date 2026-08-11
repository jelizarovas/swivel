# Swivel v0.1.0

The first public prototype of Swivel: a small Windows utility for rotating a Surface Hub 2S without taking a field trip through Display Settings.

## Included

- One unused fingerprint-reader event toggles the rotation bubble.
- The bubble disappears after two untouched seconds by default.
- Landscape and portrait bubble positions are configurable.
- Portrait direction and timeout are configurable.
- A simulated fingerprint touch makes the complete flow testable without Hub hardware.
- Optional launch at sign in.
- Local-only settings and diagnostics; no account, cloud service, analytics, or biometric storage.

## Before using it on a Hub

- Requires Windows 10/11 Pro or Enterprise. Windows 10 Team is not supported.
- This executable is unsigned. SmartScreen may warn and managed-device policy may block it.
- Real Surface Hub reader-event support, placement, rotation direction, lock/sleep recovery, and launch at sign in are not yet hardware-verified.
- Swivel rotates the desktop orientation. It does not physically motorize the display stand.

## Download verification

`Swivel.exe` · Windows x64 · 68.31 MiB

SHA-256:

```text
4449DC99CB2DC0803E342A3C3708417099DFE8EB8D2BA3293FADEEBDA026131A
```
