using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Swivel.Diagnostics;
using Swivel.Models;
using Swivel.Services;
using Microsoft.Win32;
using Forms = System.Windows.Forms;

namespace Swivel;

public partial class App : System.Windows.Application
{
    private const string SingleInstanceName = @"Local\Swivel-2D62BBE8-864F-4521-9B75-95E182D1D92B";
    private const long FingerprintTouchCooldownMilliseconds = 750;

    private Mutex? _singleInstanceMutex;
    private bool _ownsSingleInstance;
    private Forms.NotifyIcon? _trayIcon;
    private Forms.ContextMenuStrip? _trayMenu;
    private MainWindow? _controlPanel;
    private OverlayWindow? _overlay;
    private FingerprintMonitor? _fingerprintMonitor;
    private SettingsStore? _settingsStore;
    private StartupService? _startupService;
    private DisplayRotationService? _displayRotation;
    private AppLogger? _logger;
    private DispatcherTimer? _resumeTimer;
    private bool _isExiting;
    private bool _isSessionLocked;
    private bool _isConsoleDisconnected;
    private bool _isSuspended;
    private long _lastFingerprintTouchTimestamp;

    internal AppSettings Settings { get; private set; } = new();
    internal bool IsExiting => _isExiting;
    internal string LogPath => _logger?.LogPath ?? string.Empty;
    internal FingerprintStatus FingerprintStatus => _fingerprintMonitor?.CurrentStatus
        ?? new FingerprintStatus(FingerprintMonitorState.Stopped, "Fingerprint listener has not started.");

    internal event Action<string>? LogLineAdded;
    internal event Action<FingerprintStatus>? FingerprintStatusChanged;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        RenderOptions.ProcessRenderMode = RenderMode.SoftwareOnly;

        if (SelfTestRunner.TryRun(e.Args, out var selfTestExitCode))
        {
            Shutdown(selfTestExitCode);
            return;
        }

        _singleInstanceMutex = new Mutex(
            initiallyOwned: true,
            SingleInstanceName,
            out _ownsSingleInstance);

        if (!_ownsSingleInstance)
        {
            if (!e.Args.Any(argument =>
                    string.Equals(argument, "--background", StringComparison.OrdinalIgnoreCase)))
            {
                System.Windows.MessageBox.Show(
                    "Swivel is already running. Open it from the notification area.",
                    "Swivel",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            }

            Shutdown();
            return;
        }

        _logger = new AppLogger();
        _logger.LineAdded += line => LogLineAdded?.Invoke(line);
        _settingsStore = new SettingsStore();
        _startupService = new StartupService();
        _displayRotation = new DisplayRotationService();
        _fingerprintMonitor = new FingerprintMonitor();

        Settings = _settingsStore.Load();
        try
        {
            Settings.LaunchAtSignIn = _startupService.IsEnabled();
        }
        catch (Exception exception)
        {
            _logger.Warn($"Could not read startup state: {exception.Message}");
        }

        _overlay = new OverlayWindow(this);
        _controlPanel = new MainWindow(this);
        MainWindow = _controlPanel;

        CreateTrayIcon();
        SubscribeToSystemEvents();

        _fingerprintMonitor.FingerprintTouched += OnFingerprintTouched;
        _fingerprintMonitor.StatusChanged += OnFingerprintStatusChanged;
        _fingerprintMonitor.DiagnosticWarning += OnFingerprintDiagnosticWarning;

        _logger.Info("Swivel 0.1.3 started.");
        _logger.Info($"Settings: {_settingsStore.SettingsPath}");
        _logger.Info($"Diagnostics: {_logger.LogPath}");

        var previewDirectory = GetOptionValue(e.Args, "--capture-previews");
        if (previewDirectory is not null)
        {
            ShowControlPanel();
            CapturePreviewsAndExit(Path.GetFullPath(previewDirectory));
            return;
        }

        var startInBackground = e.Args.Any(argument =>
            string.Equals(argument, "--background", StringComparison.OrdinalIgnoreCase));

        if (!startInBackground)
        {
            ShowControlPanel();
        }

        Dispatcher.BeginInvoke(
            DispatcherPriority.Background,
            new Action(RestartFingerprintMonitor));

        if (double.TryParse(
                GetOptionValue(e.Args, "--exit-after"),
                out var exitAfterSeconds)
            && exitAfterSeconds > 0)
        {
            var exitTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromSeconds(Math.Clamp(exitAfterSeconds, 1, 60))
            };
            exitTimer.Tick += (_, _) =>
            {
                exitTimer.Stop();
                RequestExit();
            };
            exitTimer.Start();
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        UnsubscribeFromSystemEvents();

        if (_fingerprintMonitor is not null)
        {
            _fingerprintMonitor.FingerprintTouched -= OnFingerprintTouched;
            _fingerprintMonitor.StatusChanged -= OnFingerprintStatusChanged;
            _fingerprintMonitor.DiagnosticWarning -= OnFingerprintDiagnosticWarning;
            _fingerprintMonitor.Dispose();
        }

        if (_trayIcon is not null)
        {
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
        }

        _trayMenu?.Dispose();

        if (_ownsSingleInstance)
        {
            _singleInstanceMutex?.ReleaseMutex();
        }

        _singleInstanceMutex?.Dispose();
        base.OnExit(e);
    }

