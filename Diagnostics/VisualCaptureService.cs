using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Swivel.Diagnostics;

internal static class VisualCaptureService
{
    internal static void RenderWindowContent(Window window, string outputPath)
    {
        if (window.Content is not FrameworkElement content)
        {
            throw new InvalidOperationException("The preview window has no renderable content.");
        }

        window.UpdateLayout();
        content.UpdateLayout();

        var width = Math.Max(1, (int)Math.Ceiling(content.ActualWidth));
        var height = Math.Max(1, (int)Math.Ceiling(content.ActualHeight));
        var dpi = VisualTreeHelper.GetDpi(content);
        var pixelWidth = Math.Max(1, (int)Math.Ceiling(width * dpi.DpiScaleX));
        var pixelHeight = Math.Max(1, (int)Math.Ceiling(height * dpi.DpiScaleY));
        var bitmap = new RenderTargetBitmap(
            pixelWidth,
            pixelHeight,
            96 * dpi.DpiScaleX,
            96 * dpi.DpiScaleY,
            PixelFormats.Pbgra32);
        bitmap.Render(content);

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = File.Create(outputPath);
        encoder.Save(stream);
    }

    internal static void CaptureWindow(Window window, string outputPath)
    {
        window.UpdateLayout();
        var handle = new WindowInteropHelper(window).EnsureHandle();
        if (!GetWindowRect(handle, out var bounds))
        {
            throw new InvalidOperationException("Unable to read the preview window bounds.");
        }

        var width = bounds.Right - bounds.Left;
        var height = bounds.Bottom - bounds.Top;
        if (width <= 0 || height <= 0)
        {
            throw new InvalidOperationException("The preview window has no visible area.");
        }

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        using var bitmap = new Bitmap(
            width,
            height,
            System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.CopyFromScreen(
            bounds.Left,
            bounds.Top,
            0,
            0,
            new System.Drawing.Size(width, height),
            CopyPixelOperation.SourceCopy);
        bitmap.Save(outputPath, ImageFormat.Png);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(nint hwnd, out WindowRect rect);
}
