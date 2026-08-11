import * as THREE from "./vendor/three.module.min.js";

const canvas = document.querySelector("#swivel-scene");
const demo = document.querySelector(".demo");
const caption = document.querySelector("#scene-caption");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const requestedTime = Number.parseFloat(new URLSearchParams(window.location.search).get("t"));
const frozenTime = Number.isFinite(requestedTime) ? requestedTime : null;

if (!canvas || !demo) {
  throw new Error("Swivel scene mount is missing.");
}

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (from, to, amount) => from + (to - from) * amount;
const smooth = (amount) => {
  const t = clamp(amount);
  return t * t * (3 - 2 * t);
};
const segment = (time, start, end) => smooth((time - start) / (end - start));

function roundedRectShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function roundedSolid(width, height, radius, depth, bevel = 0.04) {
  const geometry = new THREE.ExtrudeGeometry(roundedRectShape(width, height, radius), {
    depth,
    curveSegments: 10,
    bevelEnabled: bevel > 0,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function material(color, roughness = 0.55, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function cylinderBetween(start, end, radius, meshMaterial, radialSegments = 18) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments),
    meshMaterial
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  return mesh;
}

function createUiTexture() {
  const uiCanvas = document.createElement("canvas");
  uiCanvas.width = 1024;
  uiCanvas.height = 576;
  const context = uiCanvas.getContext("2d");
  const texture = new THREE.CanvasTexture(uiCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let lastAngle = Number.NaN;

  const roundRect = (x, y, width, height, radius, fill) => {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fillStyle = fill;
    context.fill();
  };

  const draw = (angle) => {
    if (Math.abs(angle - lastAngle) < 0.002) return;
    lastAngle = angle;
    const width = uiCanvas.width;
    const height = uiCanvas.height;
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#101b37");
    background.addColorStop(0.5, "#183c65");
    background.addColorStop(1, "#0f736f");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.save();
    context.translate(width / 2, height / 2);
    context.rotate(angle);
    const scale = mix(1, 0.64, Math.abs(Math.sin(angle)));
    context.scale(scale, scale);
    context.translate(-width / 2, -height / 2);

    roundRect(70, 68, 525, 390, 34, "rgba(112,138,255,.88)");
    roundRect(635, 68, 295, 116, 28, "rgba(247,244,252,.82)");
    roundRect(635, 207, 295, 251, 28, "rgba(245,189,124,.82)");
    roundRect(104, 105, 190, 20, 10, "rgba(255,255,255,.68)");
    roundRect(104, 145, 340, 13, 7, "rgba(255,255,255,.32)");
    roundRect(104, 174, 290, 13, 7, "rgba(255,255,255,.25)");
    roundRect(104, 344, 145, 60, 20, "rgba(255,255,255,.26)");
    roundRect(273, 344, 145, 60, 20, "rgba(255,255,255,.18)");
    context.restore();

    const shine = context.createLinearGradient(0, 0, width, height);
    shine.addColorStop(0, "rgba(255,255,255,.24)");
    shine.addColorStop(0.27, "rgba(255,255,255,0)");
    shine.addColorStop(1, "rgba(255,255,255,.05)");
    context.fillStyle = shine;
    context.fillRect(0, 0, width, height);
    texture.needsUpdate = true;
  };

  draw(0);
  return { texture, draw };
}

try {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5.8, 5.8, 5.8, -5.8, 0.1, 100);
  camera.position.set(7.2, 5.4, 11.5);
  camera.lookAt(0, 0.25, 0);

  scene.add(new THREE.HemisphereLight(0xfff7eb, 0x405171, 2.15));
  const key = new THREE.DirectionalLight(0xfff1df, 4.2);
  key.position.set(-4.5, 9, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -7;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8ca4ff, 2.4);
  rim.position.set(7, 3, -5);
  scene.add(rim);

  const stage = new THREE.Mesh(
    new THREE.CylinderGeometry(4.55, 4.8, 0.34, 64),
    material(0xc9c1d7, 0.82)
  );
  stage.position.y = -2.83;
  stage.receiveShadow = true;
  scene.add(stage);

  const silver = material(0xd7dce3, 0.26, 0.7);
  const darkSilver = material(0x7b8491, 0.32, 0.58);
  const tire = material(0x69717d, 0.75, 0.05);
  const shelfMaterial = material(0x777e89, 0.38, 0.48);
  const frameMaterial = material(0x11141b, 0.24, 0.5);

  const stand = new THREE.Group();
  const legSpecs = [
    [new THREE.Vector3(-1.85, 0.95, 0.12), new THREE.Vector3(-2.48, -2.38, 0.72)],
    [new THREE.Vector3(1.85, 0.95, 0.12), new THREE.Vector3(2.48, -2.38, 0.72)],
    [new THREE.Vector3(-1.55, 0.92, -0.48), new THREE.Vector3(-1.76, -2.36, -0.72)],
    [new THREE.Vector3(1.55, 0.92, -0.48), new THREE.Vector3(1.76, -2.36, -0.72)]
  ];
  for (const [top, bottom] of legSpecs) {
    stand.add(cylinderBetween(top, bottom, 0.095, silver));
  }

  const shelf = new THREE.Mesh(roundedSolid(3.7, 0.78, 0.28, 0.22, 0.035), shelfMaterial);
  shelf.rotation.x = -Math.PI / 2;
  shelf.position.set(0, -0.82, 0.08);
  shelf.castShadow = true;
  stand.add(shelf);

  const wheelSpecs = [
    [-2.48, -2.42, 0.72],
    [2.48, -2.42, 0.72],
    [-1.76, -2.42, -0.72],
    [1.76, -2.42, -0.72]
  ];
  for (const [x, y, z] of wheelSpecs) {
    const wheel = new THREE.Group();
    wheel.position.set(x, y, z);
    const fork = cylinderBetween(new THREE.Vector3(0, 0.16, 0), new THREE.Vector3(0, -0.02, 0), 0.065, darkSilver, 12);
    wheel.add(fork);
    const tyreMesh = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.075, 12, 28), tire);
    tyreMesh.rotation.y = Math.PI / 2;
    tyreMesh.castShadow = true;
    wheel.add(tyreMesh);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.11, 20), silver);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    stand.add(wheel);
  }
  scene.add(stand);

  const mount = cylinderBetween(new THREE.Vector3(-1.75, 0.82, -0.1), new THREE.Vector3(1.75, 0.82, -0.1), 0.1, darkSilver);
  scene.add(mount);

  const display = new THREE.Group();
  display.position.set(0, 1.55, 0.18);
  scene.add(display);

  const frame = new THREE.Mesh(roundedSolid(5.72, 3.34, 0.22, 0.24, 0.055), frameMaterial);
  frame.castShadow = true;
  frame.receiveShadow = true;
  display.add(frame);

  const ui = createUiTexture();
  const screenMaterial = new THREE.MeshBasicMaterial({ map: ui.texture, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.32, 2.94), screenMaterial);
  screen.position.z = 0.205;
  display.add(screen);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(5.34, 2.96),
    new THREE.MeshPhysicalMaterial({
      color: 0xdce9ff,
      transparent: true,
      opacity: 0.13,
      roughness: 0.08,
      metalness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      depthWrite: false
    })
  );
  glass.position.z = 0.218;
  glass.renderOrder = 3;
  display.add(glass);

  const reflection = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 2.72),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, depthWrite: false })
  );
  reflection.position.set(-1.55, 0.5, 0.224);
  reflection.rotation.z = -0.52;
  reflection.renderOrder = 4;
  display.add(reflection);

  const reader = new THREE.Group();
  reader.position.set(2.96, 0, 0.02);
  const readerBody = new THREE.Mesh(roundedSolid(0.28, 0.7, 0.12, 0.25, 0.025), silver);
  readerBody.castShadow = true;
  reader.add(readerBody);
  const readerInset = new THREE.Mesh(
    new THREE.CircleGeometry(0.095, 24),
    new THREE.MeshBasicMaterial({ color: 0x7b8491 })
  );
  readerInset.scale.y = 1.65;
  readerInset.position.z = 0.15;
  reader.add(readerInset);
  display.add(reader);

  const loader = new THREE.TextureLoader();
  const [buttonTexture, pointerTexture, gripTexture] = await Promise.all([
    loader.loadAsync("assets/3d/rotation-button.png?v=3"),
    loader.loadAsync("assets/3d/pointer-hand.png"),
    loader.loadAsync("assets/3d/grip-hand.png")
  ]);
  for (const texture of [buttonTexture, pointerTexture, gripTexture]) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  const bubbleMaterial = new THREE.MeshBasicMaterial({
    map: buttonTexture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    toneMapped: false
  });
  const bubble = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), bubbleMaterial);
  bubble.position.set(2.03, 0, 0.245);
  bubble.renderOrder = 10;
  display.add(bubble);

  const pointerMaterial = new THREE.SpriteMaterial({
    map: pointerTexture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    toneMapped: false
  });
  const pointer = new THREE.Sprite(pointerMaterial);
  pointer.scale.set(2.45, 1.48, 1);
  pointer.renderOrder = 20;
  scene.add(pointer);

  const gripMaterial = new THREE.SpriteMaterial({
    map: gripTexture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    toneMapped: false
  });
  const grip = new THREE.Sprite(gripMaterial);
  grip.scale.set(2.1, 2.1, 1);
  grip.renderOrder = 19;
  scene.add(grip);

  const targetWorld = new THREE.Vector3();
  const fromWorld = new THREE.Vector3();
  const toWorld = new THREE.Vector3();
  const panelCorner = new THREE.Vector3();
  let currentPhase = "";

  function setPhase(name, text) {
    if (name === currentPhase) return;
    currentPhase = name;
    demo.dataset.phase = name;
    if (caption) caption.innerHTML = text;
  }

  function getWorldPosition(local) {
    display.updateMatrixWorld(true);
    return display.localToWorld(local.clone());
  }

  function placePointer(target, portrait, opacity, press = 0, isSensor = false) {
    const offset = portrait
      ? new THREE.Vector3(0, -0.9 + press * 0.11, 0.92)
      : new THREE.Vector3((isSensor ? 1.9 : 1.62) - press * 0.11, 0, 0.92);
    pointer.position.copy(target).add(offset);
    pointerMaterial.rotation = portrait ? -Math.PI / 2 : 0;
    pointerMaterial.opacity = clamp(opacity);
    const squeeze = 1 - press * 0.06;
    pointer.scale.set(2.45 * squeeze, 1.48 * squeeze, 1);
    pointer.visible = opacity > 0.002;
  }

  function placeGrip(localCorner, opacity, angle) {
    panelCorner.copy(getWorldPosition(localCorner));
    grip.position.copy(panelCorner).add(new THREE.Vector3(0.46, 0.42, 0.9));
    gripMaterial.opacity = clamp(opacity);
    gripMaterial.rotation = -0.12 + angle * 0.25;
    grip.visible = opacity > 0.002;
  }

  function animate(time) {
    const t = frozenTime ?? (reduceMotion ? 0 : (time / 1000) % 18);
    let panelAngle = 0;
    let contentAngle = 0;
    let bubbleOpacity = 0;
    let bubbleScale = 0.25;
    let pointerOpacity = 0;
    let pointerPress = 0;
    let portraitPointer = false;
    let pointerTarget = "sensor";
    let gripOpacity = 0;
    let gripCorner = new THREE.Vector3(2.82, 1.63, 0.2);

    if (t < 1.15) {
      setPhase("landscape", "Touch reader <b>→</b> tap bubble <b>→</b> swivel");
    } else if (t < 2.2) {
      setPhase("touch-reader", "Touch the edge reader");
      pointerOpacity = segment(t, 1.15, 1.55);
      pointerPress = segment(t, 1.82, 2.08) * (1 - segment(t, 2.08, 2.2));
    } else if (t < 3.05) {
      setPhase("bubble-appears", "The blue button appears on screen");
      pointerOpacity = 1 - segment(t, 2.45, 3.05);
      bubbleOpacity = segment(t, 2.2, 2.58);
      bubbleScale = mix(0.25, 1, segment(t, 2.2, 2.68));
    } else if (t < 4.2) {
      setPhase("tap-bubble", "Tap the blue button");
      bubbleOpacity = 1;
      bubbleScale = 1;
      pointerTarget = "bubble";
      pointerOpacity = segment(t, 3.05, 3.45);
      pointerPress = segment(t, 3.82, 4.05) * (1 - segment(t, 4.05, 4.2));
      bubbleScale = 1 - pointerPress * 0.14;
    } else if (t < 5.15) {
      setPhase("pixels-turn", "Windows turns the pixels first");
      contentAngle = mix(0, Math.PI / 2, segment(t, 4.2, 5.1));
      bubbleOpacity = 1 - segment(t, 4.2, 4.55);
      pointerOpacity = 1 - segment(t, 4.2, 4.58);
      pointerTarget = "bubble";
    } else if (t < 7.25) {
      setPhase("swivel-portrait", "Now swivel the right side down");
      contentAngle = Math.PI / 2;
      gripOpacity = segment(t, 5.15, 5.55) * (1 - segment(t, 6.9, 7.25));
      panelAngle = mix(0, -Math.PI / 2, segment(t, 5.55, 6.95));
    } else if (t < 8.4) {
      setPhase("portrait", "Portrait. Very dignified.");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
    } else if (t < 9.45) {
      setPhase("touch-reader-portrait", "Touch the reader at the bottom");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      portraitPointer = true;
      pointerOpacity = segment(t, 8.4, 8.78);
      pointerPress = segment(t, 9.03, 9.27) * (1 - segment(t, 9.27, 9.45));
    } else if (t < 10.3) {
      setPhase("bubble-portrait", "The button follows the reader");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      portraitPointer = true;
      pointerOpacity = 1 - segment(t, 9.72, 10.3);
      bubbleOpacity = segment(t, 9.45, 9.82);
      bubbleScale = mix(0.25, 1, segment(t, 9.45, 9.92));
    } else if (t < 11.45) {
      setPhase("tap-bubble-portrait", "Tap once more");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      portraitPointer = true;
      pointerTarget = "bubble";
      pointerOpacity = segment(t, 10.3, 10.65);
      pointerPress = segment(t, 11.02, 11.25) * (1 - segment(t, 11.25, 11.45));
      bubbleOpacity = 1;
      bubbleScale = 1 - pointerPress * 0.14;
    } else if (t < 12.4) {
      setPhase("pixels-return", "Windows turns the pixels back");
      contentAngle = mix(Math.PI / 2, 0, segment(t, 11.45, 12.35));
      panelAngle = -Math.PI / 2;
      portraitPointer = true;
      pointerTarget = "bubble";
      pointerOpacity = 1 - segment(t, 11.45, 11.82);
      bubbleOpacity = 1 - segment(t, 11.45, 11.8);
    } else if (t < 14.55) {
      setPhase("swivel-landscape", "Lift the right side back up");
      panelAngle = mix(-Math.PI / 2, 0, segment(t, 12.8, 14.2));
      gripCorner = new THREE.Vector3(-2.82, 1.63, 0.2);
      gripOpacity = segment(t, 12.4, 12.8) * (1 - segment(t, 14.2, 14.55));
    } else {
      setPhase("done", "And somehow no Settings maze was involved");
    }

    display.rotation.z = panelAngle;
    ui.draw(contentAngle);
    bubble.rotation.z = -panelAngle;
    bubbleMaterial.opacity = bubbleOpacity;
    bubble.scale.setScalar(bubbleScale);
    bubble.visible = bubbleOpacity > 0.002;

    if (pointerOpacity > 0.002) {
      const sensorTarget = getWorldPosition(new THREE.Vector3(2.96, 0, 0.32));
      const bubbleTarget = getWorldPosition(new THREE.Vector3(2.03, 0, 0.34));
      targetWorld.copy(pointerTarget === "bubble" ? bubbleTarget : sensorTarget);
      placePointer(targetWorld, portraitPointer, pointerOpacity, pointerPress, pointerTarget === "sensor");
    } else {
      pointer.visible = false;
    }

    if (gripOpacity > 0.002) {
      placeGrip(gripCorner, gripOpacity, panelAngle);
    } else {
      grip.visible = false;
    }

    renderer.render(scene, camera);
    if (!reduceMotion && frozenTime === null) requestAnimationFrame(animate);
  }

  function resize() {
    const rect = demo.getBoundingClientRect();
    const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
    renderer.setSize(size, size, false);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(demo);
  resize();
  demo.classList.add("webgl-ready");
  demo.dataset.phase = reduceMotion ? "reduced-motion" : "ready";
  requestAnimationFrame(animate);
} catch (error) {
  console.warn("Swivel 3D preview unavailable; showing the poster instead.", error);
  demo.dataset.phase = "fallback";
}