    internal IReadOnlyList<string> RecentLogLines() =>
        _logger?.Snapshot() ?? Array.Empty<string>();

    internal DisplayState GetDisplayState() =>
        _displayRotation?.GetCurrentState()
        ?? new DisplayState(
            false,
            true,
            NativeDisplayOrientation.Landscape,
            0,
            0,
            "Display service has not started.");

    internal RotationResult RotateDisplay()
    {
        if (_displayRotation is null)
        {
            return new RotationResult(
                false,
                "Display rotation service is unavailable.",
                DisplayChangeResult.Failed);
        }

        var result = _displayRotation.Toggle(Settings.PortraitTurn);
        if (result.Success)
        {
            _logger?.Info(result.Message);
        }
        else
        {
            _logger?.Error(result.Message);
        }

        _controlPanel?.RefreshDisplayStatus();
        return result;
    }

    internal bool TryApplySettings(AppSettings settings, out string message)
    {
        if (_settingsStore is null || _startupService is null)
        {
            message = "Swivel has not finished starting.";
            return false;
        }

        try
        {
            settings.Normalize();
            var previousSettings = Settings.Copy();
            var previousStartupState = _startupService.IsEnabled();
            _settingsStore.Save(settings);

            try
            {
                _startupService.SetEnabled(settings.LaunchAtSignIn);
            }
            catch
            {
                try
                {
                    _startupService.SetEnabled(previousStartupState);
                    _settingsStore.Save(previousSettings);
                }
                catch (Exception rollbackException)
                {
                    _logger?.Error($"Settings rollback also failed: {rollbackException.Message}");
                }

                throw;
            }

            Settings = settings.Copy();
            _overlay?.ApplySettings();
            _logger?.Info("Settings saved.");
            message = settings.LaunchAtSignIn
                ? "Saved. Swivel will launch after sign-in."
                : "Saved.";
            return true;
        }
        catch (Exception exception)
        {
            _logger?.Error($"Could not save settings: {exception.Message}");
            message = $"Could not save settings: {exception.Message}";
            return false;
        }
    }

    internal void SimulateFingerprintTouch()
    {
        _logger?.Info("Simulated fingerprint touch received.");
        ToggleBubble();
    }

    internal void LogWarning(string message) => _logger?.Warn(message);

    internal void RestartFingerprintMonitor()
    {
        if (_fingerprintMonitor is null)
        {
            return;
        }

        if (!CanMonitorFingerprints())
        {
            var paused = _fingerprintMonitor.Pause(
                "Waiting until Windows is unlocked and fully resumed.");
            _logger?.Info(paused.Message);
            return;
        }

        var stopped = _fingerprintMonitor.Stop();
        if (stopped.State == FingerprintMonitorState.Error)
        {
            _logger?.Error(stopped.Message);
            return;
        }

        var status = _fingerprintMonitor.Start();
        _logger?.Info(status.Message);
    }

