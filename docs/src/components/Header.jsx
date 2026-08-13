const PAYPAL_URL = "https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=arnas.jelizarovas%40gmail.com&item_name=Swivel+development&currency_code=USD";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.24c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.39.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A10.98 10.98 0 0 1 12 6.11c.98 0 1.94.13 2.86.39 2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.07.79 2.16v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

export function Header() {
  const asset = `${import.meta.env.BASE_URL}assets/swivel-mark.svg`;

  return (
    <header className="topbar flex items-center justify-between">
      <a className="brand inline-flex items-center gap-3 no-underline" href={import.meta.env.BASE_URL} aria-label="Swivel home">
        <img src={asset} width="38" height="38" alt="" />
        <span>Swivel</span>
      </a>

      <nav className="topbar-links flex items-center" aria-label="Project links">
        <a className="github-link" href="https://github.com/jelizarovas/swivel" target="_blank" rel="noreferrer">
          <GitHubIcon />
          <span>jelizarovas/swivel</span>
        </a>
        <a className="donate-link" href={PAYPAL_URL} target="_blank" rel="noreferrer">Donate</a>
      </nav>
    </header>
  );
}
