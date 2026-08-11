using System.Text.Json.Serialization;

namespace Swivel.Models;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum BubbleAnchor
{
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    Center,
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PortraitTurn
{
    Clockwise,
    CounterClockwise
}

public sealed class AppSettings
{
    public int SchemaVersion { get; set; } = 1;
    public int DismissDelayMilliseconds { get; set; } = 2000;
    public BubbleAnchor LandscapeAnchor { get; set; } = BubbleAnchor.MiddleRight;
    public BubbleAnchor PortraitAnchor { get; set; } = BubbleAnchor.BottomCenter;
    public PortraitTurn PortraitTurn { get; set; } = PortraitTurn.Clockwise;
    public bool ShowSettingsButton { get; set; } = true;
    public bool LaunchAtSignIn { get; set; }
    public double EdgeMarginDips { get; set; } = 32;

    public AppSettings Normalize()
    {
        SchemaVersion = 1;
        DismissDelayMilliseconds = Math.Clamp(DismissDelayMilliseconds, 500, 10000);
        EdgeMarginDips = Math.Clamp(EdgeMarginDips, 8, 160);

        if (!Enum.IsDefined(LandscapeAnchor))
        {
            LandscapeAnchor = BubbleAnchor.MiddleRight;
        }

        if (!Enum.IsDefined(PortraitAnchor))
        {
            PortraitAnchor = BubbleAnchor.BottomCenter;
        }

        if (!Enum.IsDefined(PortraitTurn))
        {
            PortraitTurn = PortraitTurn.Clockwise;
        }

        return this;
    }

    public AppSettings Copy() => new()
    {
        SchemaVersion = SchemaVersion,
        DismissDelayMilliseconds = DismissDelayMilliseconds,
        LandscapeAnchor = LandscapeAnchor,
        PortraitAnchor = PortraitAnchor,
        PortraitTurn = PortraitTurn,
        ShowSettingsButton = ShowSettingsButton,
        LaunchAtSignIn = LaunchAtSignIn,
        EdgeMarginDips = EdgeMarginDips
    };
}
