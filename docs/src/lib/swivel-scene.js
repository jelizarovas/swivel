import * as THREE from "three";
import { createInteractiveDesktopTexture } from "./interactive-desktop";

export async function mountSwivelScene(root = document) {
const demo = root.matches?.(".demo") ? root : root.querySelector(".demo");
const canvas = demo?.querySelector("#swivel-scene");
const modeButtons = [...(demo?.querySelectorAll("[data-demo-mode]") ?? [])];
const cursorElement = demo?.querySelector(".demo-cursor");
const gripElement = demo?.querySelector(".demo-grip");
const forceVector = demo?.querySelector(".drag-force-vector");
const forceLine = demo?.querySelector(".drag-force-line");
const forceEnd = demo?.querySelector(".drag-force-end");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const requestedTime = Number.parseFloat(new URLSearchParams(window.location.search).get("t"));
const frozenTime = Number.isFinite(requestedTime) ? requestedTime : null;
const requestedMode = new URLSearchParams(window.location.search).get("mode");
let renderer = null;
let observer = null;
let visibilityObserver = null;
let animationFrame = 0;
let disposed = false;
let disposeUi = null;
let documentVisibilityHandler = null;
let loopPaused = false;
let documentVisible = !document.hidden;
let demoVisible = true;
let pausedAt = 0;
const scheduleFrame = (callback) => {
  if (!disposed && !loopPaused && animationFrame === 0) {
    animationFrame = requestAnimationFrame(callback);
  }
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

function roundedRingSolid(
  width,
  height,
  radius,
  innerWidth,
  innerHeight,
  innerRadius,
  depth,
  bevel = 0.02
) {
  const shape = roundedRectShape(width, height, radius);
  shape.holes.push(roundedRectShape(innerWidth, innerHeight, innerRadius));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 12,
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
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

function tubeAlong(points, radius, meshMaterial, tubularSegments = 28) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, tubularSegments, radius, 10, false),
    meshMaterial
  );
  mesh.castShadow = true;
  return mesh;
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

function createLensFlareTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const halo = context.createRadialGradient(256, 128, 0, 256, 128, 116);
  halo.addColorStop(0, "rgba(238,247,255,.98)");
  halo.addColorStop(0.08, "rgba(169,207,255,.78)");
  halo.addColorStop(0.3, "rgba(92,145,255,.24)");
  halo.addColorStop(1, "rgba(70,112,255,0)");
  context.fillStyle = halo;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const streak = context.createLinearGradient(0, 0, canvas.width, 0);
  streak.addColorStop(0, "rgba(106,154,255,0)");
  streak.addColorStop(0.38, "rgba(157,200,255,.06)");
  streak.addColorStop(0.5, "rgba(232,246,255,.54)");
  streak.addColorStop(0.62, "rgba(157,200,255,.06)");
  streak.addColorStop(1, "rgba(106,154,255,0)");
  context.fillStyle = streak;
  context.fillRect(0, 124, canvas.width, 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function selectRenderQuality() {
  const requestedQuality = new URLSearchParams(window.location.search).get("quality");
  if (["high", "balanced", "low"].includes(requestedQuality)) return requestedQuality;

  const memory = Number(navigator.deviceMemory) || 0;
  const cores = Number(navigator.hardwareConcurrency) || 0;

  if ((memory > 0 && memory <= 4) || (cores > 0 && cores <= 4)) return "low";
  return "balanced";
}

const renderQualityName = selectRenderQuality();
const renderQualityProfiles = {
  high: {
    dprCap: 1.5,
    maxPixels: 4_000_000,
    pendantShadowSize: window.matchMedia("(max-width: 860px)").matches ? 512 : 1024,
    studioShadow: true,
    floorBulbTransmission: 0.35
  },
  balanced: {
    dprCap: 1.25,
    maxPixels: 2_500_000,
    pendantShadowSize: 512,
    studioShadow: false,
    floorBulbTransmission: 0
  },
  low: {
    dprCap: 1,
    maxPixels: 1_500_000,
    pendantShadowSize: 256,
    studioShadow: false,
    floorBulbTransmission: 0
  }
};
const renderQuality = renderQualityProfiles[renderQualityName];
demo.dataset.renderQuality = renderQualityName;

function getEffectivePixelRatio(width, height) {
  const devicePixelRatio = window.devicePixelRatio || 1;
  const pixelBudgetRatio = Math.sqrt(renderQuality.maxPixels / Math.max(1, width * height));
  return Math.min(devicePixelRatio, renderQuality.dprCap, pixelBudgetRatio);
}

try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, renderQuality.dprCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5.8, 5.8, 5.8, -5.8, 0.1, 100);
  camera.position.set(7.2, 5.4, 11.5);
  camera.lookAt(0, 0.25, 0);

  scene.add(new THREE.HemisphereLight(0x263249, 0x06070b, 0.72));

  const pendantLightTarget = new THREE.Object3D();
  pendantLightTarget.position.set(0, 0.15, 0);
  scene.add(pendantLightTarget);
  const pendantLight = new THREE.SpotLight(0xffb76e, 92, 22, Math.PI / 3.35, 0.56, 1.55);
  pendantLight.target = pendantLightTarget;
  pendantLight.castShadow = true;
  pendantLight.shadow.mapSize.set(renderQuality.pendantShadowSize, renderQuality.pendantShadowSize);
  pendantLight.shadow.camera.near = 0.5;
  pendantLight.shadow.camera.far = 22;
  pendantLight.shadow.bias = -0.00035;
  pendantLight.shadow.normalBias = 0.025;
  pendantLight.shadow.radius = 3;
  scene.add(pendantLight);

  const studioLightTarget = new THREE.Object3D();
  studioLightTarget.position.set(0, 0.7, 0.1);
  scene.add(studioLightTarget);
  const studioLight = new THREE.SpotLight(0xc9ddff, 108, 25, Math.PI / 4.2, 0.48, 1.7);
  studioLight.position.set(1.45, -2.39, -3.9);
  studioLight.target = studioLightTarget;
  studioLight.castShadow = renderQuality.studioShadow;
  studioLight.shadow.mapSize.set(512, 512);
  studioLight.shadow.camera.near = 0.45;
  studioLight.shadow.camera.far = 22;
  studioLight.shadow.bias = -0.00025;
  studioLight.shadow.normalBias = 0.022;
  studioLight.shadow.radius = 2.5;
  scene.add(studioLight);

  const sceneRig = new THREE.Group();
  scene.add(sceneRig);
  scene.remove(studioLight, studioLightTarget);
  sceneRig.add(studioLight, studioLightTarget);

  const stage = new THREE.Mesh(
    new THREE.CylinderGeometry(4.55, 4.8, 0.34, 64),
    material(0x222433, 0.76)
  );
  stage.position.y = -2.83;
  stage.receiveShadow = true;
  sceneRig.add(stage);

  const silver = material(0xe1e4e8, 0.28, 0.24);
  const whiteMetal = material(0xf3f4f3, 0.34, 0.3);
  const whitePlastic = material(0xf4f4f1, 0.44, 0.04);
  const rearPlastic = material(0xf7f7f4, 0.48, 0.02);
  const darkSilver = material(0x7b8491, 0.38, 0.32);
  const tire = material(0x4f5660, 0.82, 0.02);
  const shelfMaterial = material(0x74777d, 0.9, 0.01);
  const cableDark = material(0x343941, 0.72, 0.02);
  const cableLight = material(0xd9dcde, 0.55, 0.04);
  const frameMaterial = material(0x11141b, 0.24, 0.5);
  const wallMaterial = material(0x171b25, 0.88, 0.02);
  const studioBlack = material(0x171922, 0.38, 0.18);
  const studioMetal = material(0x343b49, 0.3, 0.42);
  const warmShadeInner = new THREE.MeshStandardMaterial({
    color: 0xffd5a1,
    emissive: 0xff9e4d,
    emissiveIntensity: 0.65,
    roughness: 0.52,
    side: THREE.BackSide
  });
  const warmBulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xffdbad,
    emissive: 0xffa34f,
    emissiveIntensity: 4.2,
    roughness: 0.16
  });
  const pendantAnchor = new THREE.Vector3(-4.45, 8.55, 3.2);
  const pendantLength = 5.18;
  const pendantRestDirection = new THREE.Vector3(0, -1, 0);
  const pendantDirection = pendantRestDirection.clone();
  const pendantOmega = new THREE.Vector3();
  const pendantGroup = new THREE.Group();
  scene.add(pendantGroup);

  const pendantCeiling = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.31, 0.22, 28),
    studioBlack
  );
  pendantCeiling.position.copy(pendantAnchor).add(new THREE.Vector3(0, 0.08, 0));
  pendantCeiling.castShadow = true;
  scene.add(pendantCeiling);

  const pendantCord = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), studioBlack);
  pendantCord.castShadow = true;
  scene.add(pendantCord);
  const pendantCordHit = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 10),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
  );
  pendantCordHit.userData.action = "pendulum";
  pendantCordHit.userData.part = "cord";
  scene.add(pendantCordHit);

  const pendantShade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.52, 0.55, 32, 1, true),
    studioBlack
  );
  pendantShade.position.y = 0.25;
  pendantShade.castShadow = true;
  pendantGroup.add(pendantShade);
  const pendantShadeInner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.145, 0.485, 0.52, 32, 1, true),
    warmShadeInner
  );
  pendantShadeInner.position.y = 0.245;
  pendantGroup.add(pendantShadeInner);
  const pendantSocket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.24, 24), studioMetal);
  pendantSocket.position.y = 0.47;
  pendantSocket.castShadow = true;
  pendantGroup.add(pendantSocket);
  const pendantBulb = new THREE.Mesh(new THREE.SphereGeometry(0.23, 28, 20), warmBulbMaterial);
  pendantBulb.position.y = -0.34;
  pendantGroup.add(pendantBulb);
  const pendantGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 24, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffb25e,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  pendantGlow.position.y = -0.34;
  pendantGroup.add(pendantGlow);
  const pendantFill = new THREE.PointLight(0xffa85b, 19, 5.5, 2);
  pendantFill.position.y = -0.34;
  pendantGroup.add(pendantFill);
  const pendantRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.49, 0.035, 12, 36),
    new THREE.MeshStandardMaterial({
      color: 0x6f5136,
      emissive: 0xff9f50,
      emissiveIntensity: 0.85,
      roughness: 0.34
    })
  );
  pendantRim.rotation.x = Math.PI / 2;
  pendantRim.position.y = -0.025;
  pendantGroup.add(pendantRim);
  const pendantBulbHit = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 20, 14),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
  );
  pendantBulbHit.position.y = -0.34;
  pendantBulbHit.userData.action = "pendulum";
  pendantBulbHit.userData.part = "bulb";
  pendantGroup.add(pendantBulbHit);

  studioLight.intensity = 58;
  studioLight.distance = 15;
  studioLight.angle = Math.PI / 3;
  studioLight.penumbra = 0.76;
  studioLightTarget.position.set(0, 0.55, -0.05);

  const floorLightLevels = {
    spotlight: 58,
    fill: 6,
    glassEmissive: 1.35,
    coreEmissive: 4.8,
    flareOpacity: 0.12
  };
  let floorLightLevel = 1;
  let floorLightTarget = 1;
  demo.dataset.floorLight = "on";
  const floorBulbGroup = new THREE.Group();
  studioLight.position.set(1.45, -2.39, -3.9);
  floorBulbGroup.position.copy(studioLight.position);
  floorBulbGroup.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-0.78, 0.06, 0.62).normalize()
  );
  const floorBulbProfile = [
    [0.1, -0.3], [0.15, -0.24], [0.17, -0.15], [0.27, -0.03],
    [0.31, 0.12], [0.29, 0.25], [0.21, 0.36], [0.08, 0.43], [0, 0.45]
  ].map(([radius, y]) => new THREE.Vector2(radius, y));
  const floorBulbGlassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xdceaff,
      emissive: 0x77aaff,
      emissiveIntensity: floorLightLevels.glassEmissive,
      roughness: 0.12,
      transmission: renderQuality.floorBulbTransmission,
      thickness: renderQuality.floorBulbTransmission > 0 ? 0.12 : 0,
      transparent: true,
      opacity: 0.68,
      depthWrite: false
    });
  const floorBulbGlass = new THREE.Mesh(
    new THREE.LatheGeometry(floorBulbProfile, 32),
    floorBulbGlassMaterial
  );
  floorBulbGroup.add(floorBulbGlass);
  const floorBulbCoreMaterial = new THREE.MeshStandardMaterial({
    color: 0xf2f8ff,
    emissive: 0x8ebcff,
    emissiveIntensity: floorLightLevels.coreEmissive,
    roughness: 0.1
  });
  const floorBulbCore = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.09, 0.12, 6, 16),
    floorBulbCoreMaterial
  );
  floorBulbCore.position.y = 0.08;
  floorBulbGroup.add(floorBulbCore);
  const floorBulbSocket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.17, 0.28, 24),
    studioMetal
  );
  floorBulbSocket.position.y = -0.42;
  floorBulbSocket.castShadow = true;
  floorBulbGroup.add(floorBulbSocket);
  for (const y of [-0.35, -0.42, -0.49]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.166, 0.012, 8, 24), studioMetal);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = y;
    floorBulbGroup.add(rib);
  }
  const floorBulbFill = new THREE.PointLight(0x8ebdff, 6, 3.5, 2);
  floorBulbFill.position.y = 0.08;
  floorBulbGroup.add(floorBulbFill);
  const floorBulbHit = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 18, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
  );
  floorBulbHit.position.y = 0.02;
  floorBulbHit.userData.action = "floor-light";
  floorBulbGroup.add(floorBulbHit);
  sceneRig.add(floorBulbGroup);

  const floorSocketPosition = new THREE.Vector3(0, -0.57, 0)
    .applyQuaternion(floorBulbGroup.quaternion)
    .add(floorBulbGroup.position);
  const floorCable = tubeAlong([
    floorSocketPosition,
    new THREE.Vector3(1.95, -2.58, -3.56),
    new THREE.Vector3(2.55, -2.61, -3.05),
    new THREE.Vector3(3.08, -2.61, -2.45),
    new THREE.Vector3(2.72, -2.61, -1.9),
    new THREE.Vector3(2.02, -2.61, -2.06),
    new THREE.Vector3(1.72, -2.61, -2.82),
    new THREE.Vector3(2.38, -2.61, -3.42),
    new THREE.Vector3(3.28, -2.6, -3.2),
    new THREE.Vector3(4.05, -2.58, -2.35)
  ], 0.03, studioBlack, 70);
  sceneRig.add(floorCable);

  const flareTexture = createLensFlareTexture();
  const floorBulbFlareMaterial = new THREE.SpriteMaterial({
    map: flareTexture,
    color: 0xbcd8ff,
    transparent: true,
    opacity: floorLightLevels.flareOpacity,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  });
  const floorBulbFlare = new THREE.Sprite(floorBulbFlareMaterial);
  floorBulbFlare.scale.set(1.75, 0.88, 1);
  floorBulbFlare.renderOrder = 5;
  floorBulbFlare.position.copy(studioLight.position);
  sceneRig.add(floorBulbFlare);

  const stand = new THREE.Group();
  const standUpperLift = 0.65;
  const standDisplayHeight = 1.75 + standUpperLift;
  const legSpecs = [
    [new THREE.Vector3(-1.48, 1.68 + standUpperLift, 0.12), new THREE.Vector3(-2.12, -2.36, 0.68)],
    [new THREE.Vector3(1.48, 1.68 + standUpperLift, 0.12), new THREE.Vector3(2.12, -2.36, 0.68)],
    [new THREE.Vector3(-1.4, 1.58 + standUpperLift, -0.3), new THREE.Vector3(-1.62, -2.36, -0.72)],
    [new THREE.Vector3(1.4, 1.58 + standUpperLift, -0.3), new THREE.Vector3(1.62, -2.36, -0.72)]
  ];
  for (const [top, bottom] of legSpecs) {
    stand.add(cylinderBetween(top, bottom, 0.075, whiteMetal, 24));
  }

  for (const z of [-0.48, 0.48]) {
    stand.add(cylinderBetween(
      new THREE.Vector3(-1.68, -1.18, z),
      new THREE.Vector3(1.68, -1.18, z),
      0.062,
      whiteMetal,
      20));
  }

  const shelfShell = new THREE.Mesh(roundedSolid(3.45, 1.04, 0.36, 0.24, 0.045), whitePlastic);
  shelfShell.rotation.x = -Math.PI / 2;
  shelfShell.position.set(0, -1.12, 0.02);
  shelfShell.castShadow = true;
  stand.add(shelfShell);
  const shelfTop = new THREE.Mesh(roundedSolid(3.25, 0.84, 0.29, 0.045, 0.018), shelfMaterial);
  shelfTop.rotation.x = -Math.PI / 2;
  shelfTop.position.set(0, -0.975, 0.02);
  shelfTop.castShadow = true;
  stand.add(shelfTop);

  for (const x of [-1.44, 1.44]) {
    const hinge = new THREE.Group();
    hinge.position.set(x, 1.6 + standUpperLift, -0.03);
    const hingeBody = new THREE.Mesh(roundedSolid(0.34, 0.46, 0.14, 0.34, 0.035), whitePlastic);
    hingeBody.castShadow = true;
    hinge.add(hingeBody);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.39, 24), silver);
    pin.rotation.x = Math.PI / 2;
    pin.position.z = 0.015;
    pin.castShadow = true;
    hinge.add(pin);
    stand.add(hinge);
  }

  const wheelSpecs = [
    [-2.12, -2.42, 0.68, -0.2],
    [2.12, -2.42, 0.68, 0.18],
    [-1.62, -2.42, -0.72, 0.24],
    [1.62, -2.42, -0.72, -0.16]
  ];
  for (const [x, y, z, yaw] of wheelSpecs) {
    const wheel = new THREE.Group();
    wheel.position.set(x, y, z);
    wheel.rotation.y = yaw;
    wheel.add(cylinderBetween(
      new THREE.Vector3(0, 0.24, 0),
      new THREE.Vector3(0, 0.07, 0),
      0.055,
      darkSilver,
      16));
    const casterShoulder = new THREE.Mesh(roundedSolid(0.34, 0.2, 0.08, 0.18, 0.025), whitePlastic);
    casterShoulder.rotation.x = -0.12;
    casterShoulder.position.set(0, 0.04, 0.045);
    casterShoulder.castShadow = true;
    wheel.add(casterShoulder);
    for (const side of [-1, 1]) {
      const fork = cylinderBetween(
        new THREE.Vector3(side * 0.13, 0.06, 0),
        new THREE.Vector3(side * 0.13, -0.1, 0),
        0.032,
        whiteMetal,
        12);
      wheel.add(fork);
      const wheelDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.23, 0.23, 0.075, 30),
        [tire, whitePlastic, whitePlastic]);
      wheelDisc.rotation.z = Math.PI / 2;
      wheelDisc.position.set(side * 0.07, -0.12, 0);
      wheelDisc.castShadow = true;
      wheel.add(wheelDisc);
    }
    const axle = cylinderBetween(
      new THREE.Vector3(-0.17, -0.12, 0),
      new THREE.Vector3(0.17, -0.12, 0),
      0.035,
      darkSilver,
      12);
    wheel.add(axle);
    for (const side of [-1, 1]) {
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.016, 24), darkSilver);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(side * 0.112, -0.12, 0);
      wheel.add(hub);
    }
    stand.add(wheel);
  }

  const mountAssembly = new THREE.Group();
  mountAssembly.position.set(0, 0, -0.33);
  const mountRim = new THREE.Mesh(new THREE.CylinderGeometry(1.51, 1.51, 0.17, 64), whiteMetal);
  mountRim.rotation.x = Math.PI / 2;
  mountRim.castShadow = true;
  mountAssembly.add(mountRim);
  const mountFace = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.075, 64), whitePlastic);
  mountFace.rotation.x = Math.PI / 2;
  mountFace.position.z = -0.09;
  mountFace.castShadow = true;
  mountAssembly.add(mountFace);
  for (const x of [-1.34, 1.34]) {
    stand.add(cylinderBetween(
      new THREE.Vector3(x, 1.56 + standUpperLift, 0.02),
      new THREE.Vector3(x * 0.92, 1.56 + standUpperLift, 0.31),
      0.082,
      whiteMetal,
      18));
  }

  stand.add(tubeAlong([
    new THREE.Vector3(0.46, 1.05, 0.23),
    new THREE.Vector3(0.72, 0.63, 0.18),
    new THREE.Vector3(0.76, 0.1, 0.12),
    new THREE.Vector3(0.67, -0.6, 0.06),
    new THREE.Vector3(0.48, -0.95, 0.02)
  ], 0.025, cableDark));
  stand.add(tubeAlong([
    new THREE.Vector3(0.72, 1.13, 0.24),
    new THREE.Vector3(0.9, 0.69, 0.19),
    new THREE.Vector3(0.88, 0.16, 0.13),
    new THREE.Vector3(0.76, -0.54, 0.07),
    new THREE.Vector3(0.62, -0.91, 0.03)
  ], 0.019, cableLight));
  sceneRig.add(stand);

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
  sceneRig.add(wallMount);

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
  sceneRig.add(monitorStand);

  // Pitch the panel back around its horizontal axis. The camera supplies the
  // isometric side view; the screen itself stays square to its physical mount.
  const displayMount = new THREE.Group();
  displayMount.position.set(0, standDisplayHeight, 0.82);
  displayMount.rotation.x = -0.14;
  sceneRig.add(displayMount);

  const display = new THREE.Group();
  displayMount.add(display);
  display.add(mountAssembly);

  const panelWidth = 7.3;
  const panelHeight = 4.55;
  const screenWidth = 6.72;
  const screenHeight = 3.78;
  const chassis = new THREE.Mesh(roundedSolid(panelWidth, panelHeight, 0.29, 0.28, 0.055), silver);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  display.add(chassis);

  const rearShell = new THREE.Mesh(roundedSolid(7.1, 4.35, 0.25, 0.075, 0.028), rearPlastic);
  rearShell.position.z = -0.17;
  rearShell.castShadow = true;
  rearShell.receiveShadow = true;
  display.add(rearShell);

  const frame = new THREE.Mesh(roundedSolid(7.12, 4.38, 0.24, 0.11, 0.04), frameMaterial);
  frame.position.z = 0.07;
  frame.castShadow = true;
  frame.receiveShadow = true;
  display.add(frame);

  const ui = createInteractiveDesktopTexture({
    quality: renderQualityName,
    onRotationRequest: () => {
      const next = contentTarget > 0.5 ? 0 : 1;
      contentTarget = next;
      if (currentMode === "monitor") physicalTarget = next;
    }
  });
  disposeUi = () => ui.dispose();
  const screenMaterial = new THREE.MeshBasicMaterial({ map: ui.texture, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(screenWidth, screenHeight), screenMaterial);
  screen.position.z = 0.225;
  display.add(screen);
  const screenInteractionPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(screenWidth, screenHeight),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  const screenInteriorHit = new THREE.Mesh(
    new THREE.PlaneGeometry(screenWidth, screenHeight),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.001,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  screenInteriorHit.position.z = 0.256;
  screenInteriorHit.userData.action = "desktop";
  display.add(screenInteriorHit);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(screenWidth + 0.02, screenHeight + 0.02),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.07,
      roughness: 0.085,
      metalness: 0,
      ior: 1.48,
      reflectivity: 0.86,
      clearcoat: 1,
      clearcoatRoughness: 0.045,
      depthWrite: false
    })
  );
  glass.position.z = 0.238;
  glass.renderOrder = 3;
  display.add(glass);

  const reflectionUniforms = {
    uWarmCenter: { value: new THREE.Vector2(0.2, 0.68) },
    uCoolCenter: { value: new THREE.Vector2(0.8, 0.48) },
    uWarmDir: { value: new THREE.Vector2(0.48, 0.88).normalize() },
    uCoolDir: { value: new THREE.Vector2(-0.3, 0.95).normalize() },
    uWarmStrength: { value: 0.24 },
    uCoolStrength: { value: 0.17 }
  };
  const reflectionMaterial = new THREE.ShaderMaterial({
    uniforms: reflectionUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform vec2 uWarmCenter;
      uniform vec2 uCoolCenter;
      uniform vec2 uWarmDir;
      uniform vec2 uCoolDir;
      uniform float uWarmStrength;
      uniform float uCoolStrength;

      float roundedBoxDistance(vec2 point, vec2 bounds, float radius) {
        vec2 q = abs(point) - bounds + radius;
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
      }

      float streak(vec2 uv, vec2 center, vec2 direction, float width, float reach, float curve) {
        vec2 alongAxis = normalize(direction);
        vec2 acrossAxis = vec2(-alongAxis.y, alongAxis.x);
        vec2 offset = uv - center;
        float along = dot(offset, alongAxis);
        float across = dot(offset, acrossAxis) + curve * along * along;
        float softBand = exp(-0.5 * across * across / (width * width));
        float taper = exp(-pow(abs(along) / reach, 4.0));
        return softBand * taper;
      }

      void main() {
        float edge = -roundedBoxDistance((vUv - 0.5) * vec2(6.74, 3.80), vec2(3.36, 1.89), 0.12);
        float glassMask = smoothstep(0.0, 0.1, edge);
        vec2 warmOffset = vUv - uWarmCenter;
        vec2 coolOffset = vUv - uCoolCenter;

        float warmWide = streak(vUv, uWarmCenter, uWarmDir, 0.105, 0.72, 0.24);
        float warmCore = streak(vUv, uWarmCenter, uWarmDir, 0.025, 0.61, 0.19);
        float warmGlow = exp(-dot(warmOffset, warmOffset) / 0.095);
        float coolWide = streak(vUv, uCoolCenter, uCoolDir, 0.075, 0.66, -0.18);
        float coolCore = streak(vUv, uCoolCenter, uCoolDir, 0.018, 0.56, -0.13);
        float coolGlow = exp(-dot(coolOffset, coolOffset) / 0.075);

        float warm = (warmWide * 0.58 + warmCore * 0.32 + warmGlow * 0.1) * uWarmStrength;
        float cool = (coolWide * 0.58 + coolCore * 0.3 + coolGlow * 0.08) * uCoolStrength;
        float total = warm + cool;
        vec3 tint = (
          vec3(1.0, 0.66, 0.35) * warm
          + vec3(0.48, 0.7, 1.0) * cool
        ) / max(total, 0.00001);
        gl_FragColor = vec4(tint, glassMask * clamp(total, 0.0, 0.3));
      }
    `
  });
  const reflectionOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(screenWidth + 0.02, screenHeight + 0.02),
    reflectionMaterial
  );
  reflectionOverlay.position.z = 0.244;
  reflectionOverlay.renderOrder = 4;
  display.add(reflectionOverlay);
  let warmReflectionRestLocal = null;
  let coolReflectionRestLocal = null;

  const cameraPod = new THREE.Group();
  cameraPod.position.set(0, 2.4, 0.015);
  const cameraStem = new THREE.Mesh(roundedSolid(0.15, 0.24, 0.06, 0.13, 0.018), whitePlastic);
  cameraStem.position.y = -0.07;
  cameraStem.castShadow = true;
  cameraPod.add(cameraStem);
  const cameraBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.135, 30), whitePlastic);
  cameraBody.rotation.x = Math.PI / 2;
  cameraBody.castShadow = true;
  cameraPod.add(cameraBody);
  const cameraLens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.018, 28), frameMaterial);
  cameraLens.rotation.x = Math.PI / 2;
  cameraLens.position.z = 0.078;
  cameraPod.add(cameraLens);
  display.add(cameraPod);

  const reader = new THREE.Group();
  reader.position.set(3.68, 0, 0.02);
  const readerBody = new THREE.Mesh(roundedSolid(0.22, 0.44, 0.1, 0.2, 0.022), silver);
  readerBody.castShadow = true;
  reader.add(readerBody);
  const readerInset = new THREE.Mesh(
    new THREE.CircleGeometry(0.072, 24),
    new THREE.MeshBasicMaterial({ color: 0x7b8491 })
  );
  readerInset.scale.y = 1.42;
  readerInset.position.z = 0.125;
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
    loader.loadAsync("assets/3d/grip-hand.png")
  ]);
  for (const texture of [buttonTexture, pointerTexture, gripTexture]) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  const bubbleMaterial = new THREE.MeshBasicMaterial({
    map: buttonTexture,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  });
  const bubbleGroup = new THREE.Group();
  bubbleGroup.position.set(2.6, 0, 0.252);
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
    new THREE.LineBasicMaterial({ color: 0x26345f, transparent: true, opacity: 0.35, depthTest: true, depthWrite: false }));
  ringBackground.renderOrder = 11;
  bubbleGroup.add(ringBackground);
  const ringProgress = new THREE.Line(
    ringGeometry,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false }));
  ringProgress.geometry.setDrawRange(0, 1);
  ringProgress.renderOrder = 12;
  bubbleGroup.add(ringProgress);

  const settingsMaterial = new THREE.MeshBasicMaterial({
    map: createLabelTexture("Open settings"),
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  });
  const settingsBubble = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.51), settingsMaterial);
  settingsBubble.position.set(0, -0.47, 0.014);
  settingsBubble.renderOrder = 13;
  bubbleGroup.add(settingsBubble);

  // A single continuous bezel target prevents overlapping edge volumes from
  // choosing a different hidden edge at oblique podium angles.
  const edgeHit = new THREE.Mesh(
    roundedRingSolid(7.55, 4.78, 0.38, 6.62, 3.84, 0.1, 0.52, 0.025),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.001,
      depthWrite: false,
      side: THREE.DoubleSide
    }));
  edgeHit.position.z = 0;
  edgeHit.userData.action = "edge";
  display.add(edgeHit);

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
  let guidedElapsedSeconds = 0;
  let lastActivityAt = performance.now();
  let lastFrameAt = performance.now();
  let lastRenderedAt = Number.NEGATIVE_INFINITY;
  let physicalProgress = 0;
  let physicalTarget = 0;
  let contentProgress = 0;
  let contentTarget = 0;
  demo.dataset.orientation = "landscape";
  let screenOrientation = "landscape";
  let bubbleVisible = false;
  let bubbleShownAt = 0;
  let settingsVisibleUntil = 0;
  let pressedAction = null;
  let pressedPointerId = null;
  let pressedAt = 0;
  let bubbleHoldTriggered = false;
  let dragState = null;
  let pendulumDragState = null;
  let desktopPointerState = null;
  let orbitState = null;
  let guidedContentProgress = 0;
  let renderDirty = true;
  let shadowDirty = true;
  let lastShadowMode = "";
  const lastShadowPose = [];

  function applyMode(mode) {
    currentMode = mode;
    demo.dataset.mode = mode;
    stand.visible = mode === "stand";
    wallMount.visible = mode === "wall";
    monitorStand.visible = mode === "monitor";
    stage.visible = mode !== "wall";
    reader.visible = mode !== "monitor";

    displayMount.rotation.y = 0;
    if (mode === "wall") {
      sceneRig.rotation.y = 0;
      displayMount.position.set(0, 0.3, -0.12);
      displayMount.rotation.x = 0;
      display.scale.setScalar(0.88);
      cameraGoal.set(0, 0.6, 13);
      cameraLook.set(0, 0.28, 0);
    } else if (mode === "monitor") {
      displayMount.position.set(0, 1.48, 0.62);
      displayMount.rotation.x = -0.1;
      display.scale.setScalar(0.84);
      cameraGoal.set(6.8, 4.8, 11.8);
      cameraLook.set(0, 0.1, 0);
    } else {
      displayMount.position.set(0, standDisplayHeight, 0.82);
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
    renderDirty = true;
    shadowDirty = true;
  }

  function updateDesktopOrientation(progress) {
    const normalizedProgress = clamp(progress);
    const nextOrientation = normalizedProgress >= 0.5 ? "portrait" : "landscape";

    // Switch the responsive layout and quarter-turn together. Continuously
    // rotating one resizable canvas makes its corners leave the UV square,
    // which stretches edge pixels until the turn settles.
    if (nextOrientation !== screenOrientation) {
      screenOrientation = nextOrientation;
      ui.setOrientation(nextOrientation);
    }
    demo.dataset.orientation = nextOrientation;
    // The desktop owns a fixed 16:9 presentation texture and composites its
    // responsive portrait layout into it without scaling.
  }

  function restartGuide(message = "Watch once. Then the screen is yours.") {
    const capturedPointerId = pressedPointerId;
    if (desktopPointerState && !desktopPointerState.cancelled) {
      ui.pointerCancel({ pointerId: desktopPointerState.pointerId });
    }
    guided = !reduceMotion;
    guidedElapsedSeconds = 0;
    physicalProgress = 0;
    physicalTarget = 0;
    contentProgress = 0;
    contentTarget = 0;
    bubbleVisible = false;
    settingsVisibleUntil = 0;
    pressedAction = null;
    pressedPointerId = null;
    dragState = null;
    pendulumDragState = null;
    desktopPointerState = null;
    pendantOmega.set(0, 0, 0);
    pendantDirection.copy(pendantRestDirection);
    orbitState = null;
    sceneRig.rotation.y = 0;
    renderDirty = true;
    shadowDirty = true;
    demo.classList.remove(
      "is-interactive",
      "is-dragging",
      "is-orbiting",
      "is-light-dragging",
      "pointer-inside"
    );
    forceVector?.classList.remove("is-blocked");
    if (capturedPointerId !== null && canvas.hasPointerCapture(capturedPointerId)) {
      canvas.releasePointerCapture(capturedPointerId);
    }
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

  function syncInteractionMatrices() {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
  }

  function setRayFromEvent(event) {
    setRayFromClient(event.clientX, event.clientY);
  }

  function setRayFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    rayPosition.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1);
    syncInteractionMatrices();
    raycaster.setFromCamera(rayPosition, camera);
  }

  function projectWorldToClient(worldPoint) {
    const rect = canvas.getBoundingClientRect();
    const projected = worldPoint.clone().project(camera);
    return {
      x: rect.left + ((projected.x + 1) * 0.5) * rect.width,
      y: rect.top + ((1 - projected.y) * 0.5) * rect.height
    };
  }

  function getPendulumPickFromRay() {
    const hit = raycaster.intersectObjects([pendantBulbHit, pendantCordHit], false)[0];
    if (!hit) return null;
    const occluder = raycaster.intersectObjects(
      [screenInteriorHit, chassis, rearShell, frame, stage],
      false
    )[0];
    if (occluder && occluder.distance + 0.02 < hit.distance) return null;
    const part = hit.object.userData.part;
    const grabRadius = part === "cord"
      ? clamp(hit.point.clone().sub(pendantAnchor).dot(pendantDirection), pendantLength * 0.18, pendantLength)
      : pendantLength + 0.34;
    return { hit, part, grabRadius };
  }

  function getPendulumPick(event) {
    setRayFromEvent(event);
    return getPendulumPickFromRay();
  }

  function getFloorLightPickFromRay() {
    const hit = raycaster.intersectObject(floorBulbHit, false)[0];
    if (!hit) return null;
    const occluder = raycaster.intersectObjects(
      [screenInteriorHit, chassis, rearShell, frame, stage],
      false
    )[0];
    return occluder && occluder.distance + 0.02 < hit.distance ? null : hit;
  }

  function getEdgePick(event) {
    setRayFromEvent(event);
    const hit = raycaster.intersectObject(edgeHit, false)[0];
    if (!hit) return null;
    return { localPoint: display.worldToLocal(hit.point.clone()) };
  }

  function getDesktopPickFromRay() {
    screenInteractionPlane.matrix.copy(screen.matrix);
    screenInteractionPlane.matrixWorld.copy(screen.matrixWorld);
    screenInteractionPlane.matrixAutoUpdate = false;
    screenInteractionPlane.matrixWorldAutoUpdate = false;
    const hit = raycaster.intersectObject(screenInteractionPlane, false)[0];
    if (!hit?.uv) return null;
    ui.texture.updateMatrix();
    const uv = hit.uv.clone().applyMatrix3(ui.texture.matrix);
    return { hit, uv };
  }

  function getDesktopPick(event) {
    setRayFromEvent(event);
    return getDesktopPickFromRay();
  }

  function getCapturedDesktopPick(event) {
    setRayFromEvent(event);
    const hit = getDesktopPickFromRay();
    if (hit) return hit;

    // Pointer capture keeps delivering events after the cursor leaves the
    // projected bezel. Continue the gesture on the display's infinite plane
    // and clamp to its nearest screen edge instead of canceling the scroll.
    const screenWorldPosition = screen.getWorldPosition(new THREE.Vector3());
    const screenWorldNormal = new THREE.Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
    const screenPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(screenWorldNormal, screenWorldPosition);
    const worldPoint = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(screenPlane, worldPoint)) return null;

    const localPoint = screen.worldToLocal(worldPoint);
    const rawUv = new THREE.Vector2(
      clamp(localPoint.x / screenWidth + 0.5),
      clamp(localPoint.y / screenHeight + 0.5)
    );
    ui.texture.updateMatrix();
    return { hit: null, uv: rawUv.applyMatrix3(ui.texture.matrix) };
  }

  function getDisplaySurfaceActionFromRay() {
    const desktopPick = getDesktopPickFromRay();
    const bezelPick = raycaster.intersectObject(edgeHit, false)[0];
    if (!desktopPick) return bezelPick ? "edge" : null;
    if (!bezelPick) return "desktop";
    // The invisible interaction surfaces meet at the screen/bezel seam. Let
    // the physically nearest surface win so a visible bezel remains draggable
    // without turning the outermost screen pixels into a grab handle.
    return bezelPick.distance + 0.002 < desktopPick.hit.distance ? "edge" : "desktop";
  }

  function findAction(event) {
    setRayFromEvent(event);
    if (bubbleVisible && raycaster.intersectObject(bubble, false).length > 0) return "bubble";
    if (currentMode === "monitor") {
      if (getPendulumPickFromRay()) return "pendulum";
      if (getFloorLightPickFromRay()) return "floor-light";
      const displayAction = getDisplaySurfaceActionFromRay();
      if (displayAction) return displayAction;
      if (raycaster.intersectObject(screenInteriorHit, false).length > 0) return null;
      return raycaster.intersectObject(stage, false).length > 0 ? "orbit" : null;
    }
    if (raycaster.intersectObject(readerHit, false).length > 0) return "trigger";
    if (getPendulumPickFromRay()) return "pendulum";
    if (getFloorLightPickFromRay()) return "floor-light";
    const displayAction = getDisplaySurfaceActionFromRay();
    if (displayAction) return displayAction;
    if (raycaster.intersectObject(screenInteriorHit, false).length > 0) return null;
    if (currentMode !== "wall" && raycaster.intersectObject(stage, false).length > 0) return "orbit";
    return null;
  }

  function setUnitCylinderBetween(mesh, start, end, radius) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = Math.max(0.001, direction.length());
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.scale.set(radius, length, radius);
  }

  function updatePendantVisual() {
    const bobPosition = pendantAnchor.clone().addScaledVector(pendantDirection, pendantLength);
    const upCord = pendantDirection.clone().negate();
    pendantGroup.position.copy(bobPosition);
    pendantGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upCord);
    const cordEnd = new THREE.Vector3(0, 0.59, 0).applyQuaternion(pendantGroup.quaternion).add(bobPosition);
    setUnitCylinderBetween(pendantCord, pendantAnchor, cordEnd, 0.022);
    setUnitCylinderBetween(pendantCordHit, pendantAnchor, cordEnd, 0.16);
    const lightPosition = new THREE.Vector3(0, -0.32, 0)
      .applyQuaternion(pendantGroup.quaternion)
      .add(bobPosition);
    pendantLight.position.copy(lightPosition);
  }

  function updateReflectionUniforms() {
    display.updateMatrixWorld(true);
    const screenCenter = display.localToWorld(new THREE.Vector3(0, 0, 0.24));
    const pendantLightWorld = pendantLight.getWorldPosition(new THREE.Vector3());
    const studioLightWorld = studioLight.getWorldPosition(new THREE.Vector3());
    const warmLocal = display.worldToLocal(pendantLightWorld.clone());
    const coolLocal = display.worldToLocal(studioLightWorld.clone());
    const warmCenter = reflectionUniforms.uWarmCenter.value;
    const coolCenter = reflectionUniforms.uCoolCenter.value;
    warmReflectionRestLocal ??= warmLocal.clone();
    coolReflectionRestLocal ??= coolLocal.clone();
    warmCenter.set(
      clamp(0.24 + (warmLocal.x - warmReflectionRestLocal.x) / screenWidth * 0.78, -0.35, 1.35),
      clamp(0.66 + (warmLocal.y - warmReflectionRestLocal.y) / screenHeight * 0.72, -0.35, 1.35)
    );
    coolCenter.set(
      clamp(0.8 + (coolLocal.x - coolReflectionRestLocal.x) / screenWidth * 0.58, -0.35, 1.35),
      clamp(0.48 + (coolLocal.y - coolReflectionRestLocal.y) / screenHeight * 0.55, -0.35, 1.35)
    );

    const anchorLocal = display.worldToLocal(pendantAnchor.clone());
    const cableDirection = new THREE.Vector2(
      warmLocal.x - anchorLocal.x,
      warmLocal.y - anchorLocal.y
    );
    if (cableDirection.lengthSq() > 0.0001) {
      cableDirection.normalize();
      reflectionUniforms.uWarmDir.value.lerp(cableDirection, 0.18).normalize();
    }

    const frontNormal = new THREE.Vector3(0, 0, 1).transformDirection(display.matrixWorld);
    const warmFacing = clamp(frontNormal.dot(pendantLightWorld.clone().sub(screenCenter).normalize()) * 2.2);
    const coolFacing = clamp(frontNormal.dot(studioLightWorld.clone().sub(screenCenter).normalize()) * 2.2);
    const warmDistance = pendantLightWorld.distanceTo(screenCenter);
    reflectionUniforms.uWarmStrength.value = 0.34 * warmFacing * clamp(8 / Math.max(5, warmDistance), 0.55, 1.25);
    reflectionUniforms.uCoolStrength.value = 0.24 * coolFacing * floorLightLevel;
  }

  function updateFloorLight(deltaSeconds) {
    const ease = 1 - Math.exp(-deltaSeconds * 6.5);
    floorLightLevel = mix(floorLightLevel, floorLightTarget, ease);
    if (Math.abs(floorLightLevel - floorLightTarget) < 0.001) {
      floorLightLevel = floorLightTarget;
    }
    studioLight.intensity = floorLightLevels.spotlight * floorLightLevel;
    floorBulbFill.intensity = floorLightLevels.fill * floorLightLevel;
    floorBulbGlassMaterial.emissiveIntensity = floorLightLevels.glassEmissive * floorLightLevel;
    floorBulbCoreMaterial.emissiveIntensity = floorLightLevels.coreEmissive * floorLightLevel;
    floorBulbFlareMaterial.opacity = floorLightLevels.flareOpacity * floorLightLevel;
  }

  function getPendulumForce() {
    if (!pendulumDragState) return null;
    const heldPoint = pendantAnchor.clone().addScaledVector(
      pendantDirection,
      pendulumDragState.grabRadius
    );
    const projectedHeld = projectWorldToClient(heldPoint);
    const projectedAnchor = projectWorldToClient(pendantAnchor);
    const pointerX = pendulumDragState.pointerX - pendulumDragState.pointerOffsetX;
    const pointerY = pendulumDragState.pointerY - pendulumDragState.pointerOffsetY;
    const forceX = pointerX - projectedHeld.x;
    const forceY = pointerY - projectedHeld.y;
    const radialX = projectedHeld.x - projectedAnchor.x;
    const radialY = projectedHeld.y - projectedAnchor.y;
    const radialLength = Math.hypot(radialX, radialY);
    if (radialLength < 0.01) return { x: forceX, y: forceY };
    const unitRadialX = radialX / radialLength;
    const unitRadialY = radialY / radialLength;
    const radialForce = forceX * unitRadialX + forceY * unitRadialY;
    return {
      x: forceX - unitRadialX * radialForce,
      y: forceY - unitRadialY * radialForce
    };
  }

  function constrainReducedMotionPendulum() {
    if (!pendulumDragState) return;
    const adjustedX = pendulumDragState.pointerX - pendulumDragState.pointerOffsetX;
    const adjustedY = pendulumDragState.pointerY - pendulumDragState.pointerOffsetY;
    setRayFromClient(adjustedX, adjustedY);

    const radius = pendulumDragState.grabRadius;
    const originFromAnchor = raycaster.ray.origin.clone().sub(pendantAnchor);
    const rayDirection = raycaster.ray.direction;
    const b = originFromAnchor.dot(rayDirection);
    const c = originFromAnchor.lengthSq() - radius * radius;
    const discriminant = b * b - c;
    const currentPoint = pendantAnchor.clone().addScaledVector(pendantDirection, radius);
    let constrainedPoint;

    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const nearT = -b - root;
      const farT = -b + root;
      const nearPoint = raycaster.ray.at(nearT, new THREE.Vector3());
      const farPoint = raycaster.ray.at(farT, new THREE.Vector3());
      if (pendulumDragState.rootBranch === null) {
        if (nearT < 0 && farT >= 0) pendulumDragState.rootBranch = "far";
        else if (farT < 0 && nearT >= 0) pendulumDragState.rootBranch = "near";
        else {
          pendulumDragState.rootBranch = nearPoint.distanceToSquared(currentPoint)
            <= farPoint.distanceToSquared(currentPoint) ? "near" : "far";
        }
      }
      constrainedPoint = pendulumDragState.rootBranch === "near" ? nearPoint : farPoint;
    } else {
      const closestT = Math.max(
        0,
        pendantAnchor.clone().sub(raycaster.ray.origin).dot(rayDirection)
      );
      const radial = raycaster.ray.at(closestT, new THREE.Vector3()).sub(pendantAnchor);
      if (radial.lengthSq() < 0.000001) radial.copy(pendantDirection);
      constrainedPoint = pendantAnchor.clone().add(radial.normalize().multiplyScalar(radius));
    }

    const nextDirection = constrainedPoint.sub(pendantAnchor);
    if (nextDirection.lengthSq() > 0.000001) pendantDirection.copy(nextDirection.normalize());
    pendantOmega.set(0, 0, 0);
  }

  function integratePendulum(deltaSeconds, driveForce = null) {
    if (frozenTime !== null || reduceMotion) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const dragScale = Math.max(190, canvas.getBoundingClientRect().height * 0.42);
    const driveWorld = driveForce
      ? right.multiplyScalar(driveForce.x / dragScale)
        .add(up.multiplyScalar(-driveForce.y / dragScale))
      : null;

    let remaining = deltaSeconds;
    const gravity = new THREE.Vector3(0, -9.81, 0);
    while (remaining > 0) {
      const step = Math.min(1 / 120, remaining);
      const angularAcceleration = new THREE.Vector3()
        .crossVectors(pendantDirection, gravity)
        .multiplyScalar(1 / pendantLength);
      if (driveWorld) {
        angularAcceleration.add(
          new THREE.Vector3()
            .crossVectors(pendantDirection, driveWorld)
            .multiplyScalar(18 / pendantLength)
        );
      }
      pendantOmega.addScaledVector(angularAcceleration, step);
      pendantOmega.multiplyScalar(Math.exp(-(driveWorld ? 2.6 : 0.62) * step));
      pendantOmega.addScaledVector(
        pendantDirection,
        -pendantOmega.dot(pendantDirection)
      );
      if (pendantOmega.length() > 5.2) pendantOmega.setLength(5.2);
      pendantDirection.addScaledVector(
        new THREE.Vector3().crossVectors(pendantOmega, pendantDirection),
        step
      ).normalize();
      remaining -= step;
    }
  }

  function updatePendulum(deltaSeconds) {
    if (pendulumDragState) {
      if (reduceMotion) constrainReducedMotionPendulum();
      else integratePendulum(deltaSeconds, getPendulumForce());
    } else if (frozenTime === null && !reduceMotion) {
      integratePendulum(deltaSeconds);
      if (pendantOmega.lengthSq() < 0.000003 && pendantDirection.distanceToSquared(pendantRestDirection) < 0.00002) {
        pendantOmega.set(0, 0, 0);
        pendantDirection.copy(pendantRestDirection);
      }
    }
    updatePendantVisual();
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
    const rawPointerX = dragState.pointerX - demoRect.left;
    const rawPointerY = dragState.pointerY - demoRect.top;
    const pointerX = rawPointerX - dragState.pointerOffsetX;
    const pointerY = rawPointerY - dragState.pointerOffsetY;
    const gripPoint = projectGripToDemo(dragState.gripLocal);
    return { pointerX, pointerY, rawPointerX, rawPointerY, gripPoint };
  }

  function getGripProgressTangent(localPoint) {
    const previousRotation = display.rotation.z;
    const lowProgress = Math.max(0, physicalProgress - 0.003);
    const highProgress = Math.min(1, physicalProgress + 0.003);

    let before;
    let after;
    try {
      display.rotation.z = mix(0, -Math.PI / 2, lowProgress);
      before = projectGripToDemo(localPoint);
      display.rotation.z = mix(0, -Math.PI / 2, highProgress);
      after = projectGripToDemo(localPoint);
    } finally {
      display.rotation.z = previousRotation;
      display.updateMatrixWorld(true);
    }

    const tangentX = after.x - before.x;
    const tangentY = after.y - before.y;
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength < 0.01) return null;
    return { x: tangentX / tangentLength, y: tangentY / tangentLength };
  }

  function applyDragForce(deltaSeconds) {
    const geometry = getDragGeometry();
    if (!geometry) return;
    const { pointerX, pointerY, gripPoint } = geometry;
    const forceX = pointerX - gripPoint.x;
    const forceY = pointerY - gripPoint.y;
    const tangent = getGripProgressTangent(dragState.gripLocal);
    const tangentialForce = tangent ? forceX * tangent.x + forceY * tangent.y : 0;
    dragState.blocked = (physicalProgress <= 0.001 && tangentialForce < -6)
      || (physicalProgress >= 0.999 && tangentialForce > 6);
    const effectiveForce = Math.sign(tangentialForce)
      * Math.max(0, Math.abs(tangentialForce) - 6);
    const dragDistance = Math.max(180, canvas.getBoundingClientRect().height * 0.42);
    const velocity = clamp(effectiveForce / dragDistance * 9.5, -2.75, 2.75);
    const previousPhysicalProgress = physicalProgress;
    physicalProgress = clamp(physicalProgress + velocity * deltaSeconds);
    physicalTarget = physicalProgress;
    const physicalMovement = physicalProgress - previousPhysicalProgress;
    if (Math.abs(physicalMovement) > 0.000001 && dragState.syncContentWithPhysical) {
      // A direct hardware turn acts like a gyro replacement: the responsive
      // desktop follows the panel's real position, including reversals. If the
      // bubble already requested the opposite orientation, preserve that
      // deliberate pixels-first sequence while the user turns the panel.
      contentProgress = physicalProgress;
      contentTarget = physicalProgress;
    }
    dragState.velocity = velocity;
  }

  function updateDragVisual() {
    const geometry = getDragGeometry();
    if (!geometry) return;
    const { rawPointerX, rawPointerY, gripPoint } = geometry;
    forceVector?.classList.toggle("is-blocked", Boolean(dragState.blocked));
    if (gripElement) {
      gripElement.style.left = `${gripPoint.x}px`;
      gripElement.style.top = `${gripPoint.y}px`;
    }
    if (forceLine) {
      forceLine.setAttribute("x1", String(gripPoint.x));
      forceLine.setAttribute("y1", String(gripPoint.y));
      forceLine.setAttribute("x2", String(rawPointerX));
      forceLine.setAttribute("y2", String(rawPointerY));
    }
    if (forceEnd) {
      forceEnd.setAttribute("cx", String(rawPointerX));
      forceEnd.setAttribute("cy", String(rawPointerY));
    }
  }

  function updatePendulumDragVisual() {
    if (!pendulumDragState) return;
    const demoRect = demo.getBoundingClientRect();
    const heldPoint = pendantAnchor.clone().addScaledVector(
      pendantDirection,
      pendulumDragState.grabRadius
    );
    const projected = projectWorldToClient(heldPoint);
    const gripPoint = {
      x: projected.x - demoRect.left,
      y: projected.y - demoRect.top
    };
    const pointerPoint = {
      x: pendulumDragState.pointerX - pendulumDragState.pointerOffsetX - demoRect.left,
      y: pendulumDragState.pointerY - pendulumDragState.pointerOffsetY - demoRect.top
    };
    if (gripElement) {
      gripElement.style.left = `${gripPoint.x}px`;
      gripElement.style.top = `${gripPoint.y}px`;
    }
    if (forceLine) {
      forceLine.setAttribute("x1", String(gripPoint.x));
      forceLine.setAttribute("y1", String(gripPoint.y));
      forceLine.setAttribute("x2", String(pointerPoint.x));
      forceLine.setAttribute("y2", String(pointerPoint.y));
    }
    if (forceEnd) {
      forceEnd.setAttribute("cx", String(pointerPoint.x));
      forceEnd.setAttribute("cy", String(pointerPoint.y));
    }
    const rawForce = Math.hypot(pointerPoint.x - gripPoint.x, pointerPoint.y - gripPoint.y);
    const swingForce = getPendulumForce();
    const usefulForce = swingForce ? Math.hypot(swingForce.x, swingForce.y) : 0;
    forceVector?.classList.toggle("is-blocked", rawForce > 18 && usefulForce < rawForce * 0.12);
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
    const action = findAction(event);
    const edgePick = action === "edge" ? getEdgePick(event) : null;
    const cursorPoint = edgePick
      ? projectGripToDemo(edgePick.localPoint)
      : { x: event.clientX - demoRect.left, y: event.clientY - demoRect.top };
    cursorElement.style.left = `${cursorPoint.x}px`;
    cursorElement.style.top = `${cursorPoint.y}px`;
    setCursorAction(action);
  }

  function setCursorAction(action) {
    if (!cursorElement) return;
    const gripping = action === "edge" || action === "orbit" || action === "pendulum";
    cursorElement.src = gripping ? "assets/3d/grip-hand.png" : "assets/3d/pointer-hand.png";
    cursorElement.classList.toggle("is-grip", gripping);
  }

  function pointerIsInsideCanvas(event) {
    const rect = canvas.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }

  function cancelActivePointer(event) {
    if (pressedPointerId === null || event.pointerId !== pressedPointerId) return;
    if (dragState) {
      physicalTarget = dragState.startProgress;
      contentTarget = dragState.startContentTarget;
    }
    dragState = null;
    pendulumDragState = null;
    if (desktopPointerState) {
      if (!desktopPointerState.cancelled) {
        ui.pointerCancel({ pointerId: event.pointerId });
      }
    }
    desktopPointerState = null;
    pendantOmega.set(0, 0, 0);
    orbitState = null;
    pressedAction = null;
    pressedPointerId = null;
    demo.classList.remove("is-dragging", "is-orbiting", "is-light-dragging");
    demo.classList.toggle("pointer-inside", pointerIsInsideCanvas(event));
    forceVector?.classList.remove("is-blocked");
    releaseDragCursor(event);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    updateLoopPauseState();
  }

  canvas.addEventListener("pointerenter", () => {
    if (!guided) demo.classList.add("pointer-inside");
  });
  canvas.addEventListener("pointerleave", () => {
    if (!dragState && !pendulumDragState && !desktopPointerState && !orbitState) demo.classList.remove("pointer-inside");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (guided) return;
    if (pressedPointerId !== null && event.pointerId !== pressedPointerId) return;
    demo.classList.add("pointer-inside");
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

    if (pendulumDragState) {
      pendulumDragState.pointerX = event.clientX;
      pendulumDragState.pointerY = event.clientY;
      if (reduceMotion) {
        constrainReducedMotionPendulum();
        updatePendantVisual();
      }
      updatePendulumDragVisual();
      setCursorAction("pendulum");
      return;
    }

    if (desktopPointerState) {
      const pick = getCapturedDesktopPick(event);
      if (pick && !desktopPointerState.cancelled) {
        desktopPointerState.lastUv.copy(pick.uv);
        const result = ui.pointerMove(pick.uv, { pointerId: event.pointerId });
        if (result.action === "feed-scroll") demo.dataset.feedScrolled = "true";
      } else if (!pick && !desktopPointerState.cancelled) {
        ui.pointerCancel({ pointerId: event.pointerId });
        desktopPointerState.cancelled = true;
      }
      setCursorAction("desktop");
      return;
    }

    if (orbitState) {
      const deltaX = event.clientX - orbitState.lastX;
      const nextRotation = sceneRig.rotation.y + deltaX * 0.0065;
      sceneRig.rotation.y = Math.atan2(Math.sin(nextRotation), Math.cos(nextRotation));
      orbitState.lastX = event.clientX;
      setCursorAction("orbit");
      return;
    }

    const action = findAction(event);
    if (action === "edge" && cursorElement) {
      const edgePick = getEdgePick(event);
      if (edgePick) {
        const edgePoint = projectGripToDemo(edgePick.localPoint);
        cursorElement.style.left = `${edgePoint.x}px`;
        cursorElement.style.top = `${edgePoint.y}px`;
      }
    }
    setCursorAction(action);
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (dragState || pendulumDragState || desktopPointerState || orbitState || pressedPointerId !== null) return;
    interruptGuide();
    demo.classList.toggle("pointer-inside", pointerIsInsideCanvas(event));
    noteActivity();
    const action = findAction(event);
    if (action === null) return;
    const demoRect = demo.getBoundingClientRect();
    if (cursorElement) {
      cursorElement.style.left = `${event.clientX - demoRect.left}px`;
      cursorElement.style.top = `${event.clientY - demoRect.top}px`;
    }
    setCursorAction(action);
    pressedAction = action;
    pressedPointerId = event.pointerId;
    pressedAt = performance.now();
    bubbleHoldTriggered = false;
    if (action === "edge") {
      const edgePick = getEdgePick(event);
      if (!edgePick) {
        pressedAction = null;
        pressedPointerId = null;
        return;
      }
      const initialGripPoint = projectGripToDemo(edgePick.localPoint);
      dragState = {
        pointerId: event.pointerId,
        startProgress: physicalProgress,
        startContentTarget: contentTarget,
        syncContentWithPhysical: Math.abs(contentTarget - Math.round(physicalProgress)) < 0.001,
        pointerX: event.clientX,
        pointerY: event.clientY,
        pointerOffsetX: event.clientX - demoRect.left - initialGripPoint.x,
        pointerOffsetY: event.clientY - demoRect.top - initialGripPoint.y,
        velocity: 0,
        gripLocal: edgePick.localPoint
      };
      forceVector?.classList.remove("is-blocked");
      updateDragVisual();
      demo.classList.add("is-dragging");
    } else if (action === "pendulum") {
      const pick = getPendulumPick(event);
      if (!pick) {
        pressedAction = null;
        pressedPointerId = null;
        return;
      }
      const grabRadius = pick.grabRadius;
      const currentGrabPoint = pendantAnchor.clone().addScaledVector(pendantDirection, grabRadius);
      const projectedGrab = projectWorldToClient(currentGrabPoint);
      pendulumDragState = {
        pointerId: event.pointerId,
        pointerX: event.clientX,
        pointerY: event.clientY,
        pointerOffsetX: event.clientX - projectedGrab.x,
        pointerOffsetY: event.clientY - projectedGrab.y,
        grabRadius,
        rootBranch: null
      };
      pendantOmega.set(0, 0, 0);
      updatePendulumDragVisual();
      setCursorAction("pendulum");
      forceVector?.classList.remove("is-blocked");
      demo.classList.add("is-light-dragging");
    } else if (action === "desktop") {
      const pick = getDesktopPick(event);
      if (!pick) {
        pressedAction = null;
        pressedPointerId = null;
        return;
      }
      desktopPointerState = {
        pointerId: event.pointerId,
        lastUv: pick.uv.clone(),
        cancelled: false
      };
      const result = ui.pointerDown(pick.uv, { pointerId: event.pointerId });
      if (["desktop", "feed", "whiteboard", "video"].includes(result.action)) {
        demo.dataset.desktopMode = result.action;
      }
      setCursorAction("desktop");
    } else if (action === "orbit") {
      orbitState = { pointerId: event.pointerId, lastX: event.clientX };
      setCursorAction("orbit");
      demo.classList.add("is-orbiting");
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic accessibility/testing events may not own a native pointer.
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (pressedPointerId === null || event.pointerId !== pressedPointerId) return;
    interruptGuide();
    noteActivity();
    const now = performance.now();
    if (dragState) {
      const releaseProgress = clamp(physicalProgress + dragState.velocity * 0.1);
      const startedPortrait = dragState.startProgress >= 0.5;
      physicalTarget = startedPortrait
        ? (releaseProgress <= 0.15 ? 0 : 1)
        : (releaseProgress >= 0.85 ? 1 : 0);
      // The demo's virtual desktop follows the physical snap so it remains
      // upright and receives vertical feed gestures in portrait.
      contentTarget = physicalTarget;
      dragState = null;
      demo.classList.remove("is-dragging");
      forceVector?.classList.remove("is-blocked");
      releaseDragCursor(event);
      updateInteractiveCaption();
    } else if (pendulumDragState) {
      pendulumDragState = null;
      demo.classList.remove("is-light-dragging");
      forceVector?.classList.remove("is-blocked");
      releaseDragCursor(event);
    } else if (desktopPointerState) {
      if (!desktopPointerState.cancelled) {
        const pick = getDesktopPick(event);
        if (pick) {
          ui.pointerUp(pick.uv, { pointerId: event.pointerId });
        } else {
          ui.pointerCancel({ pointerId: event.pointerId });
        }
      }
      desktopPointerState = null;
      releaseDragCursor(event);
    } else if (orbitState) {
      orbitState = null;
      demo.classList.remove("is-orbiting");
      releaseDragCursor(event);
    } else if (pressedAction === "floor-light" && findAction(event) === "floor-light") {
      floorLightTarget = floorLightTarget > 0.5 ? 0 : 1;
      demo.dataset.floorLight = floorLightTarget > 0.5 ? "on" : "off";
    } else if (pressedAction === "trigger" && findAction(event) === "trigger") {
      if (currentMode === "monitor") {
        const next = Math.max(contentTarget, physicalTarget, contentProgress, physicalProgress) > 0.5 ? 0 : 1;
        contentTarget = next;
        physicalTarget = next;
        demo.dataset.orientation = next > 0.5 ? "portrait" : "landscape";
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
    pressedPointerId = null;
    if (!pointerIsInsideCanvas(event)) demo.classList.remove("pointer-inside");
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    updateLoopPauseState();
  });
  canvas.addEventListener("pointercancel", cancelActivePointer);
  canvas.addEventListener("lostpointercapture", cancelActivePointer);
  canvas.addEventListener("wheel", (event) => {
    if (guided) interruptGuide();
    const pick = getDesktopPick(event);
    if (!pick) return;
    const result = ui.wheel(pick.uv, event.deltaY);
    if (result.handled) {
      event.preventDefault();
      noteActivity();
      if (result.action === "feed-scroll") demo.dataset.feedScrolled = "true";
    }
  }, { passive: false });

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      applyMode(button.dataset.demoMode || "stand");
      restartGuide(`A quick ${button.textContent.trim()} version. Then you take over.`);
    });
  }

  const initialMode = ["stand", "wall", "monitor"].includes(requestedMode) ? requestedMode : "stand";
  applyMode(initialMode);
  if (reduceMotion) enterInteractive();

  function refreshShadowInvalidation() {
    const nextPose = [
      display.rotation.z,
      sceneRig.rotation.y,
      displayMount.position.x,
      displayMount.position.y,
      displayMount.position.z,
      displayMount.rotation.x,
      displayMount.rotation.y,
      displayMount.rotation.z,
      display.scale.x,
      display.scale.y,
      display.scale.z,
      pendantDirection.x,
      pendantDirection.y,
      pendantDirection.z
    ];
    if (lastShadowMode !== currentMode
      || nextPose.length !== lastShadowPose.length
      || nextPose.some((value, index) => Math.abs(value - lastShadowPose[index]) > 0.0001)) {
      shadowDirty = true;
      lastShadowMode = currentMode;
      lastShadowPose.splice(0, lastShadowPose.length, ...nextPose);
    }
  }

  function renderScene(time) {
    refreshShadowInvalidation();
    renderer.shadowMap.needsUpdate = shadowDirty;
    renderer.render(scene, camera);
    shadowDirty = false;
    renderDirty = false;
    lastRenderedAt = time;
  }

  function interactiveSceneIsMoving(time) {
    const cameraMoving = camera.position.distanceToSquared(cameraGoal) > 0.00001;
    const pendantMoving = Boolean(pendulumDragState)
      || pendantOmega.lengthSq() > 0.000003
      || pendantDirection.distanceToSquared(pendantRestDirection) > 0.00002;
    return renderDirty
      || pressedPointerId !== null
      || Boolean(dragState || pendulumDragState || desktopPointerState || orbitState)
      || Math.abs(physicalProgress - physicalTarget) > 0.001
      || Math.abs(contentProgress - contentTarget) > 0.001
      || Math.abs(floorLightLevel - floorLightTarget) > 0.001
      || cameraMoving
      || pendantMoving
      || bubbleVisible
      || settingsVisibleUntil > time
      || time - lastActivityAt < 180
      || time - lastRenderedAt >= 1000;
  }

  function animate(time) {
    animationFrame = 0;
    if (loopPaused || disposed) return;
    const deltaSeconds = Math.min(0.05, Math.max(0, (time - lastFrameAt) / 1000));
    lastFrameAt = time;
    if (guided && frozenTime === null) guidedElapsedSeconds += deltaSeconds;
    camera.position.lerp(cameraGoal, 1 - Math.exp(-deltaSeconds * 7));
    camera.lookAt(cameraLook);
    updatePendulum(deltaSeconds);
    updateFloorLight(deltaSeconds);

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
        renderDirty = true;
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
      const settingsWereVisible = settingsBubble.visible;
      display.rotation.z = mix(0, -Math.PI / 2, physicalProgress);
      if (dragState) updateDragVisual();
      if (pendulumDragState) updatePendulumDragVisual();
      updateDesktopOrientation(contentProgress);
      const uiPresented = ui.draw(time);
      bubbleGroup.rotation.z = -display.rotation.z;
      bubbleMaterial.opacity = bubbleVisible ? 1 : 0;
      bubbleGroup.scale.setScalar(bubbleVisible ? 1 : 0.25);
      bubbleGroup.visible = bubbleVisible;
      ringProgress.geometry.setDrawRange(0, Math.max(1, Math.floor(bubbleProgress * ringPoints.length)));
      settingsMaterial.opacity = settingsOpacity;
      settingsBubble.visible = settingsOpacity > 0;
      if (settingsWereVisible !== settingsBubble.visible) renderDirty = true;
      pointer.visible = false;
      grip.visible = false;
      if (uiPresented || interactiveSceneIsMoving(time)) {
        updateReflectionUniforms();
        renderScene(time);
      }
      scheduleFrame(animate);
      return;
    }

    const t = frozenTime ?? guidedElapsedSeconds;
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
    let gripCorner = new THREE.Vector3(3.55, 2.2, 0.2);

    if (currentMode === "monitor") {
      if (t < 8.35) bubbleOpacity = 0;
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
        pointerOpacity = 1;
      } else if (t < 5.45) {
        setPhase("monitor-portrait", "monitor portrait");
        contentAngle = Math.PI / 2;
        panelAngle = -Math.PI / 2;
        pointerPortraitAmount = 1;
        pointerOpacity = 1;
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
        pointerOpacity = 1;
      } else if (frozenTime === null) {
        enterInteractive();
        scheduleFrame(animate);
        return;
      }
    } else if (currentMode !== "monitor" && t < 1.15) {
      setPhase("landscape", currentMode === "monitor" ? "Click Swivel in the tray" : "Touch the fingerprint reader");
    } else if (currentMode !== "monitor" && t < 2.2) {
      setPhase("touch-reader", currentMode === "monitor" ? "Click Swivel in the tray" : "Touch the edge reader");
      pointerPress = segment(t, 1.82, 2.08) * (1 - segment(t, 2.08, 2.2));
    } else if (currentMode !== "monitor" && t < 3.05) {
      setPhase("bubble-appears", "The blue button appears on screen");
      bubbleOpacity = segment(t, 2.2, 2.58);
      bubbleScale = mix(0.25, 1, segment(t, 2.2, 2.68));
      bubbleProgress = segment(t, 2.2, 4.2) * 0.46;
      pointerToTarget = "bubble";
      pointerMove = segment(t, 2.48, 3.02);
    } else if (currentMode !== "monitor" && t < 4.2) {
      setPhase("tap-bubble", "Tap the blue button");
      bubbleOpacity = 1;
      bubbleProgress = mix(0.46, 0.63, segment(t, 3.05, 4.2));
      pointerFromTarget = "bubble";
      pointerToTarget = "bubble";
      pointerPress = segment(t, 3.82, 4.05) * (1 - segment(t, 4.05, 4.2));
      bubbleScale = 1 - pointerPress * 0.14;
    } else if (currentMode !== "monitor" && t < 5.15) {
      setPhase("pixels-turn", "The pixels turn first");
      contentAngle = mix(0, Math.PI / 2, segment(t, 4.2, 5.1));
      bubbleOpacity = 1 - segment(t, 4.2, 4.55);
      pointerFromTarget = "bubble";
      pointerToTarget = "bubble";
    } else if (currentMode !== "monitor" && t < 7.25) {
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
    } else if (currentMode !== "monitor" && t < 8.4) {
      setPhase("portrait", "Portrait. Very dignified.");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
    } else if (currentMode !== "monitor" && t < 9.45) {
      setPhase("touch-reader-portrait", currentMode === "monitor" ? "Click the tray icon again" : "Touch the reader at the bottom");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
      pointerPress = segment(t, 9.03, 9.27) * (1 - segment(t, 9.27, 9.45));
    } else if (currentMode !== "monitor" && t < 10.3) {
      setPhase("bubble-portrait", "The button follows the reader");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
      pointerToTarget = "bubble";
      pointerMove = segment(t, 9.72, 10.26);
      bubbleOpacity = segment(t, 9.45, 9.82);
      bubbleScale = mix(0.25, 1, segment(t, 9.45, 9.92));
    } else if (currentMode !== "monitor" && t < 11.45) {
      setPhase("tap-bubble-portrait", "Tap once more");
      contentAngle = Math.PI / 2;
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
      pointerFromTarget = "bubble";
      pointerToTarget = "bubble";
      pointerPress = segment(t, 11.02, 11.25) * (1 - segment(t, 11.25, 11.45));
      bubbleOpacity = 1;
      bubbleScale = 1 - pointerPress * 0.14;
    } else if (currentMode !== "monitor" && t < 12.4) {
      setPhase("pixels-return", "The pixels turn back");
      contentAngle = mix(Math.PI / 2, 0, segment(t, 11.45, 12.35));
      panelAngle = -Math.PI / 2;
      pointerPortraitAmount = 1;
      pointerFromTarget = "bubble";
      pointerToTarget = "bubble";
      bubbleOpacity = 1 - segment(t, 11.45, 11.8);
    } else if (currentMode !== "monitor" && t < 14.55) {
      setPhase("swivel-landscape", "Lift the right side back up");
      panelAngle = mix(-Math.PI / 2, 0, segment(t, 12.8, 14.2));
      gripCorner = new THREE.Vector3(-3.55, 2.2, 0.2);
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
    updateDesktopOrientation(contentAngle / (Math.PI / 2));
    ui.draw(time);
    bubbleGroup.rotation.z = -panelAngle;
    bubbleMaterial.opacity = bubbleOpacity;
    bubbleGroup.scale.setScalar(bubbleScale);
    bubbleGroup.visible = bubbleOpacity > 0.002;
    ringProgress.geometry.setDrawRange(0, Math.max(1, Math.floor(bubbleProgress * ringPoints.length)));
    settingsMaterial.opacity = 0;
    settingsBubble.visible = false;

    if (pointerOpacity > 0.002) {
      const sensorTarget = getWorldPosition(new THREE.Vector3(3.68, 0, 0.32));
      const bubbleTarget = getWorldPosition(new THREE.Vector3(2.6, 0, 0.34));
      const trayLandscapeLocal = new THREE.Vector3(2.5, -1.77, 0.3);
      const trayPortraitLocal = new THREE.Vector3(3.11, 1.19, 0.3);
      const trayTarget = getWorldPosition(trayLandscapeLocal.lerp(trayPortraitLocal, pointerPortraitAmount));
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

    updateReflectionUniforms();
    renderScene(time);
    scheduleFrame(animate);
  }

  function resize() {
    const rect = demo.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const aspect = width / height;
    renderer.setPixelRatio(getEffectivePixelRatio(width, height));
    const verticalHalf = 6.35;
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
    renderDirty = true;
  }

  function clearActivePointerForPause() {
    const pointerId = pressedPointerId;
    if (dragState) {
      physicalTarget = dragState.startProgress;
      contentTarget = dragState.startContentTarget;
    }
    if (desktopPointerState && !desktopPointerState.cancelled) {
      ui.pointerCancel({ pointerId: desktopPointerState.pointerId });
    }
    dragState = null;
    pendulumDragState = null;
    desktopPointerState = null;
    orbitState = null;
    pendantOmega.set(0, 0, 0);
    pressedAction = null;
    pressedPointerId = null;
    bubbleHoldTriggered = false;
    demo.classList.remove(
      "is-dragging",
      "is-orbiting",
      "is-light-dragging",
      "pointer-inside"
    );
    forceVector?.classList.remove("is-blocked");
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  }

  function setLoopPaused(nextPaused, cancelPointer = false) {
    if (nextPaused === loopPaused) return;
    if (nextPaused) {
      if (cancelPointer) clearActivePointerForPause();
      loopPaused = true;
      pausedAt = performance.now();
      if (animationFrame !== 0) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      return;
    }

    const now = performance.now();
    const pausedDuration = pausedAt > 0 ? now - pausedAt : 0;
    if (bubbleVisible) bubbleShownAt += pausedDuration;
    if (settingsVisibleUntil > pausedAt) settingsVisibleUntil += pausedDuration;
    lastActivityAt += pausedDuration;
    lastFrameAt = now;
    pausedAt = 0;
    loopPaused = false;
    renderDirty = true;
    shadowDirty = true;
    resize();
    scheduleFrame(animate);
  }

  function updateLoopPauseState() {
    if (!documentVisible) {
      setLoopPaused(true, true);
      return;
    }
    if (!demoVisible && pressedPointerId !== null) {
      return;
    }
    setLoopPaused(!demoVisible);
  }

  documentVisibilityHandler = () => {
    documentVisible = !document.hidden;
    updateLoopPauseState();
  };

  observer = new ResizeObserver(resize);
  observer.observe(demo);
  resize();

  ui.prewarm?.();
  const savedVisibility = {
    stand: stand.visible,
    wall: wallMount.visible,
    monitor: monitorStand.visible,
    stage: stage.visible,
    reader: reader.visible
  };
  stand.visible = true;
  wallMount.visible = true;
  monitorStand.visible = true;
  stage.visible = true;
  reader.visible = true;
  try {
    if (typeof renderer.compileAsync === "function") {
      await renderer.compileAsync(scene, camera);
    } else {
      renderer.compile(scene, camera);
    }
  } catch (error) {
    console.debug("Swivel shader prewarm was skipped.", error);
  } finally {
    stand.visible = savedVisibility.stand;
    wallMount.visible = savedVisibility.wall;
    monitorStand.visible = savedVisibility.monitor;
    stage.visible = savedVisibility.stage;
    reader.visible = savedVisibility.reader;
    applyMode(initialMode);
  }

  document.addEventListener("visibilitychange", documentVisibilityHandler);
  if (typeof IntersectionObserver === "function") {
    visibilityObserver = new IntersectionObserver(([entry]) => {
      demoVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.05);
      updateLoopPauseState();
    }, { threshold: [0, 0.05] });
    visibilityObserver.observe(demo);
  }
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
  visibilityObserver?.disconnect();
  if (documentVisibilityHandler) {
    document.removeEventListener("visibilitychange", documentVisibilityHandler);
  }
  disposeUi?.();
  renderer?.dispose();
  demo.classList.remove(
    "webgl-ready",
    "is-interactive",
    "is-dragging",
    "is-orbiting",
    "is-light-dragging",
    "pointer-inside"
  );
};
}
