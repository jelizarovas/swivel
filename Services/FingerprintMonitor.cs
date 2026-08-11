using System.Runtime.InteropServices;
using System.Threading;

namespace Swivel.Services;

internal enum FingerprintMonitorState
{
    Stopped,
    Listening,
    Paused,
    NoReader,
    Unsupported,
    Error
}

internal sealed record FingerprintStatus(
    FingerprintMonitorState State,
    string Message,
    int? HResult = null);

internal sealed class FingerprintMonitor : IDisposable
{
    private const uint WinBioTypeFingerprint = 0x00000008;
    private const uint WinBioPoolSystem = 1;
    private const uint WinBioFlagDefault = 0;
    private const uint WinBioEventFpUnclaimed = 0x00000001;
    private const int EHandle = unchecked((int)0x80070006);

    private readonly object _gate = new();
    private readonly WinBioEventCallback _nativeCallback;
    private uint _sessionHandle;
    private bool _registered;
    private bool _disposed;
    private int _acceptEvents;

    internal FingerprintMonitor()
    {
        _nativeCallback = HandleNativeEvent;
    }

    internal event Action? FingerprintTouched;
    internal event Action<FingerprintStatus>? StatusChanged;
    internal event Action<string>? DiagnosticWarning;

    internal FingerprintStatus CurrentStatus { get; private set; } =
        new(FingerprintMonitorState.Stopped, "Fingerprint listener is stopped.");

