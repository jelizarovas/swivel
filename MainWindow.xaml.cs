using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using Swivel.Models;
using Swivel.Services;
using MediaBrush = System.Windows.Media.Brush;
using WpfClipboard = System.Windows.Clipboard;

namespace Swivel;

public partial class MainWindow : Window
{
    private readonly App _host;
    private readonly DispatcherTimer _saveTimer;
    private bool _isLoadingSettings = true;

    internal MainWindow(App host)
    {
        _host = host;
        InitializeComponent();

        _saveTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(300)
        };
        _saveTimer.Tick += (_, _) =>
        {
            _saveTimer.Stop();
            _ = SaveSettings();
        };

        var anchorChoices = new[]
        {
            new Choice<BubbleAnchor>("Top left", BubbleAnchor.TopLeft),
            new Choice<BubbleAnchor>("Top", BubbleAnchor.TopCenter),
            new Choice<BubbleAnchor>("Top right", BubbleAnchor.TopRight),
            new Choice<BubbleAnchor>("Left", BubbleAnchor.MiddleLeft),
            new Choice<BubbleAnchor>("Center", BubbleAnchor.Center),
            new Choice<BubbleAnchor>("Right", BubbleAnchor.MiddleRight),
            new Choice<BubbleAnchor>("Bottom left", BubbleAnchor.BottomLeft),
            new Choice<BubbleAnchor>("Bottom", BubbleAnchor.BottomCenter),
            new Choice<BubbleAnchor>("Bottom right", BubbleAnchor.BottomRight)
        };

        LandscapePositionChips.ItemsSource = anchorChoices;
        PortraitPositionChips.ItemsSource = anchorChoices;
        PortraitTurnChips.ItemsSource = new[]
        {
            new Choice<PortraitTurn>("Right side down", PortraitTurn.Clockwise),
            new Choice<PortraitTurn>("Left side down", PortraitTurn.CounterClockwise)
        };

        LoadSettings(_host.Settings);
        _isLoadingSettings = false;
        LoadDiagnostics();
        UpdateFingerprintStatus(_host.FingerprintStatus);
        RefreshDisplayStatus();

