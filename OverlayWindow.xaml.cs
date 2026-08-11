using System.Diagnostics;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Swivel.Models;
using Swivel.Services;

namespace Swivel;

public partial class OverlayWindow : Window
{
    private const int WmDisplayChange = 0x007E;
    private const int WmDpiChanged = 0x02E0;

    private readonly App _host;
    private readonly DispatcherTimer _dismissTimer;
    private readonly DispatcherTimer _settingsHoldTimer;
    private readonly DispatcherTimer _displayDebounceTimer;
    private readonly Stopwatch _countdownStopwatch = new();
    private HwndSource? _source;
    private double _remainingMilliseconds;
    private double _totalMilliseconds;
    private long _lastPositionWarningTimestamp;
    private bool _settingsHoldTriggered;

    internal OverlayWindow(App host)
    {
        _host = host;
        InitializeComponent();

        _dismissTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(40)
        };
        _dismissTimer.Tick += DismissTimer_Tick;

        _settingsHoldTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(2)
        };
        _settingsHoldTimer.Tick += SettingsHoldTimer_Tick;

        _displayDebounceTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(180)
        };
        _displayDebounceTimer.Tick += (_, _) =>
        {
            _displayDebounceTimer.Stop();
            RefreshPlacement();
        };
    }

    internal void ToggleFromTrigger()
    {
        if (IsVisible)
        {
            HideBubble();
            return;
        }

        ShowBubble();
    }

    internal void ShowBubble()
    {
        ApplySettings();
        RefreshTargetText();
        StatusText.Visibility = Visibility.Collapsed;
        Opacity = 0;

        if (!IsVisible)
        {
            Show();
        }

        Dispatcher.BeginInvoke(
            DispatcherPriority.Loaded,
            new Action(() =>
            {
                RefreshPlacement();
                Opacity = 1;
                ArmDismissTimer(_host.Settings.DismissDelayMilliseconds);
            }));
    }

    internal void HideBubble()
    {
        _dismissTimer.Stop();
        _settingsHoldTimer.Stop();
        _countdownStopwatch.Reset();
        _displayDebounceTimer.Stop();
        if (IsVisible)
        {
            Hide();
        }
    }

    internal void ApplySettings()
    {
        SettingsShortcut.Visibility = _host.Settings.ShowSettingsButton
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    internal void RefreshPlacement()
    {
        if (!IsVisible)
        {
            return;
        }

        try
        {
            var display = _host.GetDisplayState();
            var anchor = display.IsLandscape
                ? _host.Settings.LandscapeAnchor
                : _host.Settings.PortraitAnchor;
            WindowPositioner.Position(
                this,
                anchor,
                _host.Settings.EdgeMarginDips,
                _host.GetSelectedDisplayTarget());
            RefreshTargetText();
        }
        catch (Exception exception)
        {
            var now = Environment.TickCount64;
            if (_lastPositionWarningTimestamp == 0
                || now - _lastPositionWarningTimestamp >= 5000)
            {
                _lastPositionWarningTimestamp = now;
                _host.LogWarning($"Could not position the rotation bubble: {exception.Message}");
            }
        }
    }

    protected override void OnClosed(EventArgs e)
    {
        if (_source is not null)
        {
            _source.RemoveHook(WindowMessageHook);
            _source = null;
        }

        base.OnClosed(e);
    }

    private void RefreshTargetText()
    {
        var state = _host.GetDisplayState();
        TargetText.Text = state.IsLandscape
            ? $"Switch to portrait · {_host.Settings.PortraitTurn switch
            {
                PortraitTurn.Clockwise => "right side down",
                _ => "left side down"
            }}"
            : "Switch back to landscape";
    }

    private void ArmDismissTimer(double milliseconds)
    {
        _totalMilliseconds = Math.Max(500, milliseconds);
        _remainingMilliseconds = _totalMilliseconds;
        SetDismissProgress(0);
        _countdownStopwatch.Restart();
        _dismissTimer.Start();
    }

    private void PauseDismissTimer()
    {
        if (!_dismissTimer.IsEnabled)
        {
            return;
        }

        _remainingMilliseconds = Math.Max(
            0,
            _remainingMilliseconds - _countdownStopwatch.Elapsed.TotalMilliseconds);
        _countdownStopwatch.Stop();
        _dismissTimer.Stop();
    }

    private void ResumeDismissTimer()
    {
        if (!IsVisible || _remainingMilliseconds <= 0 || _dismissTimer.IsEnabled)
        {
            return;
        }

        _countdownStopwatch.Restart();
        _dismissTimer.Start();
    }

    private void DismissTimer_Tick(object? sender, EventArgs e)
    {
        var remaining = _remainingMilliseconds - _countdownStopwatch.Elapsed.TotalMilliseconds;
        if (remaining <= 0)
        {
            HideBubble();
            return;
        }

        SetDismissProgress(1 - (remaining / _totalMilliseconds));
    }

    private void RotateButton_Click(object sender, RoutedEventArgs e)
    {
        if (_settingsHoldTriggered)
        {
            _settingsHoldTriggered = false;
            return;
        }

        PauseDismissTimer();
        var result = _host.RotateDisplay();
        if (result.Success)
        {
            HideBubble();
            return;
        }

        StatusText.Text = result.Message;
        StatusText.Visibility = Visibility.Visible;
        ArmDismissTimer(5000);
    }

    private void SettingsButton_Click(object sender, RoutedEventArgs e)
    {
        HideBubble();
        _host.ShowControlPanel();
    }

    private void RotateButton_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e) =>
        BeginSettingsHold();

    private void RotateButton_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e) =>
        EndSettingsHold();

    private void RotateButton_LostMouseCapture(object sender, System.Windows.Input.MouseEventArgs e) =>
        EndSettingsHold();

    private void RotateButton_PreviewTouchDown(object sender, TouchEventArgs e) =>
        BeginSettingsHold();

    private void RotateButton_PreviewTouchUp(object sender, TouchEventArgs e) =>
        EndSettingsHold();

    private void BeginSettingsHold()
    {
        _settingsHoldTriggered = false;
        PauseDismissTimer();
        _settingsHoldTimer.Stop();
        _settingsHoldTimer.Start();
    }

    private void EndSettingsHold()
    {
        _settingsHoldTimer.Stop();
        if (_settingsHoldTriggered)
        {
            ArmDismissTimer(2000);
            return;
        }

        ResumeDismissTimer();
    }

    private void SettingsHoldTimer_Tick(object? sender, EventArgs e)
    {
        _settingsHoldTimer.Stop();
        _settingsHoldTriggered = true;
        SettingsShortcut.Visibility = Visibility.Visible;
        SetDismissProgress(0);
    }

    private void SetDismissProgress(double progress)
    {
        progress = Math.Clamp(progress, 0, 1);
        if (progress <= 0)
        {
            DismissArc.Data = null;
            return;
        }

        const double center = 58;
        const double radius = 53;
        var angle = Math.Min(359.9, progress * 360);
        var radians = (angle - 90) * Math.PI / 180;
        var end = new System.Windows.Point(
            center + radius * Math.Cos(radians),
            center + radius * Math.Sin(radians));
        var figure = new PathFigure
        {
            StartPoint = new System.Windows.Point(center, center - radius),
            IsClosed = false
        };
        figure.Segments.Add(new ArcSegment(
            end,
            new System.Windows.Size(radius, radius),
            0,
            angle > 180,
            SweepDirection.Clockwise,
            true));
        DismissArc.Data = new PathGeometry(new[] { figure });
    }

    private void Window_SourceInitialized(object? sender, EventArgs e)
    {
        _source = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle);
        _source?.AddHook(WindowMessageHook);
    }

    private nint WindowMessageHook(
        nint hwnd,
        int message,
        nint wParam,
        nint lParam,
        ref bool handled)
    {
        if (message is WmDisplayChange or WmDpiChanged)
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                _displayDebounceTimer.Stop();
                _displayDebounceTimer.Start();
            }));
        }

        return nint.Zero;
    }
}
