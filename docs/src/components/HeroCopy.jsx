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

const PAYPAL_URL = "https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=arnas.jelizarovas%40gmail.com&item_name=Swivel+development&currency_code=USD";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.24c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.39.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A10.98 10.98 0 0 1 12 6.11c.98 0 1.94.13 2.86.39 2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.07.79 2.16v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

export function HeroCopy({ openModal }) {
  return (
    <div className="hero-copy relative z-2 min-w-0">
      <h1 id="hero-title">The screen turns.<br />Your desktop doesn&apos;t.<br /><em>Swivel fixes that.</em></h1>
      <p className="lede">Touch the side reader, tap the blue button, then turn the display. Swivel skips the Settings scavenger hunt. Free, tiny, one job.</p>

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
        <a className="github-link" href="https://github.com/jelizarovas/swivel" target="_blank" rel="noreferrer">
          <GitHubIcon />
          <span>jelizarovas/swivel</span>
        </a>
        <a className="donate-link" href={PAYPAL_URL} target="_blank" rel="noreferrer">Donate</a>
      </div>
    </div>
  );
}
