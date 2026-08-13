import * as THREE from "three";

export async function mountSwivelScene(root = document) {
const demo = root.matches?.(".demo") ? root : root.querySelector(".demo");
const canvas = demo?.querySelector("#swivel-scene");
const modeButtons = [...(demo?.querySelectorAll("[data-demo-mode]") ?? [])];
const cursorElement = demo?.querySelector(".demo-cursor");
const forceLine = demo?.querySelector(".drag-force-line");
const forceEnd = demo?.querySelector(".drag-force-end");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const requestedTime = Number.parseFloat(new URLSearchParams(window.location.search).get("t"));
const frozenTime = Number.isFinite(requestedTime) ? requestedTime : null;
const requestedMode = new URLSearchParams(window.location.search).get("mode");
let renderer = null;
let observer = null;
let animationFrame = 0;
let disposed = false;
const scheduleFrame = (callback) => {
  if (!disposed) animationFrame = requestAnimationFrame(callback);
};

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
  let lastMode = "";

  const roundRect = (x, y, width, height, radius, fill) => {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fillStyle = fill;
    context.fill();
  };

  const draw = (angle, mode = "stand") => {
    if (Math.abs(angle - lastAngle) < 0.002 && mode === lastMode) return;
    lastAngle = angle;
    lastMode = mode;
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

    if (mode === "monitor") {
      roundRect(0, height - 54, width, 54, 0, "rgba(11,18,34,.88)");
      roundRect(width - 58, height - 46, 38, 38, 10, "#5f74ed");
      context.save();
      context.translate(width - 39, height - 27);
      context.strokeStyle = "white";
      context.lineWidth = 4;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(-9, 7);
      context.bezierCurveTo(0, 10, 9, 2, 8, -8);
      context.moveTo(-9, 7);
      context.lineTo(-4, 1);
      context.moveTo(-9, 7);
      context.lineTo(-2, 10);
      context.moveTo(8, -8);
      context.lineTo(2, -3);
      context.moveTo(8, -8);
      context.lineTo(12, -2);
      context.stroke();
      context.restore();
    }
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

function createLabelTexture(label) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(18,24,38,.94)";
  context.beginPath();
  context.roundRect(8, 8, 496, 144, 64);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "700 48px Segoe UI, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 256, 80);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

try {
  renderer = new THREE.WebGLRenderer({
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
  const wallMaterial = material(0xe9e2d9, 0.88, 0.02);

  const stand = new THREE.Group();
  const legSpecs = [
    [new THREE.Vector3(-1.78, 1.9, 0.02), new THREE.Vector3(-2.48, -2.38, 0.72)],
    [new THREE.Vector3(1.78, 1.9, 0.02), new THREE.Vector3(2.48, -2.38, 0.72)],
    [new THREE.Vector3(-1.48, 1.74, -0.54), new THREE.Vector3(-1.76, -2.36, -0.72)],
    [new THREE.Vector3(1.48, 1.74, -0.54), new THREE.Vector3(1.76, -2.36, -0.72)]
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
  const mountPlate = new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.36, 0.18, 48), silver);
  mountPlate.rotation.x = Math.PI / 2;
  mountPlate.scale.y = 1.2;
  mountPlate.position.set(0, 1.55, -0.3);
  mountPlate.castShadow = true;
  stand.add(mountPlate);

  const mountRibs = new THREE.Group();
  mountRibs.position.set(0, 1.55, -0.18);
  for (const x of [-0.76, -0.38, 0, 0.38, 0.76]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.055, 2.58, 0.055), darkSilver);
    rib.position.x = x;
    mountRibs.add(rib);
  }
  for (const y of [-0.88, -0.44, 0, 0.44, 0.88]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.055, 0.055), darkSilver);
    rib.position.y = y;
    mountRibs.add(rib);
  }
  stand.add(mountRibs);
  scene.add(stand);

  const wallMount = new THREE.Group();
  const wallSurface = new THREE.Mesh(roundedSolid(8.8, 7.2, 0.45, 0.12, 0.03), wallMaterial);
  wallSurface.position.set(0, 0.28, -0.76);
  wallSurface.receiveShadow = true;
  wallMount.add(wallSurface);

  const plateShape = new THREE.Shape();
  plateShape.absarc(0, 0, 2.18, 0, Math.PI * 2, false);
  const plateOpening = new THREE.Path();
  plateOpening.moveTo(-0.82, -0.74);
  plateOpening.lineTo(0.82, -0.74);
  plateOpening.quadraticCurveTo(0.96, -0.74, 0.96, -0.6);
  plateOpening.lineTo(0.96, 0.6);
  plateOpening.quadraticCurveTo(0.96, 0.74, 0.82, 0.74);
  plateOpening.lineTo(-0.82, 0.74);
  plateOpening.quadraticCurveTo(-0.96, 0.74, -0.96, 0.6);
  plateOpening.lineTo(-0.96, -0.6);
  plateOpening.quadraticCurveTo(-0.96, -0.74, -0.82, -0.74);
  plateShape.holes.push(plateOpening);
  const plateGeometry = new THREE.ExtrudeGeometry(plateShape, {
    depth: 0.18,
    curveSegments: 48,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.035,
    bevelThickness: 0.035
  });
  plateGeometry.translate(0, 0, -0.09);
  const wallPlate = new THREE.Mesh(plateGeometry, silver);
  wallPlate.position.set(0, 0.3, -0.5);
  wallPlate.castShadow = true;
  wallMount.add(wallPlate);

  for (const [x, y] of [[-1.54, 1.08], [1.54, 1.08], [-1.54, -1.08], [1.54, -1.08]]) {
    const slot = new THREE.Mesh(roundedSolid(0.46, 0.12, 0.06, 0.045, 0.012), darkSilver);
    slot.position.set(x, y + 0.3, -0.38);
    wallMount.add(slot);
  }
  wallMount.visible = false;
  scene.add(wallMount);

  const monitorStand = new THREE.Group();
  const monitorStem = cylinderBetween(
    new THREE.Vector3(0, -2.25, -0.1),
    new THREE.Vector3(0, 0.52, -0.1),
    0.16,
    silver,
    24);
  monitorStand.add(monitorStem);
  const monitorNeck = cylinderBetween(
    new THREE.Vector3(-1.5, 0.52, -0.1),
    new THREE.Vector3(1.5, 0.52, -0.1),
    0.13,
    darkSilver,
    24);
  monitorStand.add(monitorNeck);
  const monitorBase = new THREE.Mesh(roundedSolid(3.25, 0.82, 0.3, 0.2, 0.04), darkSilver);
  monitorBase.rotation.x = -Math.PI / 2;
  monitorBase.position.set(0, -2.42, 0.12);
  monitorBase.castShadow = true;
  monitorStand.add(monitorBase);
  monitorStand.visible = false;
  scene.add(monitorStand);

  // Pitch the panel back around its horizontal axis. The camera supplies the
  // isometric side view; the screen itself stays square to its physical mount.
  const displayMount = new THREE.Group();
  displayMount.position.set(0, 1.55, 0.82);
  displayMount.rotation.x = -0.14;
  scene.add(displayMount);

  const display = new THREE.Group();
  displayMount.add(display);

  const chassis = new THREE.Mesh(roundedSolid(5.88, 3.5, 0.27, 0.28, 0.055), silver);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  display.add(chassis);

  const frame = new THREE.Mesh(roundedSolid(5.72, 3.34, 0.22, 0.11, 0.04), frameMaterial);
  frame.position.z = 0.07;
  frame.castShadow = true;
  frame.receiveShadow = true;
  display.add(frame);

  const ui = createUiTexture();
  const screenMaterial = new THREE.MeshBasicMaterial({ map: ui.texture, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.32, 2.94), screenMaterial);
  screen.position.z = 0.225;
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
  glass.position.z = 0.238;
  glass.renderOrder = 3;
  display.add(glass);

  const reflection = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 2.72),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, depthWrite: false })
  );
  reflection.position.set(-1.55, 0.5, 0.244);
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
  const readerHit = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.76),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }));
  readerHit.position.z = 0.18;
  readerHit.userData.action = "trigger";
  reader.add(readerHit);
  display.add(reader);

  const loader = new THREE.TextureLoader();
  const [buttonTexture, pointerTexture, gripTexture] = await Promise.all([
    loader.loadAsync("assets/3d/rotation-button.png?v=3"),
    loader.loadAsync("assets/3d/pointer-hand.png"),
    loader.loadAsync("assets/3d/grip-hand-v2.png")
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
  const bubbleGroup = new THREE.Group();
  bubbleGroup.position.set(2.03, 0, 0.265);
  bubbleGroup.renderOrder = 10;
  display.add(bubbleGroup);

  const bubble = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), bubbleMaterial);
  bubble.userData.action = "bubble";
  bubble.renderOrder = 10;
  bubbleGroup.add(bubble);

  const ringPoints = [];
  for (let index = 0; index <= 72; index += 1) {
    const angle = -Math.PI / 2 + (index / 72) * Math.PI * 2;
    ringPoints.push(new THREE.Vector3(Math.cos(angle) * 0.43, Math.sin(angle) * 0.43, 0.012));
  }
  const ringGeometry = new THREE.BufferGeometry().setFromPoints(ringPoints);
  const ringBackground = new THREE.Line(
    ringGeometry.clone(),
    new THREE.LineBasicMaterial({ color: 0x26345f, transparent: true, opacity: 0.35, depthTest: false }));
  ringBackground.renderOrder = 11;
  bubbleGroup.add(ringBackground);
  const ringProgress = new THREE.Line(
    ringGeometry,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }));
  ringProgress.geometry.setDrawRange(0, 1);
  ringProgress.renderOrder = 12;
  bubbleGroup.add(ringProgress);

  const settingsMaterial = new THREE.MeshBasicMaterial({
    map: createLabelTexture("Open settings"),
    transparent: true,
    opacity: 0,
    depthTest: false,
    toneMapped: false
  });
  const settingsBubble = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.51), settingsMaterial);
  settingsBubble.position.set(0, -0.72, 0.014);
  settingsBubble.renderOrder = 13;
  bubbleGroup.add(settingsBubble);

  const trayHit = new THREE.Mesh(
    new THREE.PlaneGeometry(0.58, 0.42),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }));
  trayHit.position.set(2.36, -1.26, 0.255);
  trayHit.userData.action = "trigger";
  display.add(trayHit);

  const edgeHitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.001,
    depthWrite: false
  });
  const edgeHits = [
    [new THREE.BoxGeometry(0.42, 3.42, 0.72), 2.82, 0],
    [new THREE.BoxGeometry(0.42, 3.42, 0.72), -2.82, 0],
    [new THREE.BoxGeometry(5.46, 0.36, 0.72), 0, 1.67],
    [new THREE.BoxGeometry(5.46, 0.36, 0.72), 0, -1.67]
  ].map(([geometry, x, y]) => {
    const hit = new THREE.Mesh(geometry, edgeHitMaterial);
    hit.position.set(x, y, 0.05);
    hit.userData.action = "edge";
    display.add(hit);
    return hit;
  });

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

  function setPhase(name) {
    if (name === currentPhase) return;
    currentPhase = name;
    demo.dataset.phase = name;
  }

  function getWorldPosition(local) {
    display.updateMatrixWorld(true);
    return display.localToWorld(local.clone());
  }

  function getPointerPosition(target, portraitAmount, press = 0, isSensor = false) {
    const landscapeOffset = new THREE.Vector3((isSensor ? 1.9 : 1.62) - press * 0.11, 0, 0.92);
    const portraitOffset = new THREE.Vector3(0, -0.9 + press * 0.11, 0.92);
    const offset = landscapeOffset.lerp(portraitOffset, portraitAmount);
    return target.clone().add(offset);
  }

  function placePointer(position, portraitAmount, opacity, press = 0) {
    pointer.position.copy(position);
    pointerMaterial.rotation = mix(0, -Math.PI / 2, portraitAmount);
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

  function getGripPosition(localCorner) {
    return getWorldPosition(localCorner).add(new THREE.Vector3(0.46, 0.42, 0.9));
  }

  const raycaster = new THREE.Raycaster();
  const rayPosition = new THREE.Vector2();
  const cameraGoal = new THREE.Vector3(7.2, 5.4, 11.5);
  const cameraLook = new THREE.Vector3(0, 0.25, 0);
  let stageOffsetX = 0;
  let currentMode = "stand";
  let guided = !reduceMotion;
  let guidedStartedAt = performance.now();
  let lastActivityAt = performance.now();
  let lastFrameAt = performance.now();
  let physicalProgress = 0;
  let physicalTarget = 0;
  let contentProgress = 0;
  let contentTarget = 0;
  let bubbleVisible = false;
  let bubbleShownAt = 0;
  let settingsVisibleUntil = 0;
  let pressedAction = null;
  let pressedAt = 0;
  let bubbleHoldTriggered = false;
  let dragState = null;
  let guidedContentProgress = 0;

  function applyMode(mode) {
    currentMode = mode;
    demo.dataset.mode = mode;
    stand.visible = mode === "stand";
    wallMount.visible = mode === "wall";
    monitorStand.visible = mode === "monitor";
    stage.visible = mode !== "wall";
    reader.visible = mode !== "monitor";
    trayHit.visible = mode === "monitor";

    displayMount.rotation.y = 0;
    if (mode === "wall") {
      displayMount.position.set(0, 0.3, -0.12);
      displayMount.rotation.x = 0;
      display.scale.setScalar(0.92);
      cameraGoal.set(0, 0.6, 13);
      cameraLook.set(0, 0.28, 0);
    } else if (mode === "monitor") {
      displayMount.position.set(0, 1.38, 0.62);
      displayMount.rotation.x = -0.1;
      display.scale.setScalar(0.84);
      cameraGoal.set(6.8, 4.8, 11.8);
      cameraLook.set(0, 0.1, 0);
    } else {
      displayMount.position.set(0, 1.55, 0.82);
      displayMount.rotation.x = -0.14;
      display.scale.setScalar(1);
      cameraGoal.set(7.2, 5.4, 11.5);
      cameraLook.set(0, 0.25, 0);
    }

    cameraGoal.x += stageOffsetX;
    cameraLook.x = stageOffsetX;

    for (const button of modeButtons) {
      button.setAttribute("aria-selected", String(button.dataset.demoMode === mode));
    }
  }

  function restartGuide(message = "Watch once. Then the screen is yours.") {
    guided = !reduceMotion;
    guidedStartedAt = performance.now();
    physicalProgress = 0;
    physicalTarget = 0;
    contentProgress = 0;
    contentTarget = 0;
    bubbleVisible = false;
    settingsVisibleUntil = 0;
    dragState = null;
    demo.classList.remove("is-interactive", "is-dragging", "pointer-inside");
    setPhase("guided", message);
  }

  function enterInteractive(preserveGuideState = false) {
    guided = false;
    if (preserveGuideState) {
      physicalProgress = clamp(-display.rotation.z / (Math.PI / 2));
      contentProgress = guidedContentProgress;
      physicalTarget = physicalProgress;
      contentTarget = contentProgress;
    } else {
      physicalProgress = 0;
      physicalTarget = 0;
      contentProgress = 0;
      contentTarget = 0;
    }
    bubbleVisible = false;
    settingsVisibleUntil = 0;
    pointer.visible = false;
    grip.visible = false;
    lastActivityAt = performance.now();
    demo.classList.add("is-interactive");
    setPhase("interactive", "interactive");
  }

  function interruptGuide() {
    if (guided) enterInteractive(true);
  }

  function noteActivity() {
    lastActivityAt = performance.now();
  }

  function findAction(event) {
    const rect = canvas.getBoundingClientRect();
    rayPosition.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(rayPosition, camera);
    if (bubbleVisible && raycaster.intersectObject(bubble, false).length > 0) return "bubble";
    if (currentMode === "monitor") {
      return raycaster.intersectObject(trayHit, false).length > 0 ? "trigger" : null;
    }
    if (raycaster.intersectObject(readerHit, false).length > 0) return "trigger";
    if (raycaster.intersectObjects(edgeHits, false).length > 0) return "edge";
    return null;
  }

  function projectGripToDemo(localPoint) {
    display.updateMatrixWorld(true);
    const projected = display.localToWorld(localPoint.clone()).project(camera);
    const canvasRect = canvas.getBoundingClientRect();
    const demoRect = demo.getBoundingClientRect();
    return {
      x: canvasRect.left - demoRect.left + ((projected.x + 1) * 0.5) * canvasRect.width,
      y: canvasRect.top - demoRect.top + ((1 - projected.y) * 0.5) * canvasRect.height
    };
  }

  function getDragGeometry() {
    if (!dragState) return;
    const demoRect = demo.getBoundingClientRect();
    const pointerX = dragState.pointerX - demoRect.left;
    const pointerY = dragState.pointerY - demoRect.top;
    const gripPoint = projectGripToDemo(dragState.gripLocal);
    const centerPoint = projectGripToDemo(new THREE.Vector3());
    return { pointerX, pointerY, gripPoint, centerPoint };
  }

  function applyDragForce(deltaSeconds) {
    const geometry = getDragGeometry();
    if (!geometry) return;
    const { pointerX, pointerY, gripPoint, centerPoint } = geometry;
    const radialX = gripPoint.x - centerPoint.x;
    const radialY = gripPoint.y - centerPoint.y;
    const forceX = pointerX - gripPoint.x;
    const forceY = pointerY - gripPoint.y;
    const radialLength = Math.max(1, Math.hypot(radialX, radialY));
    const tangentialForce = (radialX * forceY - radialY * forceX) / radialLength;
    const effectiveForce = Math.sign(tangentialForce)
      * Math.max(0, Math.abs(tangentialForce) - 6);
    const dragDistance = Math.max(180, canvas.getBoundingClientRect().height * 0.42);
    const velocity = clamp(effectiveForce / dragDistance * 9.5, -2.75, 2.75);
    physicalProgress = clamp(physicalProgress + velocity * deltaSeconds);
    physicalTarget = physicalProgress;
    dragState.velocity = velocity;
  }

  function updateDragVisual() {
    const geometry = getDragGeometry();
    if (!geometry) return;
    const { pointerX, pointerY, gripPoint } = geometry;
    if (cursorElement) {
      cursorElement.style.left = `${gripPoint.x}px`;
      cursorElement.style.top = `${gripPoint.y}px`;
    }
    if (forceLine) {
      forceLine.setAttribute("x1", String(gripPoint.x));
      forceLine.setAttribute("y1", String(gripPoint.y));
      forceLine.setAttribute("x2", String(pointerX));
      forceLine.setAttribute("y2", String(pointerY));
    }
    if (forceEnd) {
      forceEnd.setAttribute("cx", String(pointerX));
      forceEnd.setAttribute("cy", String(pointerY));
    }
  }

  function updateInteractiveCaption() {
    if (dragState) setPhase("dragging", "dragging");
    else if (Math.abs(contentTarget - physicalProgress) > 0.025) setPhase("ready-to-swivel", "ready");
    else if (bubbleVisible) setPhase("bubble-live", "bubble");
    else if (physicalProgress > 0.98) setPhase("portrait-ready", "portrait");
    else setPhase("interactive", "interactive");
  }

  function showBubble(now) {
    bubbleVisible = true;
    bubbleShownAt = now;
    settingsVisibleUntil = 0;
    updateInteractiveCaption();
  }

  function activateBubble() {
    bubbleVisible = false;
    settingsVisibleUntil = 0;
    contentTarget = contentTarget > 0.5 ? 0 : 1;
    updateInteractiveCaption();
  }

  function releaseDragCursor(event) {
    if (!cursorElement) return;
    const demoRect = demo.getBoundingClientRect();
    cursorElement.style.left = `${event.clientX - demoRect.left}px`;
    cursorElement.style.top = `${event.clientY - demoRect.top}px`;
    cursorElement.src = findAction(event) === "edge"
      ? "assets/3d/grip-hand-v2.png"
      : "assets/3d/pointer-hand.png";
  }

  canvas.addEventListener("pointerenter", () => {
    if (!guided) demo.classList.add("pointer-inside");
  });
  canvas.addEventListener("pointerleave", () => {
    if (!dragState) demo.classList.remove("pointer-inside");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (guided) return;
    noteActivity();
    const demoRect = demo.getBoundingClientRect();
    if (cursorElement && !dragState) {
      cursorElement.style.left = `${event.clientX - demoRect.left}px`;
      cursorElement.style.top = `${event.clientY - demoRect.top}px`;
    }

    if (dragState) {
      dragState.pointerX = event.clientX;
      dragState.pointerY = event.clientY;
      updateInteractiveCaption();
      return;
    }

    const action = findAction(event);
    if (cursorElement) {
      cursorElement.src = action === "edge"
        ? "assets/3d/grip-hand-v2.png"
        : "assets/3d/pointer-hand.png";
    }
  });
  canvas.addEventListener("pointerdown", (event) => {
    interruptGuide();
    noteActivity();
    const action = findAction(event);
    pressedAction = action;
    pressedAt = performance.now();
    bubbleHoldTriggered = false;
    if (action === "edge") {
      const edgeHit = raycaster.intersectObjects(edgeHits, false)[0];
      display.updateMatrixWorld(true);
      dragState = {
        startProgress: physicalProgress,
        pointerX: event.clientX,
        pointerY: event.clientY,
        velocity: 0,
        gripLocal: display.worldToLocal(edgeHit.point.clone())
      };
      if (cursorElement) cursorElement.src = "assets/3d/grip-hand-v2.png";
      demo.classList.add("is-dragging");
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic accessibility/testing events may not own a native pointer.
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    interruptGuide();
    noteActivity();
    const now = performance.now();
    if (dragState) {
      const releaseProgress = clamp(physicalProgress + dragState.velocity * 0.1);
      const startedPortrait = dragState.startProgress >= 0.5;
      physicalTarget = startedPortrait
        ? (releaseProgress <= 0.15 ? 0 : 1)
        : (releaseProgress >= 0.85 ? 1 : 0);
      dragState = null;
      demo.classList.remove("is-dragging");
      releaseDragCursor(event);
      updateInteractiveCaption();
    } else if (pressedAction === "trigger" && findAction(event) === "trigger") {
      if (currentMode === "monitor") {
        const next = contentTarget > 0.5 ? 0 : 1;
        contentTarget = next;
        physicalTarget = next;
        bubbleVisible = false;
      } else {
        bubbleVisible ? (bubbleVisible = false) : showBubble(now);
      }
      updateInteractiveCaption();
    } else if (pressedAction === "bubble" && findAction(event) === "bubble") {
      if (bubbleHoldTriggered) {
        settingsVisibleUntil = now + 2200;
        bubbleShownAt = now;
      } else {
        activateBubble();
      }
    }
    pressedAction = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (dragState) {
      physicalTarget = dragState.startProgress;
      dragState = null;
    }
    pressedAction = null;
    demo.classList.remove("is-dragging");
    releaseDragCursor(event);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      applyMode(button.dataset.demoMode || "stand");
      restartGuide(`A quick ${button.textContent.trim()} version. Then you take over.`);
    });
  }

  applyMode(["stand", "wall", "monitor"].includes(requestedMode) ? requestedMode : "stand");
  if (reduceMotion) enterInteractive();

  function animate(time) {
    const deltaSeconds = Math.min(0.05, Math.max(0, (time - lastFrameAt) / 1000));
    lastFrameAt = time;
    camera.position.lerp(cameraGoal, 1 - Math.exp(-deltaSeconds * 7));
    camera.lookAt(cameraLook);

    if (!guided && time - lastActivityAt >= 20000) {
      restartGuide("Need a hand? Here it comes.");
    }

    if (!guided) {
      const ease = 1 - Math.exp(-deltaSeconds * 8.5);
      if (dragState) applyDragForce(deltaSeconds);
      else physicalProgress = mix(physicalProgress, physicalTarget, ease);
      contentProgress = mix(contentProgress, contentTarget, ease);
      if (Math.abs(physicalProgress - physicalTarget) < 0.001) physicalProgress = physicalTarget;
      if (Math.abs(contentProgress - contentTarget) < 0.001) contentProgress = contentTarget;

      if (bubbleVisible && time - bubbleShownAt >= 4200 && settingsVisibleUntil <= time) {
        bubbleVisible = false;
        updateInteractiveCaption();
      }

      if (pressedAction === "bubble" && !bubbleHoldTriggered && time - pressedAt >= 2000) {
        bubbleHoldTriggered = true;
        settingsVisibleUntil = time + 2200;
        bubbleShownAt = time;
        setPhase("settings-reveal", "There it is: Settings, without cluttering every tap.");
      }

      const bubbleProgress = bubbleVisible ? clamp((time - bubbleShownAt) / 4200) : 0;
      const settingsOpacity = settingsVisibleUntil > time ? 1 : 0;
      display.rotation.z = mix(0, -Math.PI / 2, physicalProgress);
      if (dragState) updateDragVisual();
      ui.draw(mix(0, Math.PI / 2, contentProgress), currentMode);
      bubbleGroup.rotation.z = -display.rotation.z;
      bubbleMaterial.opacity = bubbleVisible ? 1 : 0;
      bubbleGroup.scale.setScalar(bubbleVisible ? 1 : 0.25);
      bubbleGroup.visible = bubbleVisible;
      ringProgress.geometry.setDrawRange(0, Math.max(1, Math.floor(bubbleProgress * ringPoints.length)));
      settingsMaterial.opacity = settingsOpacity;
      settingsBubble.visible = settingsOpacity > 0;
      pointer.visible = false;
      grip.visible = false;
      renderer.render(scene, camera);
      scheduleFrame(animate);
      return;
    }

    const t = frozenTime ?? (time - guidedStartedAt) / 1000;
    let panelAngle = 0;
    let contentAngle = 0;
    let bubbleOpacity = 0;
    let bubbleScale = 0.25;
    let bubbleProgress = 0;
    let pointerOpacity = 1;
    let pointerPress = 0;
    let pointerPortraitAmount = 0;
    const triggerTarget = currentMode === "monitor" ? "tray" : "sensor";
    let pointerFromTarget = triggerTarget;
    let pointerToTarget = triggerTarget;
    let pointerMove = 1;
    let gripOpacity = 0;
    let gripCorner = new THREE.Vector3(2.82, 1.63, 0.2);

    if (currentMode === "monitor") {
      bubbleOpacity = 0;
      if (t < 1.25) {
        setPhase("monitor-landscape", "monitor landscape");
      } else if (t < 2.1) {
        setPhase("monitor-click", "tray click");
        pointerPress = segment(t, 1.62, 1.88) * (1 - segment(t, 1.88, 2.08));
      } else if (t < 4.25) {
        setPhase("monitor-turn", "monitor turns");
        const turn = segment(t, 2.1, 3.85);
        contentAngle = mix(0, Math.PI / 2, turn);
        panelAngle = mix(0, -Math.PI / 2, turn);
        pointerPortraitAmount = turn;
        pointerOpacity = 1 - segment(t, 2.1, 2.55);
      } else if (t < 5.45) {
        setPhase("monitor-portrait", "monitor portrait");
        contentAngle = Math.PI / 2;
        panelAngle = -Math.PI / 2;
        pointerPortraitAmount = 1;
        pointerOpacity = segment(t, 4.25, 4.75);
      } else if (t < 6.3) {
        setPhase("monitor-click-return", "tray click");
        contentAngle = Math.PI / 2;
        panelAngle = -Math.PI / 2;
        pointerPortraitAmount = 1;
        pointerPress = segment(t, 5.72, 5.98) * (1 - segment(t, 5.98, 6.25));
      } else if (t < 8.35) {
        setPhase("monitor-return", "monitor returns");
        const turn = segment(t, 6.3, 8.0);
        contentAngle = mix(Math.PI / 2, 0, turn);
        panelAngle = mix(-Math.PI / 2, 0, turn);
        pointerPortraitAmount = 1 - turn;
        pointerOpacity = 1 - segment(t, 6.3, 6.75);
      } else if (frozenTime === null) {
        enterInteractive();
        scheduleFrame(animate);
        return;
      }
    } else if (t < 1.15) {
      setPhase("landscape", currentMode === "monitor" ? "Click Swivel in the tray" : "Touch the fingerprint reader");
    } else if (t < 2.2) {
      setPhase("touch-reader", currentMode === "monitor" ? "Click Swivel in the tray" : "Touch the edge reader");
      pointerPress = segment(t, 1.82, 2.08) * (1 - segment(t, 2.08, 2.2));
    } else if (t < 3.05) {
      setPhase("bubble-appears", "The blue button appears on screen");
      bubbleOpacity = segment(t, 2.2, 2.58);
      bubbleScale = mix(0.25, 1, segment(t, 2.2, 2.68));
      bubbleProgress = segment(t, 2.2, 4.2) * 0.46;
      pointerToTarget = "bubble";
      pointerMove = segment(t, 2.48, 3.02);
    } else if (t < 4.2) {
      setPhase("tap-bubble", "Tap the blue button");
      bubbleOpacity = 1;
      bubbleProgress = mix(0.46, 0.63, segment(t, 3.05, 4.2));
      pointerFromTarget = "bubble";
      pointerToTarget = "bubble";
      pointerPress = segment(t, 3.82, 4.05) * (1 - segment(t, 4.05, 4.2));
      bubbleScale = 1 - pointerPress * 0.14;
    } else if (t < 5.15) {
      setPhase("pixels-turn", "Windows turns the pixels first");
      contentAngle = mix(0, Math.PI / 2, segment(t, 4.2, 5.1));
      bubbleOpacity = 1 - segment(t, 4.2, 4.55);
      pointerFromTarget = "bubble";
      pointerToTarget = "bubble";
    } else if (t < 7.25) {
      setPhase("swivel-portrait", "Now swivel the right side down");
      contentAngle = Math.PI / 2;
      panelAngle = mix(0, -Math.PI / 2, segment(t, 5.55, 6.95));
      const takeGrip = segment(t, 5.15, 5.68);
      const releaseGrip = segment(t, 6.82, 7.25);
      pointerFromTarget = takeGrip < 1 ? "bubble" : "grip";
      pointerToTarget = releaseGrip > 0 ? triggerTarget : "grip";
      pointerMove = releaseGrip > 0 ? releaseGrip : takeGrip;
      pointerPortraitAmount = releaseGrip;
      pointerOpacity = 1 - takeGrip + releaseGrip;
      gripOpacity = takeGrip * (1 - releaseGrip);
    } else if (t < 8.4) {
      setPhase("portrait", "Portrait. Very dignified.");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
    } else if (t < 9.45) {
      setPhase("touch-reader-portrait", currentMode === "monitor" ? "Click the tray icon again" : "Touch the reader at the bottom");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
      pointerPress = segment(t, 9.03, 9.27) * (1 - segment(t, 9.27, 9.45));
    } else if (t < 10.3) {
      setPhase("bubble-portrait", "The button follows the reader");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
      pointerToTarget = "bubble";
      pointerMove = segment(t, 9.72, 10.26);
      bubbleOpacity = segment(t, 9.45, 9.82);
      bubbleScale = mix(0.25, 1, segment(t, 9.45, 9.92));
    } else if (t < 11.45) {
      setPhase("tap-bubble-portrait", "Tap once more");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
      pointerFromTarget = "bubble";
      pointerToTarget = "bubble";
      pointerPress = segment(t, 11.02, 11.25) * (1 - segment(t, 11.25, 11.45));
      bubbleOpacity = 1;
      bubbleScale = 1 - pointerPress * 0.14;
    } else if (t < 12.4) {
      setPhase("pixels-return", "Windows turns the pixels back");
      contentAngle = mix(Math.PI / 2, 0, segment(t, 11.45, 12.35));
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
      pointerFromTarget = "bubble";
      pointerToTarget = "bubble";
      bubbleOpacity = 1 - segment(t, 11.45, 11.8);
    } else if (t < 14.55) {
      setPhase("swivel-landscape", "Lift the right side back up");
      panelAngle = mix(-Math.PI / 2, 0, segment(t, 12.8, 14.2));
      gripCorner = new THREE.Vector3(-2.82, 1.63, 0.2);
      const takeGrip = segment(t, 12.4, 12.88);
      const releaseGrip = segment(t, 14.08, 14.55);
      pointerFromTarget = takeGrip < 1 ? "bubble" : "grip";
      pointerToTarget = releaseGrip > 0 ? triggerTarget : "grip";
      pointerMove = releaseGrip > 0 ? releaseGrip : takeGrip;
      pointerPortraitAmount = 1 - releaseGrip;
      pointerOpacity = 1 - takeGrip + releaseGrip;
      gripOpacity = takeGrip * (1 - releaseGrip);
    } else {
      if (frozenTime === null) {
        enterInteractive();
        scheduleFrame(animate);
        return;
      }
      setPhase("done", "Now you try it.");
    }

    guidedContentProgress = clamp(contentAngle / (Math.PI / 2));
    display.rotation.z = panelAngle;
    ui.draw(contentAngle, currentMode);
    bubbleGroup.rotation.z = -panelAngle;
    bubbleMaterial.opacity = bubbleOpacity;
    bubbleGroup.scale.setScalar(bubbleScale);
    bubbleGroup.visible = bubbleOpacity > 0.002;
    ringProgress.geometry.setDrawRange(0, Math.max(1, Math.floor(bubbleProgress * ringPoints.length)));
    settingsMaterial.opacity = 0;
    settingsBubble.visible = false;

    if (pointerOpacity > 0.002) {
      const sensorTarget = getWorldPosition(new THREE.Vector3(2.96, 0, 0.32));
      const bubbleTarget = getWorldPosition(new THREE.Vector3(2.03, 0, 0.34));
      const trayTarget = getWorldPosition(new THREE.Vector3(2.36, -1.26, 0.3));
      const gripTarget = getGripPosition(gripCorner);
      const resolvePointerTarget = (name) => {
        if (name === "grip") return gripTarget;
        if (name === "tray") return getPointerPosition(trayTarget, pointerPortraitAmount, pointerPress, false);
        const isSensor = name === "sensor";
        return getPointerPosition(isSensor ? sensorTarget : bubbleTarget, pointerPortraitAmount, pointerPress, isSensor);
      };
      fromWorld.copy(resolvePointerTarget(pointerFromTarget));
      toWorld.copy(resolvePointerTarget(pointerToTarget));
      targetWorld.lerpVectors(fromWorld, toWorld, pointerMove);
      placePointer(targetWorld, pointerPortraitAmount, pointerOpacity, pointerPress);
    } else {
      pointer.visible = false;
    }

    if (gripOpacity > 0.002) {
      placeGrip(gripCorner, gripOpacity, panelAngle);
    } else {
      grip.visible = false;
    }

    renderer.render(scene, camera);
    scheduleFrame(animate);
  }

  function resize() {
    const rect = demo.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const aspect = width / height;
    const verticalHalf = 5.8;
    camera.left = -verticalHalf * aspect;
    camera.right = verticalHalf * aspect;
    camera.top = verticalHalf;
    camera.bottom = -verticalHalf;
    camera.updateProjectionMatrix();

    const previousOffset = stageOffsetX;
    stageOffsetX = aspect > 1.1
      ? -Math.min(5.2, (aspect - 1) * 5.2)
      : 0;
    cameraGoal.x += stageOffsetX - previousOffset;
    cameraLook.x = stageOffsetX;
    renderer.setSize(width, height, false);
  }

  observer = new ResizeObserver(resize);
  observer.observe(demo);
  resize();
  demo.classList.add("webgl-ready");
  demo.dataset.phase = reduceMotion ? "reduced-motion" : "ready";
  scheduleFrame(animate);
} catch (error) {
  console.warn("Swivel 3D preview unavailable; showing the poster instead.", error);
  demo.dataset.phase = "fallback";
}

return () => {
  disposed = true;
  cancelAnimationFrame(animationFrame);
  observer?.disconnect();
  renderer?.dispose();
  demo.classList.remove("webgl-ready", "is-interactive", "is-dragging", "pointer-inside");
};
}
