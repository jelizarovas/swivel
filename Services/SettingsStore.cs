using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using Swivel.Models;

namespace Swivel.Services;

internal sealed class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() }
    };

    internal SettingsStore(string? settingsPath = null)
    {
        SettingsPath = settingsPath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Swivel",
            "settings.json");
    }

    internal string SettingsPath { get; }

    internal AppSettings Load()
    {
        try
        {
            if (!File.Exists(SettingsPath))
            {
                return new AppSettings();
            }

            var json = File.ReadAllText(SettingsPath);
            return (JsonSerializer.Deserialize<AppSettings>(json, JsonOptions) ?? new AppSettings()).Normalize();
        }
        catch
        {
            TryPreserveCorruptFile();
            return new AppSettings();
        }
    }

    internal void Save(AppSettings settings)
    {
        settings.Normalize();
        var directory = Path.GetDirectoryName(SettingsPath)
                        ?? throw new InvalidOperationException("Settings path has no directory.");
        Directory.CreateDirectory(directory);

        var temporaryPath = SettingsPath + ".tmp";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(settings, JsonOptions));
        File.Move(temporaryPath, SettingsPath, true);
    }

    private void TryPreserveCorruptFile()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                File.Move(SettingsPath, SettingsPath + $".corrupt-{DateTime.Now:yyyyMMdd-HHmmss}", true);
            }
        }
        catch
        {
            // A broken settings file should never prevent the utility from starting.
        }
    }
}