    internal FingerprintStatus Start()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);

            if (_registered)
            {
                return CurrentStatus;
            }

            if (_sessionHandle != 0)
            {
                var cleanupFailure = CloseSessionWithRetry();
                if (cleanupFailure is not null)
                {
                    return Publish(cleanupFailure);
                }
            }

            if (!OperatingSystem.IsWindows())
            {
                return Publish(new FingerprintStatus(
                    FingerprintMonitorState.Unsupported,
                    "Windows biometric APIs are unavailable on this operating system."));
            }

            try
            {
                var enumResult = WinBioEnumBiometricUnits(
                    WinBioTypeFingerprint,
                    out var unitSchemaArray,
                    out var unitCount);

                if (unitSchemaArray != nint.Zero)
                {
                    _ = WinBioFree(unitSchemaArray);
                }

                if (enumResult < 0)
                {
                    return Publish(Failure(
                        FingerprintMonitorState.Error,
                        "Windows could not enumerate fingerprint readers.",
                        enumResult));
                }

                if (unitCount == 0)
                {
                    return Publish(new FingerprintStatus(
                        FingerprintMonitorState.NoReader,
                        "No Windows fingerprint reader is connected."));
                }

                var openResult = WinBioOpenSession(
                    WinBioTypeFingerprint,
                    WinBioPoolSystem,
                    WinBioFlagDefault,
                    nint.Zero,
                    0,
                    nint.Zero,
                    out _sessionHandle);

                if (openResult < 0)
                {
                    _sessionHandle = 0;
                    return Publish(Failure(
                        FingerprintMonitorState.Error,
                        "The Windows biometric service could not open the reader.",
                        openResult));
                }

                Volatile.Write(ref _acceptEvents, 1);
                var registerResult = WinBioRegisterEventMonitor(
                    _sessionHandle,
                    WinBioEventFpUnclaimed,
                    _nativeCallback,
                    nint.Zero);

                if (registerResult < 0)
                {
                    Volatile.Write(ref _acceptEvents, 0);
                    var cleanupFailure = CloseSessionWithRetry();
                    if (cleanupFailure is not null)
                    {
                        return Publish(cleanupFailure);
                    }

                    return Publish(Failure(
                        FingerprintMonitorState.Unsupported,
                        "The fingerprint reader is present, but its driver declined background touch events.",
                        registerResult));
                }

                _registered = true;
                return Publish(new FingerprintStatus(
                    FingerprintMonitorState.Listening,
                    $"Listening for an unused fingerprint touch ({unitCount} reader{(unitCount == 1 ? string.Empty : "s")})."));
            }
            catch (DllNotFoundException)
            {
                return Publish(new FingerprintStatus(
                    FingerprintMonitorState.Unsupported,
                    "Windows Biometric Framework is unavailable on this device."));
            }
            catch (Exception exception)
            {
                _ = CloseSessionWithRetry();
                return Publish(new FingerprintStatus(
                    FingerprintMonitorState.Error,
                    $"Fingerprint listener failed: {exception.Message}"));
            }
        }
    }

    internal FingerprintStatus Pause(string reason)
    {
        lock (_gate)
        {
            if (!_disposed)
            {
                var cleanupFailure = CloseSessionWithRetry();
                if (cleanupFailure is not null)
                {
                    return Publish(cleanupFailure);
                }
            }

            return Publish(new FingerprintStatus(
                FingerprintMonitorState.Paused,
                reason));
        }
    }

    internal FingerprintStatus Stop()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return CurrentStatus;
            }

            var cleanupFailure = CloseSessionWithRetry();
            if (cleanupFailure is not null)
            {
                return Publish(cleanupFailure);
            }

            return Publish(new FingerprintStatus(
                FingerprintMonitorState.Stopped,
                "Fingerprint listener is stopped."));
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            var cleanupFailure = CloseSessionWithRetry();
            if (cleanupFailure is not null)
            {
                Publish(cleanupFailure);
            }
            _disposed = true;
        }

        GC.SuppressFinalize(this);
    }

    private void HandleNativeEvent(nint context, int operationStatus, nint eventPointer)
    {
        try
        {
            if (operationStatus >= 0
                && eventPointer != nint.Zero
                && Volatile.Read(ref _acceptEvents) != 0)
            {
                var eventType = unchecked((uint)Marshal.ReadInt32(eventPointer));
                if (eventType == WinBioEventFpUnclaimed)
                {
                    FingerprintTouched?.Invoke();
                }
            }
        }
        catch
        {
            // Exceptions must never cross the native callback boundary.
        }
        finally
        {
            if (eventPointer != nint.Zero)
            {
                try
                {
                    var freeResult = WinBioFree(eventPointer);
                    if (freeResult < 0)
                    {
                        TryRaiseDiagnosticWarning(
                            $"WinBioFree failed (0x{unchecked((uint)freeResult):X8}).");
                    }
                }
                catch (Exception exception)
                {
                    TryRaiseDiagnosticWarning($"WinBioFree threw: {exception.Message}");
                }
            }
        }
    }

    private FingerprintStatus? CloseSessionWithRetry()
    {
        var firstFailure = TryCloseSession();
        if (firstFailure is null || _sessionHandle == 0)
        {
            return firstFailure;
        }

        return TryCloseSession();
    }

    private FingerprintStatus? TryCloseSession()
    {
        Volatile.Write(ref _acceptEvents, 0);

        if (_sessionHandle == 0)
        {
            _registered = false;
            return null;
        }

        var session = _sessionHandle;
        var wasRegistered = _registered;
        var unregisterResult = 0;
        var closeResult = 0;
        Exception? unregisterException = null;
        Exception? closeException = null;

        try
        {
            if (wasRegistered)
            {
                unregisterResult = WinBioUnregisterEventMonitor(session);
            }
        }
        catch (Exception exception)
        {
            unregisterException = exception;
        }

        try
        {
            closeResult = WinBioCloseSession(session);
        }
        catch (Exception exception)
        {
            closeException = exception;
        }

        if (closeException is null && (closeResult >= 0 || closeResult == EHandle))
        {
            _sessionHandle = 0;
            _registered = false;
        }
        else
        {
            _sessionHandle = session;
            _registered = wasRegistered && (unregisterException is not null || unregisterResult < 0);
        }

        if (closeException is null && (closeResult >= 0 || closeResult == EHandle))
        {
            if (unregisterException is not null)
            {
                TryRaiseDiagnosticWarning(
                    $"Fingerprint unregister threw before the session closed: {unregisterException.Message}");
            }
            else if (unregisterResult < 0)
            {
                TryRaiseDiagnosticWarning(
                    $"Fingerprint unregister returned 0x{unchecked((uint)unregisterResult):X8}; closing the session completed teardown.");
            }

            if (closeResult == EHandle)
            {
                TryRaiseDiagnosticWarning(
                    "Windows reported that the fingerprint session was already invalid; the stale handle was cleared.");
            }

            return null;
        }

        var details = new List<string>();
        if (unregisterException is not null)
        {
            details.Add($"unregister threw {unregisterException.Message}");
        }
        else if (unregisterResult < 0)
        {
            details.Add($"unregister returned 0x{unchecked((uint)unregisterResult):X8}");
        }

        if (closeException is not null)
        {
            details.Add($"close threw {closeException.Message}");
        }
        else if (closeResult < 0)
        {
            details.Add($"close returned 0x{unchecked((uint)closeResult):X8}");
        }

        return new FingerprintStatus(
            FingerprintMonitorState.Error,
            $"Windows could not fully stop the fingerprint listener: {string.Join("; ", details)}.");
    }

    private FingerprintStatus Publish(FingerprintStatus status)
    {
        CurrentStatus = status;
        StatusChanged?.Invoke(status);
        return status;
    }

    private void TryRaiseDiagnosticWarning(string message)
    {
        try
        {
            DiagnosticWarning?.Invoke(message);
        }
        catch
        {
            // Diagnostics must never escape the native callback boundary.
        }
    }

    private static FingerprintStatus Failure(
        FingerprintMonitorState state,
        string message,
        int result) => new(
        state,
        $"{message} (0x{unchecked((uint)result):X8})",
        result);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void WinBioEventCallback(
        nint eventCallbackContext,
        int operationStatus,
        nint eventPointer);

    [DllImport("winbio.dll", ExactSpelling = true, CallingConvention = CallingConvention.Winapi)]
    private static extern int WinBioEnumBiometricUnits(
        uint factor,
        out nint unitSchemaArray,
        out nuint unitCount);

    [DllImport("winbio.dll", ExactSpelling = true, CallingConvention = CallingConvention.Winapi)]
    private static extern int WinBioOpenSession(
        uint factor,
        uint poolType,
        uint flags,
        nint unitArray,
        nuint unitCount,
        nint databaseId,
        out uint sessionHandle);

    [DllImport("winbio.dll", ExactSpelling = true, CallingConvention = CallingConvention.Winapi)]
    private static extern int WinBioRegisterEventMonitor(
        uint sessionHandle,
        uint eventMask,
        WinBioEventCallback eventCallback,
        nint eventCallbackContext);

    [DllImport("winbio.dll", ExactSpelling = true, CallingConvention = CallingConvention.Winapi)]
    private static extern int WinBioUnregisterEventMonitor(uint sessionHandle);

    [DllImport("winbio.dll", ExactSpelling = true, CallingConvention = CallingConvention.Winapi)]
    private static extern int WinBioCloseSession(uint sessionHandle);

    [DllImport("winbio.dll", ExactSpelling = true, CallingConvention = CallingConvention.Winapi)]
    private static extern int WinBioFree(nint address);
}
