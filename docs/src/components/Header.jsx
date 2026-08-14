const MODES = [
  ["stand", "Stand"],
  ["wall", "Wall mounted"],
  ["monitor", "Monitor"],
];

export function Header() {
  const asset = `${import.meta.env.BASE_URL}assets/swivel-mark.svg`;
  const requestedMode = new URLSearchParams(window.location.search).get("mode");
  const initialMode = MODES.some(([mode]) => mode === requestedMode) ? requestedMode : "stand";

  return (
    <header className="topbar">
      <a className="brand inline-flex items-center gap-3 no-underline" href={import.meta.env.BASE_URL} aria-label="Swivel home">
        <img src={asset} width="38" height="38" alt="" />
        <span>Swivel</span>
      </a>

      <nav className="demo-mode-nav" aria-label="Demo controls">
        <div className="demo-tabs" role="tablist" aria-label="Choose a display setup">
          {MODES.map(([mode, label]) => (
            <button type="button" role="tab" aria-selected={mode === initialMode} data-demo-mode={mode} key={mode}>{label}</button>
          ))}
        </div>
      </nav>
    </header>
  );
}
