using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Swivel.Models;

namespace Swivel.Services;

internal static class WindowPositioner
{
    private static readonly nint HwndTopmost = new(-1);
    private const uint MonitorDefaultToNearest = 2;
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpShowWindow = 0x0040;

    internal static void Position(
        Window window,
        BubbleAnchor anchor,
        double marginDips,
        DisplayTarget? displayTarget = null)
    {
        window.UpdateLayout();
        var hwnd = new WindowInteropHelper(window).EnsureHandle();
        var monitor = displayTarget is null
            ? MonitorFromWindow(hwnd, MonitorDefaultToNearest)
            : MonitorFromPoint(
                new NativePoint(
                    displayTarget.X + checked((int)displayTarget.Width / 2),
                    displayTarget.Y + checked((int)displayTarget.Height / 2)),
                MonitorDefaultToNearest);
        var monitorInfo = new MonitorInfo
        {
            Size = (uint)Marshal.SizeOf<MonitorInfo>()
        };

        if (!GetMonitorInfo(monitor, ref monitorInfo))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        if (!GetWindowRect(hwnd, out var windowRect))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        var dpi = GetDpiForWindow(hwnd);
        if (dpi == 0)
        {
            dpi = 96;
        }

        var marginPixels = (int)Math.Round(marginDips * dpi / 96.0);
        var point = CalculatePosition(
            monitorInfo.WorkArea,
            windowRect.Width,
            windowRect.Height,
            anchor,
            marginPixels);

        if (!SetWindowPos(
                hwnd,
                HwndTopmost,
                point.X,
                point.Y,
                0,
                0,
                SwpNoSize | SwpNoActivate | SwpShowWindow))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    internal static NativePoint CalculatePosition(
        NativeRect workArea,
        int windowWidth,
        int windowHeight,
        BubbleAnchor anchor,
        int margin)
    {
        var left = workArea.Left + margin;
        var centerX = workArea.Left + (workArea.Width - windowWidth) / 2;
        var right = workArea.Right - windowWidth - margin;
        var top = workArea.Top + margin;
        var centerY = workArea.Top + (workArea.Height - windowHeight) / 2;
        var bottom = workArea.Bottom - windowHeight - margin;

        return anchor switch
        {
            BubbleAnchor.TopLeft => new NativePoint(left, top),
            BubbleAnchor.TopCenter => new NativePoint(centerX, top),
            BubbleAnchor.TopRight => new NativePoint(right, top),
            BubbleAnchor.MiddleLeft => new NativePoint(left, centerY),
            BubbleAnchor.Center => new NativePoint(centerX, centerY),
            BubbleAnchor.MiddleRight => new NativePoint(right, centerY),
            BubbleAnchor.BottomLeft => new NativePoint(left, bottom),
            BubbleAnchor.BottomCenter => new NativePoint(centerX, bottom),
            BubbleAnchor.BottomRight => new NativePoint(right, bottom),
            _ => new NativePoint(right, centerY)
        };
    }

    internal readonly record struct NativePoint(int X, int Y);

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;

        public readonly int Width => Right - Left;
        public readonly int Height => Bottom - Top;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        public uint Size;
        public NativeRect MonitorArea;
        public NativeRect WorkArea;
        public uint Flags;
    }

    [DllImport("user32.dll")]
    private static extern nint MonitorFromWindow(nint hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern nint MonitorFromPoint(NativePoint point, uint flags);

    [DllImport(
        "user32.dll",
        EntryPoint = "GetMonitorInfoW",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(nint hwnd, out NativeRect rect);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        nint hwnd,
        nint insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(nint hwnd);
}
