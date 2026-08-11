using System.ComponentModel;
using System.Runtime.InteropServices;
using Swivel.Models;

namespace Swivel.Services;

internal enum NativeDisplayOrientation : uint
{
    Landscape = 0,
    Portrait90 = 1,
    LandscapeFlipped = 2,
    Portrait270 = 3
}

internal enum DisplayChangeResult : int
{
    Successful = 0,
    RestartRequired = 1,
    Failed = -1,
    BadMode = -2,
    NotUpdated = -3,
    BadFlags = -4,
    BadParameter = -5,
    BadDualView = -6
}

internal sealed record DisplayState(
    bool IsAvailable,
    bool IsLandscape,
    NativeDisplayOrientation Orientation,
    uint Width,
    uint Height,
    string Message);

internal sealed record DisplayTarget(
    int Index,
    string DeviceName,
    string Label,
    bool IsPrimary,
    int X,
    int Y,
    uint Width,
    uint Height);

internal sealed record RotationResult(
    bool Success,
    string Message,
    DisplayChangeResult NativeResult);

internal sealed class DisplayRotationService
{
    private const int EnumCurrentSettings = -1;
    private const uint DmDisplayOrientation = 0x00000080;
    private const uint DmPelsWidth = 0x00080000;
    private const uint DmPelsHeight = 0x00100000;
    private const uint CdsUpdateRegistry = 0x00000001;
    private const uint CdsTest = 0x00000002;
    private const uint DisplayDeviceAttachedToDesktop = 0x00000001;
    private const uint DisplayDevicePrimaryDevice = 0x00000004;
    private const uint DisplayDeviceMirroringDriver = 0x00000008;

    internal static int NativeModeStructureSize => Marshal.SizeOf<DevMode>();

    internal IReadOnlyList<DisplayTarget> GetDisplays()
    {
        var displays = new List<DisplayTarget>();
        for (uint deviceIndex = 0; ; deviceIndex++)
        {
            var device = new DisplayDevice
            {
                cb = checked((uint)Marshal.SizeOf<DisplayDevice>()),
                DeviceName = string.Empty,
                DeviceString = string.Empty,
                DeviceID = string.Empty,
                DeviceKey = string.Empty
            };

            if (!EnumDisplayDevices(null, deviceIndex, ref device, 0))
            {
                break;
            }

            if ((device.StateFlags & DisplayDeviceAttachedToDesktop) == 0
                || (device.StateFlags & DisplayDeviceMirroringDriver) != 0)
            {
                continue;
            }

            try
            {
                var mode = GetCurrentMode(device.DeviceName);
                var index = displays.Count;
                displays.Add(new DisplayTarget(
                    index,
                    device.DeviceName,
                    $"Monitor {index + 1}",
                    (device.StateFlags & DisplayDevicePrimaryDevice) != 0,
                    mode.dmPositionX,
                    mode.dmPositionY,
                    mode.dmPelsWidth,
                    mode.dmPelsHeight));
            }
            catch
            {
                // Ignore disconnected or transient display entries.
            }
        }

        return displays;
    }

    internal DisplayTarget? GetDisplay(int requestedIndex)
    {
        var displays = GetDisplays();
        if (displays.Count == 0)
        {
            return null;
        }

        return displays[ResolveDisplayIndex(requestedIndex, displays.Count)];
    }

    internal static int ResolveDisplayIndex(int requestedIndex, int displayCount) =>
        displayCount <= 0 ? 0 : Math.Clamp(requestedIndex, 0, displayCount - 1);

    internal DisplayState GetCurrentState(int displayIndex = 0)
    {
        try
        {
            var display = GetDisplay(displayIndex)
                          ?? throw new InvalidOperationException("No active desktop display was found.");
            var mode = GetCurrentMode(display.DeviceName);
            var orientation = (NativeDisplayOrientation)mode.dmDisplayOrientation;
            return new DisplayState(
                true,
                mode.dmPelsWidth >= mode.dmPelsHeight,
                orientation,
                mode.dmPelsWidth,
                mode.dmPelsHeight,
                $"{display.Label}: {mode.dmPelsWidth} × {mode.dmPelsHeight} · {Describe(orientation)}");
        }
        catch (Exception exception)
        {
            return new DisplayState(
                false,
                true,
                NativeDisplayOrientation.Landscape,
                0,
                0,
                $"Display status unavailable: {exception.Message}");
        }
    }

