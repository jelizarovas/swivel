using System.Diagnostics;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
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
    private readonly DispatcherTimer _displayDebounceTimer;
    private readonly Stopwatch _countdownStopwatch = new();
    private HwndSource? _source;
    private double _remainingMilliseconds;
    private double _totalMilliseconds;
    private long _lastPositionWarningTimestamp;

    internal OverlayWindow(App host)
    {
        _host = host;
        InitializeComponent();

        _dismissTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(40)
        };
        _dismissTimer.Tick += DismissTimer_Tick;

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
        StatusText.Text = "Touch the reader again to close";
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
        _countdownStopwatch.Reset();
        _displayDebounceTimer.Stop();
        if (IsVisible)
        {
            Hide();
        }
    }

    internal void ApplySettings()
    {
        SettingsButton.Visibility = _host.Settings.ShowSettingsButton
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
            WindowPositioner.Position(this, anchor, _host.Settings.EdgeMarginDips);
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
                PortraitTurn.Clockwise => "clockwise",
                _ => "counter-clockwise"
            }}"
            : "Switch back to landscape";
    }

    private void ArmDismissTimer(double milliseconds)
    {
        _totalMilliseconds = Math.Max(500, milliseconds);
        _remainingMilliseconds = _totalMilliseconds;
        DismissProgress.Value = 1;
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

        DismissProgress.Value = remaining / _totalMilliseconds;
    }

    private void RotateButton_Click(object sender, RoutedEventArgs e)
    {
        PauseDismissTimer();
        var result = _host.RotateDisplay();
        if (result.Success)
        {
            HideBubble();
            return;
        }

        StatusText.Text = result.Message;
        ArmDismissTimer(5000);
    }

    private void SettingsButton_Click(object sender, RoutedEventArgs e)
    {
        HideBubble();
        _host.ShowControlPanel();
    }

    private void BubbleSurface_MouseEnter(object sender, System.Windows.Input.MouseEventArgs e) =>
        PauseDismissTimer();

    private void BubbleSurface_MouseLeave(object sender, System.Windows.Input.MouseEventArgs e) =>
        ResumeDismissTimer();

    private void BubbleSurface_TouchDown(object sender, TouchEventArgs e) =>
        PauseDismissTimer();

    private void BubbleSurface_TouchUp(object sender, TouchEventArgs e) =>
        ResumeDismissTimer();

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
