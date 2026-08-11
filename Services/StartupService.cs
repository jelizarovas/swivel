using System.IO;
using Microsoft.Win32;

namespace Swivel.Services;

internal sealed class StartupService
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "Swivel";

    internal bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        return key?.GetValue(ValueName) is string value
               && string.Equals(
                   value.Trim(),
                   GetStartupCommand(),
                   StringComparison.OrdinalIgnoreCase);
    }

    internal void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
                        ?? throw new InvalidOperationException("Windows startup settings are unavailable.");

        if (!enabled)
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
            return;
        }

        key.SetValue(ValueName, GetStartupCommand(), RegistryValueKind.String);
    }

    private static string GetStartupCommand()
    {
        var executablePath = Environment.ProcessPath
                             ?? throw new InvalidOperationException("Unable to determine Swivel.exe's path.");
        return $"\"{Path.GetFullPath(executablePath)}\" --background";
    }
}