    internal RotationResult Toggle(PortraitTurn portraitTurn, int displayIndex = 0)
    {
        DevMode mode;
        DisplayTarget display;
        try
        {
            display = GetDisplay(displayIndex)
                      ?? throw new InvalidOperationException("No active desktop display was found.");
            mode = GetCurrentMode(display.DeviceName);
        }
        catch (Exception exception)
        {
            return new RotationResult(false, exception.Message, DisplayChangeResult.Failed);
        }

        if ((mode.dmFields & DmDisplayOrientation) == 0)
        {
            return new RotationResult(
                false,
                "The active display driver does not advertise software rotation.",
                DisplayChangeResult.BadMode);
        }

        var currentlyLandscape = mode.dmPelsWidth >= mode.dmPelsHeight;
        // DEVMODE describes the counter-rotation Windows applies to the image.
        // When the physical panel turns clockwise (right side down), Windows
        // must use DMDO_90 so the desktop remains upright after the swivel.
        var target = GetTargetOrientation(currentlyLandscape, portraitTurn);

        if ((mode.dmDisplayOrientation & 1) != ((uint)target & 1))
        {
            (mode.dmPelsWidth, mode.dmPelsHeight) = (mode.dmPelsHeight, mode.dmPelsWidth);
        }

        mode.dmDisplayOrientation = (uint)target;
        mode.dmFields = DmDisplayOrientation | DmPelsWidth | DmPelsHeight;

        var test = (DisplayChangeResult)ChangeDisplaySettingsEx(
            display.DeviceName,
            ref mode,
            nint.Zero,
            CdsTest,
            nint.Zero);

        if (test != DisplayChangeResult.Successful)
        {
            return new RotationResult(
                false,
                DescribeFailure("Windows rejected the requested rotation during its safety check", test),
                test);
        }

        var applied = (DisplayChangeResult)ChangeDisplaySettingsEx(
            display.DeviceName,
            ref mode,
            nint.Zero,
            CdsUpdateRegistry,
            nint.Zero);

        return applied switch
        {
            DisplayChangeResult.Successful => new RotationResult(
                true,
                $"{display.Label} rotated to {Describe(target)}.",
                applied),
            DisplayChangeResult.RestartRequired => new RotationResult(
                false,
                "The display driver accepted the setting but requires a restart; no live rotation was confirmed.",
                applied),
            _ => new RotationResult(
                false,
                DescribeFailure("Windows could not apply the rotation", applied),
                applied)
        };
    }

    internal static NativeDisplayOrientation GetTargetOrientation(
        bool currentlyLandscape,
        PortraitTurn portraitTurn) => currentlyLandscape
        ? portraitTurn == PortraitTurn.Clockwise
            ? NativeDisplayOrientation.Portrait90
            : NativeDisplayOrientation.Portrait270
        : NativeDisplayOrientation.Landscape;

    private static DevMode GetCurrentMode(string? deviceName)
    {
        if (NativeModeStructureSize != 220)
        {
            throw new TypeLoadException($"Invalid DEVMODEW structure size: {NativeModeStructureSize}.");
        }

        var mode = new DevMode
        {
            dmDeviceName = string.Empty,
            dmFormName = string.Empty,
            dmSize = checked((ushort)NativeModeStructureSize)
        };

        if (!EnumDisplaySettings(deviceName, EnumCurrentSettings, ref mode))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to read the active display mode.");
        }

        return mode;
    }

    private static string Describe(NativeDisplayOrientation orientation) => orientation switch
    {
        NativeDisplayOrientation.Landscape => "landscape",
        NativeDisplayOrientation.Portrait90 => "portrait (90°)",
        NativeDisplayOrientation.LandscapeFlipped => "landscape (flipped)",
        NativeDisplayOrientation.Portrait270 => "portrait (270°)",
        _ => $"orientation {(uint)orientation}"
    };

    private static string DescribeFailure(string prefix, DisplayChangeResult result) =>
        $"{prefix}: {result} ({(int)result}).";

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DevMode
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;

        public ushort dmSpecVersion;
        public ushort dmDriverVersion;
        public ushort dmSize;
        public ushort dmDriverExtra;
        public uint dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public uint dmDisplayOrientation;
        public uint dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;

        public ushort dmLogPixels;
        public uint dmBitsPerPel;
        public uint dmPelsWidth;
        public uint dmPelsHeight;
        public uint dmDisplayFlags;
        public uint dmDisplayFrequency;
        public uint dmICMMethod;
        public uint dmICMIntent;
        public uint dmMediaType;
        public uint dmDitherType;
        public uint dmReserved1;
        public uint dmReserved2;
        public uint dmPanningWidth;
        public uint dmPanningHeight;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        public uint cb;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceString;

        public uint StateFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceID;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceKey;
    }

    [DllImport(
        "user32.dll",
        EntryPoint = "EnumDisplayDevicesW",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayDevices(
        string? deviceName,
        uint deviceIndex,
        [In, Out] ref DisplayDevice displayDevice,
        uint flags);

    [DllImport(
        "user32.dll",
        EntryPoint = "EnumDisplaySettingsW",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplaySettings(
        string? deviceName,
        int modeNumber,
        [In, Out] ref DevMode devMode);

    [DllImport(
        "user32.dll",
        EntryPoint = "ChangeDisplaySettingsExW",
        CharSet = CharSet.Unicode)]
    private static extern int ChangeDisplaySettingsEx(
        string? deviceName,
        [In] ref DevMode devMode,
        nint hwnd,
        uint flags,
        nint lParam);
}
