const DOWNLOADS = [
  {
    label: "Download Swivel",
    size: "317 KB",
    href: "https://github.com/jelizarovas/swivel/releases/latest/download/Swivel.exe",
    primary: true,
  },
  {
    label: "Standalone",
    size: "68 MiB",
    href: "https://github.com/jelizarovas/swivel/releases/latest/download/Swivel-standalone.exe",
    primary: false,
  },
];

const INFO_LINKS = [
  ["compatibility", "Compatibility"],
  ["background", "How it runs"],
  ["privacy", "Privacy"],
  ["terms", "Terms"],
];

export function HeroCopy({ openModal }) {
  return (
    <div className="hero-copy relative z-2 min-w-0">
      <h1 id="hero-title">Tap the edge.<br />Tap the bubble.<br /><em>Settings can sulk.</em></h1>
      <p className="lede">Swivel puts display rotation where your hand already is. Tap the edge reader, tap the blue button, then turn the screen. Free, tiny, and blissfully uninterested in doing anything else.</p>

      <div className="downloads flex" aria-label="Download choices">
        {DOWNLOADS.map((download) => (
          <a
            className={`download ${download.primary ? "download-primary" : "download-secondary"}`}
            href={download.href}
            key={download.label}
          >
            <span>{download.label}</span>
            <small>{download.size}</small>
          </a>
        ))}
      </div>

      <p className="release-meta">Latest: <strong>v0.1.5</strong> · released Aug 11, 2026</p>
      <p className="runtime-note">Try the regular download first. If the .NET 8 Desktop Runtime is missing, install it or use Standalone.</p>

      <div className="info-actions flex flex-wrap" aria-label="More information">
        {INFO_LINKS.map(([id, label]) => (
          <button type="button" onClick={() => openModal(id)} key={id}>{label}</button>
        ))}
      </div>
    </div>
  );
}
