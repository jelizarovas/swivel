using System.ComponentModel;
using System.Windows;
using Swivel.Models;
using Swivel.Services;
using MediaBrush = System.Windows.Media.Brush;
using WpfClipboard = System.Windows.Clipboard;

namespace Swivel;

public partial class MainWindow : Window
{
    private readonly App _host;

    internal MainWindow(App host)
    {
        _host = host;
        InitializeComponent();

        var anchorChoices = new[]
        {
            new Choice<BubbleAnchor>("Top left", BubbleAnchor.TopLeft),
            new Choice<BubbleAnchor>("Top center", BubbleAnchor.TopCenter),
            new Choice<BubbleAnchor>("Top right", BubbleAnchor.TopRight),
            new Choice<BubbleAnchor>("Left center", BubbleAnchor.MiddleLeft),
            new Choice<BubbleAnchor>("Center", BubbleAnchor.Center),
            new Choice<BubbleAnchor>("Right center", BubbleAnchor.MiddleRight),
            new Choice<BubbleAnchor>("Bottom left", BubbleAnchor.BottomLeft),
            new Choice<BubbleAnchor>("Bottom center", BubbleAnchor.BottomCenter),
            new Choice<BubbleAnchor>("Bottom right", BubbleAnchor.BottomRight)
        };

        LandscapePositionCombo.ItemsSource = anchorChoices;
        PortraitPositionCombo.ItemsSource = anchorChoices;
        PortraitTurnCombo.ItemsSource = new[]
        {
            new Choice<PortraitTurn>("Clockwise", PortraitTurn.Clockwise),
            new Choice<PortraitTurn>("Counter-clockwise", PortraitTurn.CounterClockwise)
        };

        LoadSettings(_host.Settings);
        LoadDiagnostics();
        UpdateFingerprintStatus(_host.FingerprintStatus);
        RefreshDisplayStatus();

        _host.LogLineAdded += OnLogLineAdded;
        _host.FingerprintStatusChanged += OnFingerprintStatusChanged;
    }

    internal void RefreshDisplayStatus()
    {
        var state = _host.GetDisplayState();
        DisplayStatusText.Text = state.IsAvailable
            ? $"Current display: {state.Message}. The Rotate button changes the real Windows display."
            : state.Message;
    }

    protected override void OnClosed(EventArgs e)
    {
        _host.LogLineAdded -= OnLogLineAdded;
        _host.FingerprintStatusChanged -= OnFingerprintStatusChanged;
        base.OnClosed(e);
    }

    private void LoadSettings(AppSettings settings)
    {
        DismissDelaySlider.Value = settings.DismissDelayMilliseconds / 1000.0;
        ShowSettingsButtonCheckBox.IsChecked = settings.ShowSettingsButton;
        LandscapePositionCombo.SelectedValue = settings.LandscapeAnchor;
        PortraitPositionCombo.SelectedValue = settings.PortraitAnchor;
        PortraitTurnCombo.SelectedValue = settings.PortraitTurn;
        LaunchAtSignInCheckBox.IsChecked = settings.LaunchAtSignIn;
        UpdateDelayText();
    }

    private AppSettings ReadSettingsFromControls() => new()
    {
        DismissDelayMilliseconds = (int)Math.Round(DismissDelaySlider.Value * 1000),
        ShowSettingsButton = ShowSettingsButtonCheckBox.IsChecked == true,
        LandscapeAnchor = LandscapePositionCombo.SelectedValue is BubbleAnchor landscape
            ? landscape
            : BubbleAnchor.MiddleRight,
        PortraitAnchor = PortraitPositionCombo.SelectedValue is BubbleAnchor portrait
            ? portrait
            : BubbleAnchor.BottomCenter,
        PortraitTurn = PortraitTurnCombo.SelectedValue is PortraitTurn turn
            ? turn
            : PortraitTurn.Clockwise,
        LaunchAtSignIn = LaunchAtSignInCheckBox.IsChecked == true,
        EdgeMarginDips = _host.Settings.EdgeMarginDips
    };

    private bool SaveSettings()
    {
        var saved = _host.TryApplySettings(ReadSettingsFromControls(), out var message);
        SaveStatusText.Text = message;
        SaveStatusText.Foreground = (MediaBrush)FindResource(saved ? "SuccessBrush" : "ErrorBrush");
        return saved;
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
        FingerprintStatusText.Text = status.Message;
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
            DismissDelayValueText.Text = $"{DismissDelaySlider.Value:0.#} seconds";
        }
    }

    private void DismissDelaySlider_ValueChanged(
        object sender,
        RoutedPropertyChangedEventArgs<double> e) => UpdateDelayText();

    private void RetryReader_Click(object sender, RoutedEventArgs e)
    {
        _host.RestartFingerprintMonitor();
    }

    private void SimulateTouch_Click(object sender, RoutedEventArgs e)
    {
        if (SaveSettings())
        {
            _host.SimulateFingerprintTouch();
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        _ = SaveSettings();
    }

    private void Hide_Click(object sender, RoutedEventArgs e)
    {
        Hide();
    }

    private void Exit_Click(object sender, RoutedEventArgs e)
    {
        _host.RequestExit();
    }

    private void CopyLogPath_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_host.LogPath))
        {
            SaveStatusText.Text = "The diagnostics path is not available yet.";
            return;
        }

        WpfClipboard.SetText(_host.LogPath);
        SaveStatusText.Text = "Diagnostics path copied.";
        SaveStatusText.Foreground = (MediaBrush)FindResource("SuccessBrush");
    }

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_host.IsExiting)
        {
            return;
        }

        e.Cancel = true;
        Hide();
    }

    private sealed record Choice<T>(string Label, T Value);
}
