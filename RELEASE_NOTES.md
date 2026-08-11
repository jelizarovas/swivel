# Swivel v0.1.1

The tiny-build and tiny-website release of Swivel.

## Included

- A compact single-file Windows build of about 218 KB. If .NET 8 Desktop Runtime is missing, Windows shows the required framework and official download link.
- A self-contained fallback build that carries the desktop runtime with it.
- A one-viewport website with no navigation or scrolling.
- A four-frame isometric animation: touch the reader, reveal the on-screen bubble, click it, then swivel to portrait.
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

`Swivel.exe` · Windows x64 · compact framework-dependent build

`Swivel-standalone.exe` · Windows x64 · self-contained build

SHA-256 values are published as release assets alongside both executables.