        _host.LogLineAdded += OnLogLineAdded;
        _host.FingerprintStatusChanged += OnFingerprintStatusChanged;
    }

    internal void RefreshDisplayStatus()
    {
        var state = _host.GetDisplayState();
        DisplayStatusText.Text = state.IsAvailable ? state.Message : "Display status unavailable";
        DisplayStatusText.ToolTip = state.Message;
    }

    protected override void OnClosed(EventArgs e)
    {
        _saveTimer.Stop();
        _host.LogLineAdded -= OnLogLineAdded;
        _host.FingerprintStatusChanged -= OnFingerprintStatusChanged;
        base.OnClosed(e);
    }

    private void LoadSettings(AppSettings settings)
    {
        DismissDelaySlider.Value = settings.DismissDelayMilliseconds / 1000.0;
        ShowSettingsButtonCheckBox.IsChecked = settings.ShowSettingsButton;
        LandscapePositionChips.SelectedValue = settings.LandscapeAnchor;
        PortraitPositionChips.SelectedValue = settings.PortraitAnchor;
        PortraitTurnChips.SelectedValue = settings.PortraitTurn;
        LaunchAtSignInCheckBox.IsChecked = settings.LaunchAtSignIn;
        UpdateDelayText();
    }

    private AppSettings ReadSettingsFromControls() => new()
    {
        DismissDelayMilliseconds = (int)Math.Round(DismissDelaySlider.Value * 1000),
        ShowSettingsButton = ShowSettingsButtonCheckBox.IsChecked == true,
        LandscapeAnchor = LandscapePositionChips.SelectedValue is BubbleAnchor landscape
            ? landscape
            : BubbleAnchor.MiddleRight,
        PortraitAnchor = PortraitPositionChips.SelectedValue is BubbleAnchor portrait
            ? portrait
            : BubbleAnchor.BottomCenter,
        PortraitTurn = PortraitTurnChips.SelectedValue is PortraitTurn turn
            ? turn
            : PortraitTurn.Clockwise,
        LaunchAtSignIn = LaunchAtSignInCheckBox.IsChecked == true,
        EdgeMarginDips = _host.Settings.EdgeMarginDips
    };

    private bool SaveSettings()
    {
        if (_isLoadingSettings)
        {
            return true;
        }

        var saved = _host.TryApplySettings(ReadSettingsFromControls(), out var message);
        SaveStatusText.Text = saved ? "Saved automatically" : message;
        SaveStatusText.Foreground = (MediaBrush)FindResource(saved ? "SuccessBrush" : "ErrorBrush");
        return saved;
    }

    private void QueueSave()
    {
        if (_isLoadingSettings)
        {
            return;
        }

        SaveStatusText.Text = "Saving…";
        SaveStatusText.Foreground = (MediaBrush)FindResource("MutedTextBrush");
        _saveTimer.Stop();
        _saveTimer.Start();
    }

    private bool FlushPendingSave()
    {
        if (!_saveTimer.IsEnabled)
        {
            return true;
        }

        _saveTimer.Stop();
        return SaveSettings();
    }

    private void LoadDiagnostics()
    {
        DiagnosticsTextBox.Text = string.Join(Environment.NewLine, _host.RecentLogLines());
        DiagnosticsTextBox.ScrollToEnd();
    }

    private void OnLogLineAdded(string line)
    {
        Dispatcher.BeginInvoke(new Action(() =>
        {
            if (DiagnosticsTextBox.Text.Length > 0)
            {
                DiagnosticsTextBox.AppendText(Environment.NewLine);
            }

            DiagnosticsTextBox.AppendText(line);
            DiagnosticsTextBox.ScrollToEnd();
        }));
    }

    private void OnFingerprintStatusChanged(FingerprintStatus status)
    {
        Dispatcher.BeginInvoke(new Action(() => UpdateFingerprintStatus(status)));
    }

    private void UpdateFingerprintStatus(FingerprintStatus status)
    {
        FingerprintStatusText.Text = status.State switch
        {
            FingerprintMonitorState.Listening => "Reader ready",
            FingerprintMonitorState.Error => "Reader error",
            FingerprintMonitorState.Unsupported => "Not supported",
            _ => "Connecting…"
        };
        FingerprintStatusText.ToolTip = status.Message;

        var resourceName = status.State switch
        {
            FingerprintMonitorState.Listening => "SuccessBrush",
            FingerprintMonitorState.Error => "ErrorBrush",
            FingerprintMonitorState.Unsupported => "ErrorBrush",
            _ => "WarningBrush"
        };
        FingerprintStatusDot.Fill = (MediaBrush)FindResource(resourceName);
    }

    private void UpdateDelayText()
    {
        if (DismissDelayValueText is not null)
        {
            DismissDelayValueText.Text = $"{DismissDelaySlider.Value:0.#} s";
        }
    }

    private void DismissDelaySlider_ValueChanged(
        object sender,
        RoutedPropertyChangedEventArgs<double> e)
    {
        UpdateDelayText();
        QueueSave();
    }

    private void SettingsSelection_Changed(object sender, SelectionChangedEventArgs e) => QueueSave();

    private void SettingsToggle_Click(object sender, RoutedEventArgs e) => QueueSave();

    private void RetryReader_Click(object sender, RoutedEventArgs e)
    {
        _host.RestartFingerprintMonitor();
    }

    private void SimulateTouch_Click(object sender, RoutedEventArgs e)
    {
        if (FlushPendingSave())
        {
            _host.SimulateFingerprintTouch();
        }
    }

    private void Hide_Click(object sender, RoutedEventArgs e)
    {
        _ = FlushPendingSave();
        Hide();
    }

    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left)
        {
            return;
        }

        if (e.ClickCount == 2)
        {
            WindowState = WindowState == WindowState.Maximized
                ? WindowState.Normal
                : WindowState.Maximized;
            return;
        }

        DragMove();
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void CloseToTray_Click(object sender, RoutedEventArgs e)
    {
        _ = FlushPendingSave();
        Hide();
    }

    private void Exit_Click(object sender, RoutedEventArgs e)
    {
        _ = FlushPendingSave();
        _host.RequestExit();
    }

    private void CopyLogPath_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_host.LogPath))
        {
            SaveStatusText.Text = "Log path unavailable";
            return;
        }

        WpfClipboard.SetText(_host.LogPath);
        SaveStatusText.Text = "Log path copied";
        SaveStatusText.Foreground = (MediaBrush)FindResource("SuccessBrush");
    }

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_host.IsExiting)
        {
            return;
        }

        _ = FlushPendingSave();
        e.Cancel = true;
        Hide();
    }

    private sealed record Choice<T>(string Label, T Value);
}
