using System.IO;
using Swivel.Models;
using Swivel.Services;

namespace Swivel.Diagnostics;

internal static class SelfTestRunner
{
    internal static bool TryRun(string[] args, out int exitCode)
    {
        exitCode = 0;
        var switchIndex = Array.FindIndex(
            args,
            argument => string.Equals(argument, "--self-test", StringComparison.OrdinalIgnoreCase));

        if (switchIndex < 0)
        {
            return false;
        }

        var outputPath = switchIndex + 1 < args.Length
            ? Path.GetFullPath(args[switchIndex + 1])
            : Path.Combine(Path.GetTempPath(), "swivel-self-test.txt");

        var lines = new List<string>
        {
            $"Swivel self-test · {DateTime.Now:O}",
            $"Windows: {Environment.OSVersion}",
            $"64-bit process: {Environment.Is64BitProcess}",
            $"Bundled .NET runtime: {Environment.Version}"
        };

        var failed = false;
        Check(
            DisplayRotationService.NativeModeStructureSize == 220,
            $"DEVMODEW size is {DisplayRotationService.NativeModeStructureSize} (expected 220)",
            lines,
            ref failed);

        var temporaryDirectory = Path.Combine(Path.GetTempPath(), $"swivel-self-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(temporaryDirectory);

        try
        {
            var store = new SettingsStore(Path.Combine(temporaryDirectory, "settings.json"));
            var expected = new AppSettings
            {
                DismissDelayMilliseconds = 3750,
                LandscapeAnchor = BubbleAnchor.MiddleRight,
                PortraitAnchor = BubbleAnchor.BottomCenter,
                PortraitTurn = PortraitTurn.CounterClockwise,
                ShowSettingsButton = false
            };
            store.Save(expected);
            var actual = store.Load();
            Check(
                actual.DismissDelayMilliseconds == 3750
                && actual.LandscapeAnchor == BubbleAnchor.MiddleRight
                && actual.PortraitAnchor == BubbleAnchor.BottomCenter
                && actual.PortraitTurn == PortraitTurn.CounterClockwise
                && !actual.ShowSettingsButton,
                "Settings JSON round-trip",
                lines,
                ref failed);

            var workArea = new WindowPositioner.NativeRect
            {
                Left = 0,
                Top = 0,
                Right = 3840,
                Bottom = 2160
            };
            var rightCenter = WindowPositioner.CalculatePosition(
                workArea,
                400,
                160,
                BubbleAnchor.MiddleRight,
                32);
            Check(
                rightCenter.X == 3408 && rightCenter.Y == 1000,
                "Landscape middle-right placement math",
                lines,
                ref failed);

            var portraitArea = new WindowPositioner.NativeRect
            {
                Left = 0,
                Top = 0,
                Right = 2160,
                Bottom = 3840
            };
            var bottomCenter = WindowPositioner.CalculatePosition(
                portraitArea,
                400,
                160,
                BubbleAnchor.BottomCenter,
                32);
            Check(
                bottomCenter.X == 880 && bottomCenter.Y == 3648,
                "Portrait bottom-center placement math",
                lines,
                ref failed);

            var displayState = new DisplayRotationService().GetCurrentState();
            lines.Add($"INFO: Current display probe: {displayState.Message}");
        }
        catch (Exception exception)
        {
            failed = true;
            lines.Add($"FAIL: Unexpected self-test exception: {exception}");
        }
        finally
        {
            try
            {
                Directory.Delete(temporaryDirectory, recursive: true);
            }
            catch
            {
                // Temporary cleanup failure is not an application failure.
            }
        }

        lines.Add(failed ? "RESULT: FAILED" : "RESULT: PASSED");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        File.WriteAllLines(outputPath, lines);
        exitCode = failed ? 1 : 0;
        return true;
    }

    private static void Check(
        bool condition,
        string name,
        ICollection<string> lines,
        ref bool failed)
    {
        lines.Add($"{(condition ? "PASS" : "FAIL")}: {name}");
        failed |= !condition;
    }
}