    internal void ShowControlPanel()
    {
        if (_controlPanel is null)
        {
            return;
        }

        if (!_controlPanel.IsVisible)
        {
            _controlPanel.Show();
        }

        if (_controlPanel.WindowState == WindowState.Minimized)
        {
            _controlPanel.WindowState = WindowState.Normal;
        }

        _controlPanel.Activate();
        _controlPanel.Topmost = true;
        _controlPanel.Topmost = false;
        _controlPanel.Focus();
    }

    internal void RequestExit()
    {
        _isExiting = true;
        _resumeTimer?.Stop();
        _overlay?.HideBubble();
        _controlPanel?.Close();
        Shutdown();
    }

    private void OnFingerprintTouched()
    {
        var now = Environment.TickCount64;
        var previous = Interlocked.Exchange(ref _lastFingerprintTouchTimestamp, now);
        if (previous != 0 && now - previous < FingerprintTouchCooldownMilliseconds)
        {
            _logger?.Info("Ignored a duplicate fingerprint notification.");
            return;
        }

        Dispatcher.BeginInvoke(new Action(() =>
        {
            if (!CanMonitorFingerprints()
                || _fingerprintMonitor?.CurrentStatus.State != FingerprintMonitorState.Listening)
            {
                _logger?.Warn("Discarded a fingerprint touch queued during lock, sleep, or listener teardown.");
                return;
            }

            _logger?.Info("Unused fingerprint touch received from Windows.");
            ToggleBubble();
        }));
    }

    private void ToggleBubble()
    {
        _overlay?.ToggleFromTrigger();
    }

    private void CapturePreviewsAndExit(string outputDirectory)
    {
        Dispatcher.BeginInvoke(
            DispatcherPriority.ApplicationIdle,
            new Action(async () =>
            {
                try
                {
                    await Task.Delay(500);
                    if (_controlPanel is null || _overlay is null)
                    {
                        throw new InvalidOperationException("Preview windows were not created.");
                    }

                    _controlPanel.Topmost = true;
                    _controlPanel.Activate();
                    await Task.Delay(500);
                    VisualCaptureService.RenderWindowContent(
                        _controlPanel,
                        Path.Combine(outputDirectory, "control-panel.png"));
                    VisualCaptureService.CaptureWindow(
                        _controlPanel,
                        Path.Combine(outputDirectory, "control-panel-screen.png"));
                    _controlPanel.Topmost = false;
                    _controlPanel.Hide();

                    await Task.Delay(120);
                    _overlay.ShowBubble();
                    await Task.Delay(320);
                    VisualCaptureService.CaptureWindow(
                        _overlay,
                        Path.Combine(outputDirectory, "rotation-bubble.png"));
                    File.WriteAllText(
                        Path.Combine(outputDirectory, "capture-result.txt"),
                        "Swivel visual previews captured successfully.");
                }
                catch (Exception exception)
                {
                    Directory.CreateDirectory(outputDirectory);
                    File.WriteAllText(
                        Path.Combine(outputDirectory, "capture-result.txt"),
                        $"Visual preview capture failed: {exception}");
                }
                finally
                {
                    RequestExit();
                }
            }));
    }

