import { useEffect, useRef } from "react";

export function Demo({ header }) {
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
      {header}
      <img className="webgl-fallback" src={`${base}assets/animation/frame-landscape.webp`} width="960" height="960" alt="" aria-hidden="true" />
      <canvas id="swivel-scene" aria-hidden="true" />
      <svg className="drag-force-vector" aria-hidden="true">
        <line className="drag-force-line" />
        <circle className="drag-force-end" r="8" />
      </svg>
      <div className="scene-shine" aria-hidden="true" />
      <img className="demo-cursor" src={`${base}assets/3d/pointer-hand.png`} alt="" aria-hidden="true" />
      <img className="demo-grip" src={`${base}assets/3d/grip-hand.png`} alt="" aria-hidden="true" />
    </figure>
  );
}
