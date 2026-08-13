import { useEffect, useRef } from "react";

const MODES = [
  ["stand", "Stand"],
  ["wall", "Wall mounted"],
  ["monitor", "Monitor"],
];

export function Demo() {
  const demoRef = useRef(null);

  useEffect(() => {
    let cleanup;
    let active = true;

    import("../lib/swivel-scene")
      .then(({ mountSwivelScene }) => mountSwivelScene(demoRef.current))
      .then((dispose) => {
        if (active) cleanup = dispose;
        else dispose?.();
      });

    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  const base = import.meta.env.BASE_URL;

  return (
    <figure
      className="demo relative min-w-0 overflow-hidden"
      data-phase="loading"
      data-mode="stand"
      aria-label="An interactive 3D Swivel demonstration."
      ref={demoRef}
    >
      <div className="demo-tabs" role="tablist" aria-label="Choose a display setup">
        {MODES.map(([mode, label], index) => (
          <button type="button" role="tab" aria-selected={index === 0} data-demo-mode={mode} key={mode}>{label}</button>
        ))}
      </div>
      <img className="webgl-fallback" src={`${base}assets/animation/frame-landscape.webp`} width="960" height="960" alt="" aria-hidden="true" />
      <canvas id="swivel-scene" aria-hidden="true" />
      <div className="scene-shine" aria-hidden="true" />
      <img className="demo-cursor" src={`${base}assets/3d/pointer-hand.png`} alt="" aria-hidden="true" />
    </figure>
  );
}