    private static string? GetOptionValue(string[] args, string option)
    {
        var index = Array.FindIndex(
            args,
            argument => string.Equals(argument, option, StringComparison.OrdinalIgnoreCase));
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    private void OnFingerprintStatusChanged(FingerprintStatus status)
    {
        Dispatcher.BeginInvoke(new Action(() => FingerprintStatusChanged?.Invoke(status)));
    }

    private void OnFingerprintDiagnosticWarning(string message)
    {
        _logger?.Warn(message);
    }

    private void CreateTrayIcon()
    {
        _trayMenu = new Forms.ContextMenuStrip();
        _trayMenu.Items.Add("Open Swivel", null, (_, _) =>
            Dispatcher.BeginInvoke(new Action(ShowControlPanel)));
        _trayMenu.Items.Add("Simulate fingerprint touch", null, (_, _) =>
            Dispatcher.BeginInvoke(new Action(SimulateFingerprintTouch)));
        _trayMenu.Items.Add(new Forms.ToolStripSeparator());
        _trayMenu.Items.Add("Exit", null, (_, _) =>
            Dispatcher.BeginInvoke(new Action(RequestExit)));

        Icon? icon = null;
        try
        {
            if (Environment.ProcessPath is { } processPath)
            {
                icon = Icon.ExtractAssociatedIcon(processPath);
            }
        }
        catch
        {
            // A generic system icon is sufficient for an unsigned prototype.
        }

        _trayIcon = new Forms.NotifyIcon
        {
            Text = "Swivel",
            Icon = icon ?? SystemIcons.Application,
            ContextMenuStrip = _trayMenu,
            Visible = true
        };
        _trayIcon.DoubleClick += (_, _) =>
            Dispatcher.BeginInvoke(new Action(ShowControlPanel));
    }

    private void SubscribeToSystemEvents()
    {
        SystemEvents.SessionSwitch += OnSessionSwitch;
        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
    }

    private void UnsubscribeFromSystemEvents()
    {
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        SystemEvents.PowerModeChanged -= OnPowerModeChanged;
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
    }

    private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        if (e.Reason is SessionSwitchReason.SessionLock
            or SessionSwitchReason.SessionLogoff)
        {
            Volatile.Write(ref _isSessionLocked, true);
            PauseFingerprintMonitorSynchronously(
                "Paused while Windows is locked.");
            Dispatcher.BeginInvoke(new Action(() =>
            {
                CancelFingerprintResume();
                _overlay?.HideBubble();
            }));
            return;
        }

        if (e.Reason == SessionSwitchReason.ConsoleDisconnect)
        {
            Volatile.Write(ref _isConsoleDisconnected, true);
            PauseFingerprintMonitorSynchronously(
                "Paused while the Windows console is disconnected.");
            Dispatcher.BeginInvoke(new Action(() =>
            {
                CancelFingerprintResume();
                _overlay?.HideBubble();
            }));
            return;
        }

        if (e.Reason == SessionSwitchReason.SessionUnlock)
        {
            Volatile.Write(ref _isSessionLocked, false);
            Dispatcher.BeginInvoke(new Action(ScheduleFingerprintResume));
            return;
        }

        if (e.Reason == SessionSwitchReason.ConsoleConnect)
        {
            Volatile.Write(ref _isConsoleDisconnected, false);
            Dispatcher.BeginInvoke(new Action(ScheduleFingerprintResume));
        }
    }

    private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Suspend)
        {
            Volatile.Write(ref _isSuspended, true);
            PauseFingerprintMonitorSynchronously(
                "Paused before sleep to protect Windows Hello sign-in.");
            Dispatcher.BeginInvoke(new Action(() =>
            {
                CancelFingerprintResume();
                _overlay?.HideBubble();
            }));
            return;
        }

        if (e.Mode == PowerModes.Resume)
        {
            Volatile.Write(ref _isSuspended, false);
            Dispatcher.BeginInvoke(new Action(ScheduleFingerprintResume));
        }
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        Dispatcher.BeginInvoke(
            DispatcherPriority.ApplicationIdle,
            new Action(() =>
            {
                _overlay?.RefreshPlacement();
                _controlPanel?.RefreshDisplayStatus();
            }));
    }

    private void PauseFingerprintMonitorSynchronously(string reason)
    {
        if (_fingerprintMonitor is null)
        {
            return;
        }

        var status = _fingerprintMonitor.Pause(reason);
        _logger?.Info(status.Message);
    }

    private void ScheduleFingerprintResume()
    {
        CancelFingerprintResume();
        if (!CanMonitorFingerprints())
        {
            return;
        }

        _resumeTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(2)
        };
        _resumeTimer.Tick += (_, _) =>
        {
            CancelFingerprintResume();
            if (!CanMonitorFingerprints())
            {
                return;
            }

            RestartFingerprintMonitor();
        };
        _resumeTimer.Start();
    }

    private void CancelFingerprintResume()
    {
        _resumeTimer?.Stop();
        _resumeTimer = null;
    }

    private bool CanMonitorFingerprints() =>
        !_isExiting
        && !Volatile.Read(ref _isSessionLocked)
        && !Volatile.Read(ref _isConsoleDisconnected)
        && !Volatile.Read(ref _isSuspended);
}
