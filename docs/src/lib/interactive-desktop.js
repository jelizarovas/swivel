import * as THREE from "three";

const MODES = new Set(["desktop", "feed", "whiteboard", "video"]);
const ORIENTATIONS = new Set(["landscape", "portrait"]);

const ANIMALS = [
  { id: "capybara", name: "Miso", title: "Golden-hour commuter", accent: "#f3a65a", artist: drawCapybara },
  { id: "axolotl", name: "Bloop", title: "Tiny reef tour guide", accent: "#f493bd", artist: drawAxolotl },
  { id: "corgi", name: "Nova", title: "First dog on Snack-urn", accent: "#8da6ff", artist: drawSpaceCorgi },
  { id: "raccoon", name: "Pepper", title: "Midnight quality control", accent: "#89d2c4", artist: drawRaccoon },
  { id: "duck", name: "Puddle", title: "Forecast: extremely yellow", accent: "#ffd45f", artist: drawRainDuck }
];

const BOARD_COLORS = ["#10131d", "#5f74ed", "#ef6a76", "#15a47b", "#f5b942"];
const TOUCH_TRAIL_LIFETIME = 260;
const TOUCH_RIPPLE_LIFETIME = 420;

function createLayoutSurface(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext("2d") };
}

export function createInteractiveDesktopTexture({ onRotationRequest, quality = "balanced" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const presentationContext = canvas.getContext("2d");
  const layoutSurfaces = {
    landscape: createLayoutSurface(1280, 720),
    portrait: createLayoutSurface(720, 1280)
  };
  let { canvas: layoutCanvas, context } = layoutSurfaces.landscape;
  if (!presentationContext || !context || !layoutSurfaces.portrait.context) {
    throw new Error("Interactive desktop requires a 2D canvas context.");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;

  const state = {
    orientation: "landscape",
    mode: "desktop",
    startOpen: false,
    feedOffset: 0,
    activePointer: null,
    boardColor: BOARD_COLORS[1],
    boardStrokes: [],
    likedAnimals: new Set(),
    videoPlaying: true,
    adVariant: 0,
    swivelOverlay: { visible: false, progress: 0, scale: 1, settingsVisible: false },
    touchPointer: null,
    touchTrail: [],
    touchRipples: [],
    lastDrawTime: 0,
    disposed: false
  };

  let layout = null;
  const regions = [];
  let dirty = true;
  let dirtyInterval = 0;
  let lastPresentedAt = Number.NEGATIVE_INFINITY;
  let lastClockMinute = -1;
  const cadence = {
    high: { ambient: 1000 / 30, video: 1000 / 30, gesture: 1000 / 60 },
    balanced: { ambient: 1000 / 18, video: 1000 / 24, gesture: 1000 / 30 },
    low: { ambient: 1000 / 12, video: 1000 / 18, gesture: 1000 / 24 }
  }[quality] ?? { ambient: 1000 / 18, video: 1000 / 24, gesture: 1000 / 30 };

  function animationInterval() {
    if (state.activePointer || state.touchPointer || state.touchTrail.length || state.touchRipples.length) {
      return cadence.gesture;
    }
    if (state.mode === "video" && state.videoPlaying) return cadence.video;
    if (state.mode === "desktop" || state.mode === "feed") return cadence.ambient;
    return Number.POSITIVE_INFINITY;
  }

  function getPreferredFrameInterval() {
    if (state.disposed) return Number.POSITIVE_INFINITY;
    return animationInterval();
  }

  function drawGesture() {
    dirty = true;
    dirtyInterval = Math.min(dirtyInterval || Number.POSITIVE_INFINITY, cadence.gesture);
    return draw(performance.now());
  }

  function normalizeTouchPoint(point, time = performance.now()) {
    return {
      x: clampNumber(point.x / layout.width, 0, 1),
      y: clampNumber(point.y / layout.height, 0, 1),
      time
    };
  }

  function beginTouchFeedback(pointerId, point) {
    const touchPoint = normalizeTouchPoint(point);
    state.touchPointer = {
      pointerId,
      startX: point.x,
      startY: point.y,
      moved: 0
    };
    state.touchTrail.length = 0;
    state.touchTrail.push(touchPoint);
  }

  function appendTouchPoint(point) {
    const touchPoint = normalizeTouchPoint(point);
    const previous = state.touchTrail[state.touchTrail.length - 1];
    const distance = previous
      ? Math.hypot((touchPoint.x - previous.x) * layout.width, (touchPoint.y - previous.y) * layout.height)
      : Number.POSITIVE_INFINITY;
    if (distance >= 2) state.touchTrail.push(touchPoint);
    if (state.touchTrail.length > 20) state.touchTrail.splice(0, state.touchTrail.length - 20);
    if (state.touchPointer) {
      state.touchPointer.moved = Math.max(
        state.touchPointer.moved,
        Math.hypot(point.x - state.touchPointer.startX, point.y - state.touchPointer.startY)
      );
    }
  }

  function finishTouchFeedback(point) {
    const touchPoint = normalizeTouchPoint(point);
    appendTouchPoint(point);
    if ((state.touchPointer?.moved ?? 0) < 12) {
      state.touchRipples.push({ ...touchPoint, startedAt: touchPoint.time });
      if (state.touchRipples.length > 4) state.touchRipples.shift();
    }
    state.touchPointer = null;
  }

  function cancelTouchFeedback() {
    state.touchPointer = null;
    state.touchTrail.length = 0;
  }

  function setOrientation(nextOrientation) {
    const normalized = typeof nextOrientation === "boolean"
      ? (nextOrientation ? "portrait" : "landscape")
      : nextOrientation;
    if (!ORIENTATIONS.has(normalized) || normalized === state.orientation) return false;
    state.orientation = normalized;
    activateLayoutSurface(normalized);
    draw();
    return true;
  }

  function activateLayoutSurface(orientation) {
    ({ canvas: layoutCanvas, context } = layoutSurfaces[orientation]);
  }

  function prewarm() {
    if (state.disposed) return false;
    const originalOrientation = state.orientation;
    const alternateOrientation = originalOrientation === "portrait" ? "landscape" : "portrait";
    for (const orientation of [alternateOrientation, originalOrientation]) {
      state.orientation = orientation;
      activateLayoutSurface(orientation);
      dirty = true;
      dirtyInterval = 0;
      draw();
    }
    return true;
  }

  function setMode(nextMode) {
    if (!MODES.has(nextMode)) return false;
    state.mode = nextMode;
    state.startOpen = false;
    draw();
    return true;
  }

  function setSwivelOverlay(nextOverlay = {}) {
    const previous = state.swivelOverlay;
    const next = {
      visible: Boolean(nextOverlay.visible),
      progress: clampNumber(nextOverlay.progress, 0, 1),
      scale: clampNumber(nextOverlay.scale ?? 1, 0.2, 1.2),
      settingsVisible: Boolean(nextOverlay.settingsVisible)
    };
    const changed = previous.visible !== next.visible
      || previous.settingsVisible !== next.settingsVisible
      || Math.abs(previous.progress - next.progress) > 0.002
      || Math.abs(previous.scale - next.scale) > 0.002;
    if (!changed) return false;
    const visibilityChanged = previous.visible !== next.visible
      || previous.settingsVisible !== next.settingsVisible;
    state.swivelOverlay = next;
    dirty = true;
    dirtyInterval = visibilityChanged
      ? 0
      : Math.min(dirtyInterval || Number.POSITIVE_INFINITY, cadence.gesture);
    return true;
  }

  function computeLayout() {
    const width = layoutCanvas.width;
    const height = layoutCanvas.height;
    const portrait = state.orientation === "portrait";
    const taskbarHeight = portrait ? 94 : 76;
    const content = { x: 0, y: 0, width, height: height - taskbarHeight };
    return {
      width,
      height,
      portrait,
      taskbarHeight,
      content,
      unit: Math.min(width / 720, height / 720)
    };
  }

  function draw(time) {
    if (state.disposed) return;
    resetTextureTransform();
    const force = !Number.isFinite(time);
    const frameTime = force ? performance.now() : time;
    const clockMinute = Math.floor(Date.now() / 60000);
    if (clockMinute !== lastClockMinute) {
      dirty = true;
      dirtyInterval = 0;
    }
    const elapsed = frameTime - lastPresentedAt;
    const animationDue = elapsed >= animationInterval();
    const dirtyDue = dirty && elapsed >= dirtyInterval;
    if (!force && !animationDue && !dirtyDue) return false;

    state.lastDrawTime = frameTime;
    layout = computeLayout();
    regions.length = 0;

    drawWallpaper(context, layout, state.lastDrawTime);
    if (state.mode === "desktop") drawDesktop(context, layout, regions, state.lastDrawTime);
    if (state.mode === "feed") drawFeed(context, layout, regions, state, state.lastDrawTime);
    if (state.mode === "whiteboard") drawWhiteboard(context, layout, regions, state);
    if (state.mode === "video") drawVideo(context, layout, regions, state, state.lastDrawTime);
    drawTaskbar(context, layout, regions, state);
    if (state.startOpen) drawStartMenu(context, layout, regions, state);
    drawSwivelOverlay(context, layout, state.swivelOverlay);
    drawTouchFeedback(context, layout, state, frameTime);
    drawGlass(context, layout);
    presentFrame();
    texture.needsUpdate = true;
    dirty = false;
    dirtyInterval = 0;
    lastPresentedAt = frameTime;
    lastClockMinute = clockMinute;
    return true;
  }

  function presentFrame() {
    presentationContext.setTransform(1, 0, 0, 1, 0, 0);
    presentationContext.clearRect(0, 0, canvas.width, canvas.height);
    if (state.orientation === "portrait") {
      // Rotate the 720 x 1280 responsive layout into the stable 1280 x 720
      // presentation surface without scaling either axis.
      presentationContext.translate(0, canvas.height);
      presentationContext.rotate(-Math.PI / 2);
    }
    presentationContext.drawImage(layoutCanvas, 0, 0);
    presentationContext.setTransform(1, 0, 0, 1, 0, 0);
  }

  function resetTextureTransform() {
    // The presentation canvas already contains the correctly oriented frame.
    // Keep Three's texture transform neutral even if the host previously used
    // texture rotation for orientation. This must also run when a host-frame
    // redraw is skipped so the legacy transform cannot reach WebGL.
    texture.offset.set(0, 0);
    texture.repeat.set(1, 1);
    texture.center.set(0.5, 0.5);
    texture.rotation = 0;
    texture.updateMatrix();
  }

  function ensureLayout() {
    if (!layout || regions.length === 0) draw(state.lastDrawTime || performance.now());
  }

  function pointerDown(uv, options = {}) {
    if (state.disposed || state.activePointer || state.touchPointer) return { handled: false };
    ensureLayout();
    const point = uvToCanvas(uv, typeof options === "number" ? options : options.v);
    const pointerId = (typeof options === "object" ? options.pointerId : null) ?? uv?.pointerId ?? 0;
    const hit = hitTest(point);
    beginTouchFeedback(pointerId, point);

    if (hit?.action === "start") {
      state.startOpen = !state.startOpen;
      draw();
      return { handled: true, action: "start" };
    }
    if (hit?.action === "mode") {
      setMode(hit.value);
      return { handled: true, action: hit.value };
    }
    if (hit?.action === "rotate") {
      const next = state.orientation === "portrait" ? "landscape" : "portrait";
      if (typeof onRotationRequest === "function") onRotationRequest(next);
      else setOrientation(next);
      state.startOpen = false;
      draw();
      return { handled: true, action: "rotate", orientation: next };
    }
    if (hit?.action === "board-color") {
      state.boardColor = hit.value;
      draw();
      return { handled: true, action: "board-color" };
    }
    if (hit?.action === "board-clear") {
      state.boardStrokes.length = 0;
      draw();
      return { handled: true, action: "board-clear" };
    }
    if (hit?.action === "video-toggle") {
      state.videoPlaying = !state.videoPlaying;
      draw();
      return { handled: true, action: "video-toggle" };
    }
    if (hit?.action === "ad-next") {
      state.adVariant = (state.adVariant + 1) % 3;
      draw();
      return { handled: true, action: "ad-next" };
    }

    if (state.startOpen && hit?.layer !== "start-menu" && hit?.layer !== "taskbar") {
      state.startOpen = false;
      draw();
      return { handled: true, action: "dismiss-start" };
    }

    if (hit?.action === "board-draw") {
      const stroke = { color: state.boardColor, width: layout.portrait ? 8 : 7, points: [] };
      appendBoardPoint(stroke, point, hit.rect);
      state.boardStrokes.push(stroke);
      state.activePointer = { pointerId, type: "board", stroke, rect: hit.rect };
      draw();
      return { handled: true, action: "board-draw" };
    }

    if (hit?.action === "feed-drag") {
      state.activePointer = {
        pointerId,
        type: "feed",
        startY: point.y,
        lastY: point.y,
        moved: 0,
        startOffset: state.feedOffset,
        pressedAnimal: hit.value
      };
      draw();
      return { handled: true, action: "feed-drag" };
    }

    if (hit) draw();
    return { handled: Boolean(hit), action: hit?.action ?? null };
  }

  function pointerMove(uv, options = {}) {
    if (state.disposed) return { handled: false };
    const pointerId = (typeof options === "object" ? options.pointerId : null) ?? uv?.pointerId ?? 0;
    const ownsAppPointer = state.activePointer?.pointerId === pointerId;
    const ownsTouchPointer = state.touchPointer?.pointerId === pointerId;
    if (!ownsAppPointer && !ownsTouchPointer) return { handled: false };
    const point = uvToCanvas(uv, typeof options === "number" ? options : options.v);
    if (ownsTouchPointer) appendTouchPoint(point);

    if (ownsAppPointer && state.activePointer.type === "board") {
      appendBoardPoint(state.activePointer.stroke, point, state.activePointer.rect);
      drawGesture();
      return { handled: true, action: "board-draw" };
    }

    if (ownsAppPointer && state.activePointer.type === "feed") {
      const delta = point.y - state.activePointer.lastY;
      state.activePointer.moved += Math.abs(delta);
      state.feedOffset -= delta;
      state.activePointer.lastY = point.y;
      drawGesture();
      return { handled: true, action: "feed-scroll" };
    }
    drawGesture();
    return { handled: true, action: "touch" };
  }

  function pointerUp(uv, options = {}) {
    if (state.disposed) return { handled: false };
    const pointerId = (typeof options === "object" ? options.pointerId : null) ?? uv?.pointerId ?? 0;
    const ownsAppPointer = state.activePointer?.pointerId === pointerId;
    const ownsTouchPointer = state.touchPointer?.pointerId === pointerId;
    if (!ownsAppPointer && !ownsTouchPointer) return { handled: false };
    if (ownsTouchPointer) {
      const point = uvToCanvas(uv, typeof options === "number" ? options : options.v);
      finishTouchFeedback(point);
    }
    if (!ownsAppPointer) {
      draw();
      return { handled: true, action: "touch" };
    }
    const active = state.activePointer;
    state.activePointer = null;

    if (active.type === "feed" && active.moved < 12 && active.pressedAnimal) {
      if (state.likedAnimals.has(active.pressedAnimal)) state.likedAnimals.delete(active.pressedAnimal);
      else state.likedAnimals.add(active.pressedAnimal);
      draw();
      return { handled: true, action: "feed-like", value: active.pressedAnimal };
    }
    draw();
    return { handled: true, action: active.type };
  }

  function pointerCancel(options = {}) {
    if (state.disposed) return { handled: false };
    const pointerId = (typeof options === "object" ? options.pointerId : options) ?? 0;
    const ownsAppPointer = state.activePointer?.pointerId === pointerId;
    const ownsTouchPointer = state.touchPointer?.pointerId === pointerId;
    if (!ownsAppPointer && !ownsTouchPointer) return { handled: false };
    const active = ownsAppPointer ? state.activePointer : null;
    if (ownsAppPointer) state.activePointer = null;
    if (ownsTouchPointer) cancelTouchFeedback();
    draw();
    return { handled: true, action: active?.type ?? "touch" };
  }

  function wheel(uv, deltaY) {
    if (state.disposed || state.mode !== "feed") return { handled: false };
    ensureLayout();
    const point = uvToCanvas(uv);
    const feedRegion = regions.find((region) => region.action === "feed-drag");
    if (!feedRegion || !contains(feedRegion.rect, point)) return { handled: false };
    state.feedOffset += clampNumber(deltaY, -240, 240) * 0.8;
    drawGesture();
    return { handled: true, action: "feed-scroll" };
  }

  function uvToCanvas(uv, explicitV) {
    const rawU = typeof uv === "number" ? uv : (uv?.u ?? uv?.x ?? 0);
    const rawV = typeof uv === "number" ? explicitV : (uv?.v ?? uv?.y ?? 0);
    const u = state.orientation === "portrait" ? rawV : rawU;
    const v = state.orientation === "portrait" ? 1 - rawU : rawV;
    return {
      x: clampNumber(u, 0, 1) * layoutCanvas.width,
      y: (1 - clampNumber(v, 0, 1)) * layoutCanvas.height
    };
  }

  function hitTest(point) {
    for (let index = regions.length - 1; index >= 0; index -= 1) {
      if (contains(regions[index].rect, point)) return regions[index];
    }
    return null;
  }

  function dispose() {
    state.disposed = true;
    state.activePointer = null;
    state.touchPointer = null;
    state.touchTrail.length = 0;
    state.touchRipples.length = 0;
    state.boardStrokes.length = 0;
    regions.length = 0;
    texture.dispose();
  }

  draw(0);

  return {
    texture,
    draw,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    wheel,
    getPreferredFrameInterval,
    prewarm,
    setOrientation,
    setMode,
    setSwivelOverlay,
    dispose
  };
}

function drawSwivelOverlay(context, layout, overlay) {
  if (!overlay.visible) return;
  const anchor = 0.85;
  const centerX = layout.portrait ? layout.width * 0.5 : layout.width * anchor;
  const centerY = layout.portrait ? layout.height * anchor : layout.height * 0.5;
  const radius = 55 * layout.unit;
  const scale = overlay.scale;

  context.save();
  context.translate(centerX, centerY);
  context.scale(scale, scale);
  context.shadowColor = "rgba(8,16,48,.34)";
  context.shadowBlur = 24 * layout.unit;
  context.shadowOffsetY = 10 * layout.unit;
  context.fillStyle = "#657cff";
  circle(context, 0, 0, radius);
  context.shadowColor = "transparent";

  context.strokeStyle = "rgba(255,255,255,.3)";
  context.lineWidth = 2 * layout.unit;
  context.beginPath();
  context.arc(0, 0, radius - 2 * layout.unit, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = "#ffffff";
  context.fillStyle = "#ffffff";
  context.lineWidth = 5 * layout.unit;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.arc(0, 0, radius * 0.48, Math.PI * 1.08, Math.PI * 1.82);
  context.stroke();
  triangle(
    context,
    radius * 0.37, -radius * 0.37,
    radius * 0.62, -radius * 0.4,
    radius * 0.48, -radius * 0.16,
    "#ffffff"
  );
  context.beginPath();
  context.arc(0, 0, radius * 0.48, Math.PI * 0.08, Math.PI * 0.82);
  context.stroke();
  triangle(
    context,
    -radius * 0.37, radius * 0.37,
    -radius * 0.62, radius * 0.4,
    -radius * 0.48, radius * 0.16,
    "#ffffff"
  );

  context.strokeStyle = "rgba(19,34,86,.55)";
  context.lineWidth = 7 * layout.unit;
  context.beginPath();
  context.arc(0, 0, radius + 12 * layout.unit, -Math.PI / 2, Math.PI * 1.5);
  context.stroke();
  if (overlay.progress > 0) {
    context.strokeStyle = "#ffffff";
    context.lineWidth = 6 * layout.unit;
    context.beginPath();
    context.arc(
      0,
      0,
      radius + 12 * layout.unit,
      -Math.PI / 2,
      -Math.PI / 2 + overlay.progress * Math.PI * 2
    );
    context.stroke();
  }
  context.restore();

  if (overlay.settingsVisible) {
    const width = 210 * layout.unit;
    const height = 54 * layout.unit;
    const x = clampNumber(centerX - width / 2, 12, layout.width - width - 12);
    const y = layout.portrait
      ? centerY - radius - height - 30 * layout.unit
      : centerY + radius + 25 * layout.unit;
    panel(context, x, y, width, height, 18 * layout.unit, "rgba(21,28,53,.94)", "rgba(255,255,255,.2)");
    context.fillStyle = "#ffffff";
    context.font = `750 ${17 * layout.unit}px Segoe UI, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("Open settings", x + width / 2, y + height / 2 + layout.unit);
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
  }
}

function drawTouchFeedback(context, layout, state, time) {
  const liveTrail = state.touchTrail.filter((point) => time - point.time < TOUCH_TRAIL_LIFETIME);
  const liveRipples = state.touchRipples.filter((ripple) => time - ripple.startedAt < TOUCH_RIPPLE_LIFETIME);
  state.touchTrail.splice(0, state.touchTrail.length, ...liveTrail);
  state.touchRipples.splice(0, state.touchRipples.length, ...liveRipples);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let index = 1; index < liveTrail.length; index += 1) {
    const from = liveTrail[index - 1];
    const to = liveTrail[index];
    const age = Math.max(0, time - to.time);
    const opacity = (1 - age / TOUCH_TRAIL_LIFETIME) * 0.72;
    context.strokeStyle = `rgba(255,255,255,${opacity})`;
    context.lineWidth = 5.5 * layout.unit;
    context.beginPath();
    context.moveTo(from.x * layout.width, from.y * layout.height);
    context.lineTo(to.x * layout.width, to.y * layout.height);
    context.stroke();
  }

  for (const ripple of liveRipples) {
    const progress = clampNumber((time - ripple.startedAt) / TOUCH_RIPPLE_LIFETIME, 0, 1);
    const x = ripple.x * layout.width;
    const y = ripple.y * layout.height;
    const radius = (13 + progress * 43) * layout.unit;
    const opacity = (1 - progress) * 0.82;
    context.strokeStyle = `rgba(255,255,255,${opacity})`;
    context.lineWidth = Math.max(2, (4 - progress * 2) * layout.unit);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = `rgba(255,255,255,${opacity * 0.12})`;
    context.fill();
  }
  context.restore();
}

function drawWallpaper(context, layout, time) {
  const { width, height } = layout;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#141a32");
  gradient.addColorStop(0.5, "#204267");
  gradient.addColorStop(1, "#16736c");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const pulse = 0.5 + Math.sin(time * 0.00035) * 0.08;
  for (const [x, y, radius, color] of [
    [0.12, 0.12, 0.34, `rgba(111,131,255,${pulse})`],
    [0.86, 0.2, 0.26, "rgba(255,178,112,.22)"],
    [0.68, 0.88, 0.38, "rgba(67,220,187,.2)"]
  ]) {
    const glow = context.createRadialGradient(x * width, y * height, 0, x * width, y * height, radius * width);
    glow.addColorStop(0, color);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  }
}

function drawDesktop(context, layout, regions, time) {
  const { content, portrait } = layout;
  const margin = portrait ? 34 : 42;
  const iconSize = portrait ? 112 : 104;
  const apps = [
    ["feed", "Critter Loop", "CL", "#ff806f"],
    ["whiteboard", "Whiteboard", "WB", "#eef1ff"],
    ["video", "Spotlight", "▶", "#7f95ff"]
  ];
  apps.forEach(([mode, label, glyph, color], index) => {
    const column = portrait ? index % 2 : index;
    const row = portrait ? Math.floor(index / 2) : 0;
    const x = margin + column * (iconSize + 38);
    const y = margin + row * (iconSize + 64);
    drawAppIcon(context, x, y, iconSize, glyph, label, color);
    regions.push({ action: "mode", value: mode, rect: { x, y, width: iconSize, height: iconSize + 42 }, layer: "desktop" });
  });

  const cardWidth = portrait ? content.width - 68 : 430;
  const cardHeight = portrait ? 230 : 250;
  const cardX = portrait ? 34 : content.width - cardWidth - 46;
  const cardY = portrait ? content.height - cardHeight - 40 : 42;
  panel(context, cardX, cardY, cardWidth, cardHeight, 30, "rgba(10,14,28,.66)");
  context.fillStyle = "#f4f7ff";
  context.font = `800 ${portrait ? 33 : 31}px Segoe UI, sans-serif`;
  context.fillText("Good afternoon", cardX + 28, cardY + 49);
  context.fillStyle = "#b8c0d8";
  context.font = `600 ${portrait ? 19 : 17}px Segoe UI, sans-serif`;
  context.fillText("Your creative desk is ready.", cardX + 28, cardY + 82);
  drawMiniWeather(context, cardX + 30, cardY + 112, time);
  drawMiniCalendar(context, cardX + cardWidth * 0.53, cardY + 112, cardWidth * 0.39, 102);
}

function drawTaskbar(context, layout, regions, state) {
  const { width, height, taskbarHeight, portrait } = layout;
  const y = height - taskbarHeight;
  context.fillStyle = "rgba(8,11,20,.84)";
  context.fillRect(0, y, width, taskbarHeight);
  context.fillStyle = "rgba(255,255,255,.1)";
  context.fillRect(0, y, width, 1);

  const button = portrait ? 56 : 56;
  const gap = portrait ? 11 : 12;
  const items = [
    ["start", null, "⊞"],
    ["mode", "desktop", "⌂"],
    ["mode", "feed", "●"],
    ["mode", "whiteboard", "✎"],
    ["mode", "video", "▶"]
  ];
  const total = items.length * button + (items.length - 1) * gap;
  let x = (width - total) / 2;
  for (const [action, value, glyph] of items) {
    const active = action === "mode" && state.mode === value;
    panel(context, x, y + (taskbarHeight - button) / 2, button, button, 17, active ? "rgba(111,135,255,.42)" : "rgba(255,255,255,.065)");
    context.fillStyle = active ? "#ffffff" : "#d1d7e8";
    context.font = `700 ${button * 0.42}px Segoe UI Symbol, Segoe UI, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(glyph, x + button / 2, y + taskbarHeight / 2 + 1);
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    regions.push({ action, value, rect: { x, y: y + (taskbarHeight - button) / 2, width: button, height: button }, layer: "taskbar" });
    x += button + gap;
  }

  const clockX = width - (portrait ? 106 : 128);
  const clockWidth = portrait ? 88 : 106;
  const traySize = portrait ? 54 : 52;
  const trayGap = portrait ? 10 : 14;
  const trayX = clockX - traySize - trayGap;
  const trayY = y + (taskbarHeight - traySize) / 2;
  drawSwivelTrayIcon(context, trayX, trayY, traySize);
  regions.push({
    action: "rotate",
    value: null,
    rect: { x: trayX - 5, y: trayY - 5, width: traySize + 10, height: traySize + 10 },
    layer: "taskbar"
  });
  drawClock(context, clockX, y, clockWidth, taskbarHeight);
}

function drawStartMenu(context, layout, regions, state) {
  const { width, height, taskbarHeight, portrait } = layout;
  const menuWidth = portrait ? width - 36 : 590;
  const menuHeight = portrait ? 570 : 430;
  const x = portrait ? 18 : (width - menuWidth) / 2;
  const y = height - taskbarHeight - menuHeight - 14;
  panel(context, x, y, menuWidth, menuHeight, 34, "rgba(12,16,29,.96)", "rgba(255,255,255,.13)");
  context.fillStyle = "#f7f8ff";
  context.font = `800 ${portrait ? 30 : 27}px Segoe UI, sans-serif`;
  context.fillText("Pinned", x + 28, y + 48);
  regions.push({ action: "start-menu", rect: { x, y, width: menuWidth, height: menuHeight }, layer: "start-menu" });

  const tiles = [
    ["mode", "feed", "Critter Loop", "Social", "#ff806f"],
    ["mode", "whiteboard", "Whiteboard", "Sketch", "#5f74ed"],
    ["mode", "video", "Spotlight", "Watch", "#816be8"],
    ["rotate", null, state.orientation === "portrait" ? "Landscape" : "Portrait", "Rotate", "#21a78a"]
  ];
  const gap = 16;
  const tileWidth = (menuWidth - 56 - gap) / 2;
  const tileHeight = portrait ? 176 : 142;
  tiles.forEach(([action, value, title, subtitle, color], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const tileX = x + 28 + column * (tileWidth + gap);
    const tileY = y + 72 + row * (tileHeight + gap);
    panel(context, tileX, tileY, tileWidth, tileHeight, 24, color);
    context.fillStyle = "rgba(255,255,255,.96)";
    context.font = `800 ${portrait ? 24 : 21}px Segoe UI, sans-serif`;
    context.fillText(title, tileX + 20, tileY + 42);
    context.fillStyle = "rgba(255,255,255,.72)";
    context.font = `650 ${portrait ? 17 : 15}px Segoe UI, sans-serif`;
    context.fillText(subtitle, tileX + 20, tileY + 69);
    drawTileGlyph(context, tileX + tileWidth - 48, tileY + tileHeight - 43, action, value);
    regions.push({ action, value, rect: { x: tileX, y: tileY, width: tileWidth, height: tileHeight }, layer: "start-menu" });
  });
}

function drawFeed(context, layout, regions, state, time) {
  const { content, portrait } = layout;
  const headerHeight = portrait ? 112 : 86;
  panel(context, 18, 18, content.width - 36, content.height - 30, 32, "rgba(8,12,24,.72)");
  context.fillStyle = "#ffffff";
  context.font = `850 ${portrait ? 37 : 31}px Segoe UI, sans-serif`;
  context.fillText("Critter Loop", 42, portrait ? 67 : 60);
  context.fillStyle = "#aeb9d5";
  context.font = `600 ${portrait ? 17 : 15}px Segoe UI, sans-serif`;
  context.fillText("good animals · zero doom", 42, portrait ? 94 : 82);

  const feedRect = { x: 22, y: headerHeight, width: content.width - 44, height: content.height - headerHeight - 18 };
  regions.push({ action: "feed-drag", value: null, rect: feedRect, layer: "content" });
  context.save();
  roundedPath(context, feedRect.x, feedRect.y, feedRect.width, feedRect.height, 24);
  context.clip();

  const cardWidth = portrait ? feedRect.width - 24 : Math.min(590, feedRect.width * 0.57);
  const cardHeight = portrait ? 510 : 380;
  const gap = portrait ? 24 : 20;
  const stride = cardHeight + gap;
  const loopHeight = stride * ANIMALS.length;
  state.feedOffset = modulo(state.feedOffset, loopHeight);
  const baseX = portrait ? feedRect.x + 12 : feedRect.x + (feedRect.width - cardWidth) / 2;

  for (let copy = -1; copy <= 1; copy += 1) {
    ANIMALS.forEach((animal, index) => {
      const cardY = feedRect.y + index * stride - state.feedOffset + copy * loopHeight;
      if (cardY > feedRect.y + feedRect.height || cardY + cardHeight < feedRect.y) return;
      drawAnimalCard(context, baseX, cardY, cardWidth, cardHeight, animal, state, time, portrait);
      regions.push({
        action: "feed-drag",
        value: animal.id,
        rect: intersectRect({ x: baseX, y: cardY, width: cardWidth, height: cardHeight }, feedRect),
        layer: "content"
      });
    });
  }
  context.restore();
}

function drawAnimalCard(context, x, y, width, height, animal, state, time, portrait) {
  panel(context, x, y, width, height, 28, "#f6f3ee");
  const artHeight = portrait ? height * 0.68 : height * 0.69;
  context.save();
  roundedPath(context, x + 10, y + 10, width - 20, artHeight - 10, 22);
  context.clip();
  animal.artist(context, x + 10, y + 10, width - 20, artHeight - 10, time);
  context.restore();
  context.fillStyle = "#151722";
  context.font = `850 ${portrait ? 28 : 23}px Segoe UI, sans-serif`;
  context.fillText(animal.name, x + 24, y + artHeight + (portrait ? 43 : 37));
  context.fillStyle = "#666a77";
  context.font = `600 ${portrait ? 18 : 15}px Segoe UI, sans-serif`;
  context.fillText(animal.title, x + 24, y + artHeight + (portrait ? 74 : 64));
  const liked = state.likedAnimals.has(animal.id);
  context.fillStyle = liked ? "#ef5468" : "#9da1ac";
  context.font = `800 ${portrait ? 28 : 24}px Segoe UI Symbol, sans-serif`;
  context.textAlign = "right";
  context.fillText(liked ? "♥" : "♡", x + width - 24, y + artHeight + (portrait ? 57 : 49));
  context.textAlign = "left";
}

function drawWhiteboard(context, layout, regions, state) {
  const { content, portrait } = layout;
  const toolbarHeight = portrait ? 104 : 82;
  panel(context, 18, 18, content.width - 36, content.height - 30, 32, "rgba(242,244,250,.98)");
  context.fillStyle = "#151824";
  context.font = `850 ${portrait ? 31 : 27}px Segoe UI, sans-serif`;
  context.fillText("Whiteboard", 42, portrait ? 65 : 58);

  let colorX = portrait ? 42 : 230;
  const colorY = portrait ? 86 : 35;
  const colorSize = portrait ? 38 : 34;
  BOARD_COLORS.forEach((color) => {
    context.beginPath();
    context.arc(colorX + colorSize / 2, colorY + colorSize / 2, colorSize / 2, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    if (state.boardColor === color) {
      context.strokeStyle = "#ffffff";
      context.lineWidth = 4;
      context.stroke();
      context.strokeStyle = "#5f74ed";
      context.lineWidth = 2;
      context.stroke();
    }
    regions.push({ action: "board-color", value: color, rect: { x: colorX - 5, y: colorY - 5, width: colorSize + 10, height: colorSize + 10 }, layer: "content" });
    colorX += colorSize + 15;
  });

  const clearWidth = portrait ? 114 : 100;
  const clearX = content.width - clearWidth - 38;
  panel(context, clearX, colorY - 2, clearWidth, colorSize + 4, 16, "#e3e6ef");
  context.fillStyle = "#4e5361";
  context.font = `750 ${portrait ? 17 : 15}px Segoe UI, sans-serif`;
  context.textAlign = "center";
  context.fillText("Clear", clearX + clearWidth / 2, colorY + colorSize * 0.68);
  context.textAlign = "left";
  regions.push({ action: "board-clear", rect: { x: clearX, y: colorY - 2, width: clearWidth, height: colorSize + 4 }, layer: "content" });

  const board = { x: 36, y: toolbarHeight + 18, width: content.width - 72, height: content.height - toolbarHeight - 48 };
  panel(context, board.x, board.y, board.width, board.height, 24, "#fffdf8", "#d7dbe5");
  drawBoardGrid(context, board);
  context.save();
  roundedPath(context, board.x, board.y, board.width, board.height, 24);
  context.clip();
  for (const stroke of state.boardStrokes) drawStroke(context, stroke, board);
  context.restore();
  regions.push({ action: "board-draw", rect: board, layer: "content" });
}

function drawVideo(context, layout, regions, state, time) {
  const { content, portrait } = layout;
  panel(context, 18, 18, content.width - 36, content.height - 30, 32, "rgba(8,11,21,.9)");
  const padding = portrait ? 28 : 34;
  const videoX = 18 + padding;
  const videoY = portrait ? 124 : 42;
  const videoWidth = content.width - 36 - padding * 2;
  const videoHeight = portrait ? Math.min(520, videoWidth * 0.7) : content.height - 112;
  drawFakeAd(context, videoX, videoY, videoWidth, videoHeight, state, time);
  regions.push({ action: "video-toggle", rect: { x: videoX, y: videoY, width: videoWidth, height: videoHeight }, layer: "content" });

  context.fillStyle = "#f8f9ff";
  context.font = `850 ${portrait ? 33 : 28}px Segoe UI, sans-serif`;
  context.fillText("Spotlight", 46, portrait ? 72 : content.height - 26);
  context.fillStyle = "#aeb7ce";
  context.font = `600 ${portrait ? 17 : 15}px Segoe UI, sans-serif`;
  if (portrait) context.fillText("Tiny commercials from a kinder timeline.", 46, 101);

  const nextWidth = portrait ? 180 : 152;
  const nextX = content.width - nextWidth - 44;
  const nextY = portrait ? videoY + videoHeight + 28 : content.height - 67;
  panel(context, nextX, nextY, nextWidth, 46, 17, "#5f74ed");
  context.fillStyle = "white";
  context.font = `750 ${portrait ? 17 : 15}px Segoe UI, sans-serif`;
  context.textAlign = "center";
  context.fillText("Next tiny ad", nextX + nextWidth / 2, nextY + 29);
  context.textAlign = "left";
  regions.push({ action: "ad-next", rect: { x: nextX, y: nextY, width: nextWidth, height: 46 }, layer: "content" });
}

function drawFakeAd(context, x, y, width, height, state, time) {
  const colors = [
    ["#f46f61", "#f8bf65", "Cloud Nine Pet Snacks", "Crunch responsibly."],
    ["#665de7", "#82c9f6", "Moonbeam Blankets", "For naps with ambition."],
    ["#168f80", "#8bdfb4", "Puddle-Proof Boots", "Tiny feet. Huge weather."]
  ][state.adVariant];
  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  panel(context, x, y, width, height, 28, gradient);
  const phase = state.videoPlaying ? time * 0.001 : 0;
  const bob = Math.sin(phase * 2.3) * Math.min(12, height * 0.03);
  const mascotX = x + width * (state.adVariant === 1 ? 0.67 : 0.72);
  const mascotY = y + height * 0.56 + bob;
  drawAdMascot(context, mascotX, mascotY, Math.min(width, height) * 0.23, state.adVariant, phase);
  context.fillStyle = "rgba(255,255,255,.95)";
  context.font = `900 ${Math.max(24, Math.min(54, width * 0.055))}px Segoe UI, sans-serif`;
  wrapText(context, colors[2], x + width * 0.075, y + height * 0.24, width * 0.48, Math.min(64, height * 0.12));
  context.fillStyle = "rgba(255,255,255,.82)";
  context.font = `700 ${Math.max(15, Math.min(25, width * 0.027))}px Segoe UI, sans-serif`;
  context.fillText(colors[3], x + width * 0.08, y + height * 0.7);
  panel(context, x + width * 0.08, y + height * 0.77, Math.min(180, width * 0.28), 48, 18, "rgba(15,18,29,.82)");
  context.fillStyle = "white";
  context.font = `800 ${Math.max(14, width * 0.017)}px Segoe UI, sans-serif`;
  context.fillText(state.videoPlaying ? "Pause ad" : "Play ad", x + width * 0.105, y + height * 0.77 + 31);
}

function drawCapybara(context, x, y, width, height, time) {
  fillGradient(context, x, y, width, height, "#f8bd73", "#e9685e");
  const bob = Math.sin(time * 0.002) * height * 0.012;
  context.fillStyle = "rgba(255,244,188,.72)";
  context.beginPath();
  context.arc(x + width * 0.78, y + height * 0.22, height * 0.12, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#7b4f35";
  ellipse(context, x + width * 0.5, y + height * 0.62 + bob, width * 0.3, height * 0.2);
  ellipse(context, x + width * 0.62, y + height * 0.48 + bob, width * 0.13, height * 0.14);
  context.fillStyle = "#5d3829";
  circle(context, x + width * 0.7, y + height * 0.46 + bob, height * 0.035);
  context.fillStyle = "#17141a";
  circle(context, x + width * 0.65, y + height * 0.43 + bob, height * 0.012);
  context.strokeStyle = "rgba(87,45,27,.45)";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(x, y + height * 0.82);
  context.quadraticCurveTo(x + width * 0.45, y + height * 0.7, x + width, y + height * 0.83);
  context.stroke();
}

function drawAxolotl(context, x, y, width, height, time) {
  fillGradient(context, x, y, width, height, "#173a68", "#20a5a0");
  const drift = Math.sin(time * 0.0016) * width * 0.025;
  context.fillStyle = "rgba(180,245,239,.22)";
  for (let index = 0; index < 8; index += 1) circle(context, x + width * (0.1 + index * 0.12), y + height * (0.15 + (index % 3) * 0.16), 5 + index % 3 * 3);
  const cx = x + width * 0.52 + drift;
  const cy = y + height * 0.52;
  context.fillStyle = "#f6a4c8";
  ellipse(context, cx, cy, width * 0.2, height * 0.16);
  for (const side of [-1, 1]) {
    context.strokeStyle = "#ff6ca7";
    context.lineWidth = Math.max(5, height * 0.025);
    context.lineCap = "round";
    for (let index = -1; index <= 1; index += 1) {
      context.beginPath();
      context.moveTo(cx + side * width * 0.16, cy + index * height * 0.055);
      context.lineTo(cx + side * width * 0.25, cy + index * height * 0.095);
      context.stroke();
    }
  }
  context.fillStyle = "#30243a";
  circle(context, cx - width * 0.06, cy - height * 0.03, height * 0.012);
  circle(context, cx + width * 0.06, cy - height * 0.03, height * 0.012);
}

function drawSpaceCorgi(context, x, y, width, height, time) {
  fillGradient(context, x, y, width, height, "#151b45", "#563982");
  context.fillStyle = "rgba(255,255,255,.76)";
  for (let index = 0; index < 22; index += 1) circle(context, x + ((index * 83) % 97) / 100 * width, y + ((index * 47) % 91) / 100 * height, 1 + index % 3);
  const bob = Math.sin(time * 0.0021) * height * 0.025;
  const cx = x + width * 0.54;
  const cy = y + height * 0.54 + bob;
  context.fillStyle = "rgba(184,220,255,.3)";
  circle(context, cx, cy, height * 0.24);
  context.strokeStyle = "rgba(224,243,255,.82)";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#dc853d";
  ellipse(context, cx, cy + height * 0.02, width * 0.17, height * 0.14);
  triangle(context, cx - width * 0.13, cy - height * 0.08, cx - width * 0.06, cy - height * 0.25, cx - width * 0.01, cy - height * 0.08, "#dc853d");
  triangle(context, cx + width * 0.13, cy - height * 0.08, cx + width * 0.06, cy - height * 0.25, cx + width * 0.01, cy - height * 0.08, "#dc853d");
  context.fillStyle = "white";
  ellipse(context, cx, cy + height * 0.07, width * 0.08, height * 0.06);
  context.fillStyle = "#171722";
  circle(context, cx, cy + height * 0.04, height * 0.018);
}

function drawRaccoon(context, x, y, width, height, time) {
  fillGradient(context, x, y, width, height, "#16232d", "#375c5c");
  const reach = Math.sin(time * 0.0024) * width * 0.018;
  context.fillStyle = "#6f7780";
  ellipse(context, x + width * 0.52, y + height * 0.57, width * 0.19, height * 0.2);
  triangle(context, x + width * 0.38, y + height * 0.45, x + width * 0.42, y + height * 0.25, x + width * 0.49, y + height * 0.43, "#6f7780");
  triangle(context, x + width * 0.66, y + height * 0.45, x + width * 0.62, y + height * 0.25, x + width * 0.55, y + height * 0.43, "#6f7780");
  context.fillStyle = "#252c35";
  ellipse(context, x + width * 0.45, y + height * 0.51, width * 0.07, height * 0.06);
  ellipse(context, x + width * 0.59, y + height * 0.51, width * 0.07, height * 0.06);
  context.fillStyle = "#eff4ec";
  circle(context, x + width * 0.45, y + height * 0.5, height * 0.014);
  circle(context, x + width * 0.59, y + height * 0.5, height * 0.014);
  context.fillStyle = "#d65f43";
  panel(context, x + width * 0.69 + reach, y + height * 0.61, width * 0.14, height * 0.16, 10, "#d65f43");
  context.fillStyle = "#f1ca72";
  for (let index = 0; index < 4; index += 1) circle(context, x + width * (0.72 + index * 0.025) + reach, y + height * (0.62 - (index % 2) * 0.04), height * 0.018);
}

function drawRainDuck(context, x, y, width, height, time) {
  fillGradient(context, x, y, width, height, "#7ba7c5", "#334f70");
  context.strokeStyle = "rgba(220,242,255,.5)";
  context.lineWidth = 3;
  const slide = (time * 0.08) % 40;
  for (let index = -2; index < 18; index += 1) {
    const rx = x + ((index * 73) % 103) / 100 * width;
    const ry = y + ((index * 41 + slide) % 100) / 100 * height;
    context.beginPath();
    context.moveTo(rx, ry);
    context.lineTo(rx - 7, ry + 18);
    context.stroke();
  }
  const bob = Math.sin(time * 0.002) * height * 0.015;
  const cx = x + width * 0.52;
  const cy = y + height * 0.5 + bob;
  context.fillStyle = "#ffe275";
  circle(context, cx, cy - height * 0.08, height * 0.13);
  context.fillStyle = "#f7b34f";
  ellipse(context, cx + width * 0.1, cy - height * 0.04, width * 0.09, height * 0.035);
  context.fillStyle = "#172231";
  circle(context, cx + width * 0.035, cy - height * 0.11, height * 0.012);
  context.fillStyle = "#f3c63d";
  panel(context, cx - width * 0.17, cy + height * 0.04, width * 0.34, height * 0.25, height * 0.06, "#f3c63d");
  context.strokeStyle = "#dfaa1d";
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(cx, cy + height * 0.05);
  context.lineTo(cx, cy + height * 0.27);
  context.stroke();
}

function drawAdMascot(context, x, y, radius, variant, phase) {
  context.save();
  context.translate(x, y);
  context.rotate(Math.sin(phase * 1.7) * 0.05);
  context.fillStyle = "rgba(255,255,255,.94)";
  circle(context, 0, 0, radius);
  const ear = radius * 0.76;
  triangle(context, -ear, -radius * 0.35, -radius * 0.5, -radius * 1.28, -radius * 0.08, -radius * 0.5, "rgba(255,255,255,.94)");
  triangle(context, ear, -radius * 0.35, radius * 0.5, -radius * 1.28, radius * 0.08, -radius * 0.5, "rgba(255,255,255,.94)");
  context.fillStyle = variant === 1 ? "#665de7" : "#273044";
  circle(context, -radius * 0.34, -radius * 0.1, radius * 0.09);
  circle(context, radius * 0.34, -radius * 0.1, radius * 0.09);
  context.strokeStyle = "#273044";
  context.lineWidth = radius * 0.07;
  context.lineCap = "round";
  context.beginPath();
  context.arc(0, radius * 0.14, radius * 0.28, 0.15, Math.PI - 0.15);
  context.stroke();
  context.restore();
}

function drawMiniWeather(context, x, y, time) {
  const pulse = Math.sin(time * 0.0015) * 3;
  panel(context, x, y, 170, 102, 22, "rgba(255,255,255,.09)");
  context.fillStyle = "#ffd76d";
  circle(context, x + 42, y + 42, 18 + pulse * 0.12);
  context.fillStyle = "#f4f7ff";
  context.font = "800 29px Segoe UI, sans-serif";
  context.fillText("72°", x + 76, y + 48);
  context.fillStyle = "#aeb9d0";
  context.font = "600 14px Segoe UI, sans-serif";
  context.fillText("soft clouds", x + 22, y + 82);
}

function drawMiniCalendar(context, x, y, width, height) {
  panel(context, x, y, width, height, 22, "rgba(255,255,255,.09)");
  context.fillStyle = "#9db0ff";
  context.font = "800 14px Segoe UI, sans-serif";
  context.fillText("NEXT", x + 20, y + 26);
  context.fillStyle = "#f5f7ff";
  context.font = "750 17px Segoe UI, sans-serif";
  context.fillText("Sketch break", x + 20, y + 54);
  context.fillStyle = "#aeb9d0";
  context.font = "600 14px Segoe UI, sans-serif";
  context.fillText("3:30 PM · 20 min", x + 20, y + 79);
}

function drawClock(context, x, y, width, height) {
  const now = new Date();
  context.fillStyle = "#eef2ff";
  context.font = "750 16px Segoe UI, sans-serif";
  context.textAlign = "center";
  context.fillText(now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), x + width / 2, y + height * 0.45);
  context.fillStyle = "#98a3ba";
  context.font = "600 12px Segoe UI, sans-serif";
  context.fillText(now.toLocaleDateString([], { month: "short", day: "numeric" }), x + width / 2, y + height * 0.72);
  context.textAlign = "left";
}

function drawSwivelTrayIcon(context, x, y, size) {
  panel(context, x, y, size, size, size * 0.3, "#657cff", "rgba(255,255,255,.24)");
  context.save();
  context.translate(x, y);
  context.strokeStyle = "#ffffff";
  context.fillStyle = "#ffffff";
  context.lineWidth = Math.max(3, size * 0.075);
  context.lineCap = "round";
  context.lineJoin = "round";

  context.beginPath();
  context.moveTo(size * 0.25, size * 0.61);
  context.bezierCurveTo(size * 0.3, size * 0.32, size * 0.58, size * 0.25, size * 0.73, size * 0.39);
  context.stroke();
  context.beginPath();
  context.moveTo(size * 0.73, size * 0.39);
  context.lineTo(size * 0.7, size * 0.24);
  context.lineTo(size * 0.84, size * 0.34);
  context.closePath();
  context.fill();

  context.beginPath();
  context.moveTo(size * 0.75, size * 0.43);
  context.bezierCurveTo(size * 0.7, size * 0.7, size * 0.42, size * 0.77, size * 0.27, size * 0.63);
  context.stroke();
  context.beginPath();
  context.moveTo(size * 0.27, size * 0.63);
  context.lineTo(size * 0.3, size * 0.78);
  context.lineTo(size * 0.16, size * 0.68);
  context.closePath();
  context.fill();
  context.restore();
}

function drawAppIcon(context, x, y, size, glyph, label, color) {
  panel(context, x, y, size, size, 26, color, "rgba(255,255,255,.2)");
  context.fillStyle = color === "#eef1ff" ? "#29324c" : "white";
  context.font = `900 ${size * 0.34}px Segoe UI, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(glyph, x + size / 2, y + size / 2 + 2);
  context.textBaseline = "alphabetic";
  context.fillStyle = "#f4f6ff";
  context.font = "700 16px Segoe UI, sans-serif";
  context.fillText(label, x + size / 2, y + size + 27);
  context.textAlign = "left";
}

function drawTileGlyph(context, x, y, action, value) {
  context.fillStyle = "rgba(255,255,255,.84)";
  context.font = "800 32px Segoe UI Symbol, Segoe UI, sans-serif";
  context.textAlign = "center";
  context.fillText(action === "rotate" ? "↻" : value === "feed" ? "●" : value === "whiteboard" ? "✎" : "▶", x, y);
  context.textAlign = "left";
}

function drawBoardGrid(context, rect) {
  context.save();
  roundedPath(context, rect.x, rect.y, rect.width, rect.height, 24);
  context.clip();
  context.strokeStyle = "rgba(90,101,130,.085)";
  context.lineWidth = 1;
  const spacing = 32;
  for (let x = rect.x; x <= rect.x + rect.width; x += spacing) {
    context.beginPath();
    context.moveTo(x, rect.y);
    context.lineTo(x, rect.y + rect.height);
    context.stroke();
  }
  for (let y = rect.y; y <= rect.y + rect.height; y += spacing) {
    context.beginPath();
    context.moveTo(rect.x, y);
    context.lineTo(rect.x + rect.width, y);
    context.stroke();
  }
  context.restore();
}

function appendBoardPoint(stroke, point, rect) {
  stroke.points.push({
    x: clampNumber((point.x - rect.x) / rect.width, 0, 1),
    y: clampNumber((point.y - rect.y) / rect.height, 0, 1)
  });
}

function drawStroke(context, stroke, rect) {
  if (stroke.points.length === 0) return;
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  stroke.points.forEach((point, index) => {
    const x = rect.x + point.x * rect.width;
    const y = rect.y + point.y * rect.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  if (stroke.points.length === 1) context.lineTo(rect.x + stroke.points[0].x * rect.width + 0.1, rect.y + stroke.points[0].y * rect.height + 0.1);
  context.stroke();
}

function drawGlass(context, layout) {
  const shine = context.createLinearGradient(0, 0, layout.width, layout.height);
  shine.addColorStop(0, "rgba(255,255,255,.15)");
  shine.addColorStop(0.22, "rgba(255,255,255,0)");
  shine.addColorStop(1, "rgba(255,255,255,.025)");
  context.fillStyle = shine;
  context.fillRect(0, 0, layout.width, layout.height);
}

function panel(context, x, y, width, height, radius, fill, stroke = null) {
  roundedPath(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.stroke();
  }
}

function roundedPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
}

function fillGradient(context, x, y, width, height, from, to) {
  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  context.fillStyle = gradient;
  context.fillRect(x, y, width, height);
}

function circle(context, x, y, radius) {
  context.beginPath();
  context.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
  context.fill();
}

function ellipse(context, x, y, radiusX, radiusY) {
  context.beginPath();
  context.ellipse(x, y, Math.max(0, radiusX), Math.max(0, radiusY), 0, 0, Math.PI * 2);
  context.fill();
}

function triangle(context, ax, ay, bx, by, cx, cy, fill) {
  context.beginPath();
  context.moveTo(ax, ay);
  context.lineTo(bx, by);
  context.lineTo(cx, cy);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let lineY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && context.measureText(test).width > maxWidth) {
      context.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = test;
    }
  }
  context.fillText(line, x, lineY);
}

function contains(rect, point) {
  return Boolean(rect)
    && point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
