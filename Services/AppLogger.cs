using System.IO;

namespace Swivel.Services;

internal sealed class AppLogger
{
    private const long MaximumLogBytes = 1_048_576;
    private readonly object _gate = new();
    private readonly Queue<string> _recentLines = new();

    internal AppLogger(string? logPath = null)
    {
        LogPath = logPath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Swivel",
            "swivel.log");
    }

    internal string LogPath { get; }
    internal event Action<string>? LineAdded;

    internal IReadOnlyList<string> Snapshot()
    {
        lock (_gate)
        {
            return _recentLines.ToArray();
        }
    }

    internal void Info(string message) => Write("INFO", message);
    internal void Warn(string message) => Write("WARN", message);
    internal void Error(string message) => Write("ERROR", message);

    private void Write(string level, string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{level}] {message}";

        lock (_gate)
        {
            _recentLines.Enqueue(line);
            while (_recentLines.Count > 250)
            {
                _recentLines.Dequeue();
            }

            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                RotateIfNeeded();
                File.AppendAllText(LogPath, line + Environment.NewLine);
            }
            catch
            {
                // Diagnostics are useful, but logging must never crash the utility.
            }
        }

        LineAdded?.Invoke(line);
    }

    private void RotateIfNeeded()
    {
        if (!File.Exists(LogPath) || new FileInfo(LogPath).Length < MaximumLogBytes)
        {
            return;
        }

        var previousPath = Path.Combine(
            Path.GetDirectoryName(LogPath)!,
            Path.GetFileNameWithoutExtension(LogPath) + ".previous.log");
        File.Move(LogPath, previousPath, overwrite: true);
    }
}
