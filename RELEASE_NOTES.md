# Swivel v0.1.2

The right-side-down Surface Hub test build.

## Fixed

- Corrected the portrait mapping for the Hub stand: lowering the right side now requests Windows portrait 90 instead of portrait 270.
- Replaced ambiguous clockwise/counter-clockwise labels with physical **Right side down** and **Left side down** choices.
- Settings now save automatically, so a direction or placement change takes effect without finding a Save button.
- Enabled native vertical touch panning in the settings window.

## Redesigned

- Compact Material-style settings with large touch targets and selectable chips instead of dropdowns.
- Rounded cards, a dark custom window bezel, a cleaner rounded scrollbar, and Material-style switches.
- Diagnostics are collapsed until requested, and secondary explanatory text is shorter.
- The app continues running from its notification-area icon when the settings window is hidden or closed.

## Downloads

- `Swivel.exe`: compact Windows x64 build; requires .NET 8 Desktop Runtime.
- `Swivel-standalone.exe`: self-contained Windows x64 fallback.

Both executables remain unsigned early prototypes. The corrected right-side-down mapping still needs confirmation on the Surface Hub 2S.
