import * as THREE from "three";

const MODES = new Set(["desktop", "feed", "whiteboard", "video", "explorer", "gallery", "call", "game", "media"]);
const ORIENTATIONS = new Set(["landscape", "portrait"]);
const DEVICE_MODES = new Set(["stand", "wall", "monitor"]);
const POWER_STATES = new Set(["on", "sleep", "off"]);

const APPS = [
  { id: "explorer", label: "File Explorer", glyph: "▤", color: "#f4bd4f" },
  { id: "gallery", label: "Gallery", glyph: "▧", color: "#d86fe8" },
  { id: "feed", label: "Critter Loop", glyph: "●", color: "#ff806f" },
  { id: "whiteboard", label: "Whiteboard", glyph: "✎", color: "#eef1ff" },
  { id: "video", label: "Spotlight", glyph: "▶", color: "#7f95ff" },
  { id: "call", label: "CEO Call", glyph: "☎", color: "#32a88b" },
  { id: "game", label: "Orbit Pop", glyph: "✦", color: "#e35e85" },
  { id: "media", label: "Media Player", glyph: "♫", color: "#6459d9" }
];

const SYNTH_TRACKS = [
  {
    title: "Soft Circuit", subtitle: "warm beat · bass · bell melody", color: "#687cff", bpm: 108,
    bass: [110, 110, 138.59, 110, 164.81, 138.59, 110, 82.41],
    melody: [440, null, 554.37, 659.25, null, 554.37, 493.88, null, 440, 493.88, 554.37, null, 659.25, 554.37, 493.88, null]
  },
  {
    title: "Window Rain", subtitle: "brush beat · deep bass · glass lead", color: "#22a7a1", bpm: 92,
    bass: [98, 98, 123.47, 146.83, 98, 123.47, 146.83, 123.47],
    melody: [392, null, null, 493.88, 587.33, null, 493.88, null, 369.99, null, 493.88, null, 587.33, 493.88, null, 369.99]
  },
  {
    title: "Pocket Satellites", subtitle: "tiny drums · orbit bass · star lead", color: "#d55f98", bpm: 124,
    bass: [130.81, 130.81, 164.81, 196, 130.81, 220, 196, 164.81],
    melody: [523.25, 659.25, null, 783.99, null, 659.25, 587.33, null, 523.25, null, 659.25, 783.99, 880, null, 783.99, 659.25]
  }
];

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
const SHUTDOWN_DURATION = 30000;
const CRASH_DURATION = 10000;
const UPDATE_STOPS = [
  [0, 0], [1800, 0.02], [4200, 0.08], [6800, 0.13], [9100, 0.31],
  [12800, 0.37], [16100, 0.54], [19500, 0.59], [22400, 0.76],
  [25700, 0.82], [28200, 0.96], [30000, 1]
];

function createLayoutSurface(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext("2d") };
}

export function createInteractiveDesktopTexture({ onRotationRequest, onPowerStateChange, quality = "balanced" } = {}) {
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
    deviceMode: "stand",
    powerState: "on",
    systemActivity: "idle",
    systemProgress: 0,
    shutdownElapsed: 0,
    shutdownStartedAt: 0,
    crashStartedAt: 0,
    mode: "desktop",
    startOpen: false,
    powerMenuOpen: false,
    calendarOpen: false,
    openApps: new Set(),
    minimizedApps: new Set(),
    feedOffset: 0,
    activePointer: null,
    boardColor: BOARD_COLORS[1],
    boardStrokes: [],
    likedAnimals: new Set(),
    videoPlaying: true,
    adVariant: 0,
    explorerFolder: "Home",
    explorerDocument: null,
    gallerySelected: 0,
    wallpaperVariant: 0,
    callStartedAt: 0,
    callStatus: "idle",
    callPreviewReady: false,
    callPreviewDenied: false,
    gameStartedAt: performance.now(),
    gameScore: 0,
    mediaTrack: 0,
    mediaPlaying: false,
    mediaVolume: 0.58,
    mediaStartedAt: 0,
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
  let audioContext = null;
  let audioNodes = [];
  let activeAudioSources = new Set();
  let mediaSequenceTimer = null;
  let mediaMasterGain = null;
  let mediaStep = 0;
  let noiseBuffer = null;
  let webcamStream = null;
  let webcamVideo = null;
  let callTimeout = null;
  let shutdownTimeout = null;
  let crashTimeout = null;
  const cadence = {
    high: { ambient: 1000 / 30, video: 1000 / 30, gesture: 1000 / 60 },
    balanced: { ambient: 1000 / 18, video: 1000 / 24, gesture: 1000 / 30 },
    low: { ambient: 1000 / 12, video: 1000 / 18, gesture: 1000 / 24 }
  }[quality] ?? { ambient: 1000 / 18, video: 1000 / 24, gesture: 1000 / 30 };

  function animationInterval() {
    if (state.powerState === "off") return Number.POSITIVE_INFINITY;
    if (state.systemActivity !== "idle") return cadence.ambient;
    if (state.activePointer || state.touchPointer || state.touchTrail.length || state.touchRipples.length) {
      return cadence.gesture;
    }
    if (state.powerState === "sleep") return Number.POSITIVE_INFINITY;
    if (state.mode === "call" && state.callStatus === "ringing") return cadence.video;
    if (state.mode === "game" || state.mode === "media" && state.mediaPlaying) return cadence.ambient;
    if (state.mode === "video" && state.videoPlaying) return cadence.video;
    if (state.mode === "desktop" || state.mode === "feed") return cadence.ambient;
    return Number.POSITIVE_INFINITY;
  }

  function getPreferredFrameInterval() {
    if (state.disposed) return Number.POSITIVE_INFINITY;
    return animationInterval();
  }

  function getFrameState() {
    updateSystemProgress();
    const preferredFrameInterval = getPreferredFrameInterval();
    return {
      powerState: state.powerState,
      systemActivity: state.systemActivity,
      systemProgress: state.systemProgress,
      preferredFrameInterval,
      isAnimating: Number.isFinite(preferredFrameInterval)
    };
  }

  function stopWebcam() {
    if (webcamStream) webcamStream.getTracks().forEach((track) => track.stop());
    webcamStream = null;
    if (webcamVideo) webcamVideo.srcObject = null;
    webcamVideo = null;
    state.callPreviewReady = false;
  }

  function clearCallTimeout() {
    if (callTimeout !== null) window.clearTimeout(callTimeout);
    callTimeout = null;
  }

  function beginCall(userInitiated) {
    clearCallTimeout();
    state.callStartedAt = performance.now();
    state.callStatus = "ringing";
    const startedAt = state.callStartedAt;
    callTimeout = window.setTimeout(() => {
      callTimeout = null;
      if (state.disposed || state.callStatus !== "ringing" || state.callStartedAt !== startedAt) return;
      state.callStatus = "unanswered";
      stopWebcam();
      draw();
    }, 20000);
    if (userInitiated) requestWebcam();
  }

  async function requestWebcam() {
    stopWebcam();
    state.callPreviewDenied = false;
    const requestStartedAt = state.callStartedAt;
    if (!navigator.mediaDevices?.getUserMedia) {
      state.callPreviewDenied = true;
      draw();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
        audio: false
      });
      if (state.disposed || state.powerState !== "on" || state.mode !== "call"
        || state.callStatus !== "ringing" || state.callStartedAt !== requestStartedAt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      webcamStream = stream;
      webcamVideo = document.createElement("video");
      webcamVideo.muted = true;
      webcamVideo.playsInline = true;
      webcamVideo.srcObject = stream;
      await webcamVideo.play().catch(() => {});
      state.callPreviewReady = true;
      draw();
    } catch {
      state.callPreviewDenied = true;
      draw();
    }
  }

  function stopMediaPlayback(updateState = true) {
    if (mediaSequenceTimer !== null) window.clearInterval(mediaSequenceTimer);
    mediaSequenceTimer = null;
    for (const source of activeAudioSources) {
      try { source.stop(); } catch { /* source already stopped */ }
    }
    activeAudioSources = new Set();
    for (const node of audioNodes) {
      node.disconnect?.();
    }
    audioNodes = [];
    mediaMasterGain = null;
    if (updateState) state.mediaPlaying = false;
  }

  function registerAudioSource(source, nodes) {
    activeAudioSources.add(source);
    source.onended = () => {
      activeAudioSources.delete(source);
      for (const node of nodes) node.disconnect?.();
    };
  }

  function scheduleTone(frequency, when, duration, type, level) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain);
    gain.connect(mediaMasterGain);
    registerAudioSource(oscillator, [oscillator, gain]);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  function getNoiseBuffer() {
    if (noiseBuffer?.sampleRate === audioContext.sampleRate) return noiseBuffer;
    const length = Math.floor(audioContext.sampleRate * 0.22);
    noiseBuffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function scheduleNoise(when, duration, frequency, level) {
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    source.buffer = getNoiseBuffer();
    filter.type = frequency > 4000 ? "highpass" : "bandpass";
    filter.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(level, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(mediaMasterGain);
    registerAudioSource(source, [source, filter, gain]);
    source.start(when);
    source.stop(when + duration);
  }

  function scheduleKick(when) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(145, when);
    oscillator.frequency.exponentialRampToValueAtTime(48, when + 0.14);
    gain.gain.setValueAtTime(0.72, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
    oscillator.connect(gain);
    gain.connect(mediaMasterGain);
    registerAudioSource(oscillator, [oscillator, gain]);
    oscillator.start(when);
    oscillator.stop(when + 0.18);
  }

  function scheduleMediaStep() {
    if (!audioContext || !mediaMasterGain || !state.mediaPlaying) return;
    const track = SYNTH_TRACKS[state.mediaTrack];
    const when = audioContext.currentTime + 0.025;
    const stepSeconds = 60 / track.bpm / 4;
    if (mediaStep % 8 === 0 || mediaStep === 6 && state.mediaTrack === 2) scheduleKick(when);
    if (mediaStep === 4 || mediaStep === 12) scheduleNoise(when, 0.12, 1700, 0.3);
    if (mediaStep % 2 === 1) scheduleNoise(when, 0.035, 6200, state.mediaTrack === 1 ? 0.07 : 0.1);
    if (mediaStep % 2 === 0) {
      const bass = track.bass[(mediaStep / 2) % track.bass.length];
      scheduleTone(bass, when, stepSeconds * 1.75, "triangle", 0.24);
    }
    const melody = track.melody[mediaStep % track.melody.length];
    if (melody) scheduleTone(melody, when, stepSeconds * (state.mediaTrack === 1 ? 2.4 : 1.35), "sine", 0.13);
    mediaStep = (mediaStep + 1) % 16;
  }

  function setMediaVolume(nextVolume) {
    state.mediaVolume = clampNumber(nextVolume, 0, 1);
    if (mediaMasterGain && audioContext) {
      mediaMasterGain.gain.setTargetAtTime(state.mediaVolume * 0.16, audioContext.currentTime, 0.025);
    }
  }

  function startMediaPlayback() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    stopMediaPlayback(false);
    audioContext ??= new AudioContextClass();
    audioContext.resume?.();
    const track = SYNTH_TRACKS[state.mediaTrack];
    mediaMasterGain = audioContext.createGain();
    mediaMasterGain.gain.value = state.mediaVolume * 0.16;
    mediaMasterGain.connect(audioContext.destination);
    audioNodes.push(mediaMasterGain);
    mediaStep = 0;
    state.mediaPlaying = true;
    state.mediaStartedAt = performance.now();
    scheduleMediaStep();
    mediaSequenceTimer = window.setInterval(scheduleMediaStep, 60000 / track.bpm / 4);
    return true;
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

  function activateApp(nextMode, userInitiated = false) {
    if (!MODES.has(nextMode)) return false;
    if (state.mode === "call" && nextMode !== "call") {
      clearCallTimeout();
      stopWebcam();
    }
    state.mode = nextMode;
    state.startOpen = false;
    state.powerMenuOpen = false;
    state.calendarOpen = false;
    if (nextMode !== "desktop") {
      state.openApps.add(nextMode);
      state.minimizedApps.delete(nextMode);
    }
    if (nextMode === "call") {
      beginCall(userInitiated);
    }
    draw();
    return true;
  }

  function setMode(nextMode) {
    return activateApp(nextMode, false);
  }

  function toggleTaskbarApp(nextMode) {
    if (!MODES.has(nextMode) || nextMode === "desktop") return false;
    if (state.mode === nextMode) {
      return minimizeApp(nextMode);
    }
    if (state.openApps.has(nextMode)) {
      state.mode = nextMode;
      state.minimizedApps.delete(nextMode);
      state.startOpen = false;
      state.powerMenuOpen = false;
      state.calendarOpen = false;
      if (nextMode === "call" && state.callStatus === "ringing" && !webcamStream) requestWebcam();
      draw();
      return true;
    }
    return activateApp(nextMode, true);
  }

  function minimizeApp(appId = state.mode) {
    if (appId === "desktop" || !state.openApps.has(appId)) return false;
    state.minimizedApps.add(appId);
    state.mode = "desktop";
    state.startOpen = false;
    state.powerMenuOpen = false;
    state.calendarOpen = false;
    if (appId === "call") stopWebcam();
    draw();
    return true;
  }

  function closeApp(appId = state.mode) {
    if (appId === "desktop" || !state.openApps.has(appId)) return false;
    if (appId === "call") {
      clearCallTimeout();
      stopWebcam();
      state.callStatus = "ended";
    }
    if (appId === "media") stopMediaPlayback();
    state.openApps.delete(appId);
    state.minimizedApps.delete(appId);
    if (state.mode === appId) state.mode = "desktop";
    state.startOpen = false;
    state.powerMenuOpen = false;
    state.calendarOpen = false;
    draw();
    return true;
  }

  function setDeviceMode(nextMode) {
    if (!DEVICE_MODES.has(nextMode) || nextMode === state.deviceMode) return false;
    state.deviceMode = nextMode;
    draw();
    return true;
  }

  function clearSystemTimers() {
    if (shutdownTimeout !== null) window.clearTimeout(shutdownTimeout);
    if (crashTimeout !== null) window.clearTimeout(crashTimeout);
    shutdownTimeout = null;
    crashTimeout = null;
  }

  function updateSystemProgress(time = performance.now()) {
    if (state.systemActivity !== "updating") return state.systemProgress;
    const elapsed = Math.min(SHUTDOWN_DURATION, state.shutdownElapsed + Math.max(0, time - state.shutdownStartedAt));
    state.systemProgress = shutdownProgressAt(elapsed);
    return state.systemProgress;
  }

  function finishShutdownSequence() {
    clearSystemTimers();
    state.systemProgress = 0;
    state.systemActivity = "idle";
    state.shutdownElapsed = 0;
    state.shutdownStartedAt = 0;
    state.crashStartedAt = 0;
    state.openApps.clear();
    state.minimizedApps.clear();
    state.mode = "desktop";
    dirty = true;
    dirtyInterval = 0;
    draw();
  }

  function scheduleShutdownFinish() {
    if (shutdownTimeout !== null) window.clearTimeout(shutdownTimeout);
    const remaining = Math.max(0, SHUTDOWN_DURATION - state.shutdownElapsed);
    shutdownTimeout = window.setTimeout(finishShutdownSequence, remaining);
  }

  function startShutdownSequence() {
    if (state.systemActivity !== "idle") return false;
    clearCallTimeout();
    stopWebcam();
    stopMediaPlayback();
    state.activePointer = null;
    cancelTouchFeedback();
    state.startOpen = false;
    state.powerMenuOpen = false;
    state.calendarOpen = false;
    state.systemActivity = "updating";
    state.systemProgress = 0;
    state.shutdownElapsed = 0;
    state.shutdownStartedAt = performance.now();
    scheduleShutdownFinish();
    dirty = true;
    dirtyInterval = 0;
    draw();
    return true;
  }

  function resumeShutdownSequence() {
    if (state.disposed || state.systemActivity !== "crashed") return;
    crashTimeout = null;
    state.systemActivity = "updating";
    state.shutdownStartedAt = performance.now();
    state.crashStartedAt = 0;
    scheduleShutdownFinish();
    dirty = true;
    dirtyInterval = 0;
    draw();
  }

  function interruptShutdownSequence() {
    if (state.systemActivity !== "updating") return false;
    const now = performance.now();
    state.shutdownElapsed = Math.min(SHUTDOWN_DURATION, state.shutdownElapsed + Math.max(0, now - state.shutdownStartedAt));
    state.systemProgress = shutdownProgressAt(state.shutdownElapsed);
    state.systemActivity = "crashed";
    state.crashStartedAt = now;
    if (shutdownTimeout !== null) window.clearTimeout(shutdownTimeout);
    shutdownTimeout = null;
    crashTimeout = window.setTimeout(resumeShutdownSequence, CRASH_DURATION);
    dirty = true;
    dirtyInterval = 0;
    draw();
    return true;
  }

  function cancelSystemActivity() {
    clearSystemTimers();
    state.systemActivity = "idle";
    state.systemProgress = 0;
    state.shutdownElapsed = 0;
    state.shutdownStartedAt = 0;
    state.crashStartedAt = 0;
  }

  function setPowerState(nextState) {
    if (!POWER_STATES.has(nextState) || nextState === state.powerState) return false;
    const previousState = state.powerState;
    if (nextState !== "on") cancelSystemActivity();
    state.powerState = nextState;
    state.startOpen = false;
    state.powerMenuOpen = false;
    state.calendarOpen = false;
    if (nextState !== "on") {
      clearCallTimeout();
      stopWebcam();
      stopMediaPlayback();
      state.activePointer = null;
      cancelTouchFeedback();
    }
    dirty = true;
    dirtyInterval = 0;
    draw();
    if (typeof onPowerStateChange === "function") onPowerStateChange(nextState, previousState);
    return true;
  }

  function pressPowerButton() {
    if (state.systemActivity === "updating") {
      interruptShutdownSequence();
      return { handled: true, powerState: state.powerState, systemActivity: state.systemActivity, systemProgress: state.systemProgress };
    }
    if (state.systemActivity === "crashed") {
      return { handled: true, powerState: state.powerState, systemActivity: state.systemActivity, systemProgress: state.systemProgress };
    }
    setPowerState(state.powerState === "on" ? "off" : "on");
    return { handled: true, powerState: state.powerState, systemActivity: state.systemActivity, systemProgress: state.systemProgress };
  }

  function togglePower() {
    pressPowerButton();
    return state.powerState;
  }

  function getPowerState() {
    return state.powerState;
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
    updateSystemProgress(frameTime);
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

    if (state.mode === "call" && state.callStatus === "ringing"
      && frameTime - state.callStartedAt >= 20000) {
      state.callStatus = "unanswered";
      clearCallTimeout();
      stopWebcam();
    }

    if (state.systemActivity !== "idle") {
      drawSystemActivity(context, layout, state, frameTime);
    } else if (state.powerState !== "on") {
      drawPowerScreen(context, layout, state.powerState);
    } else {
      drawWallpaper(context, layout, state.lastDrawTime, state.wallpaperVariant);
      if (state.mode === "desktop") drawDesktop(context, layout, regions, state.lastDrawTime);
      if (state.mode === "feed") drawFeed(context, layout, regions, state, state.lastDrawTime);
      if (state.mode === "whiteboard") drawWhiteboard(context, layout, regions, state);
      if (state.mode === "video") drawVideo(context, layout, regions, state, state.lastDrawTime);
      if (state.mode === "explorer") drawExplorer(context, layout, regions, state);
      if (state.mode === "gallery") drawGallery(context, layout, regions, state, state.lastDrawTime);
      if (state.mode === "call") drawCall(context, layout, regions, state, state.lastDrawTime, webcamVideo);
      if (state.mode === "game") drawGame(context, layout, regions, state, state.lastDrawTime);
      if (state.mode === "media") drawMedia(context, layout, regions, state, state.lastDrawTime);
      if (state.mode !== "desktop") drawWindowControls(context, layout, regions, state.mode);
      drawTaskbar(context, layout, regions, state);
      if (state.startOpen) drawStartMenu(context, layout, regions, state);
      if (state.calendarOpen) drawCalendarFlyout(context, layout, regions);
      drawSwivelOverlay(context, layout, state.swivelOverlay);
    }
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
    if (state.systemActivity !== "idle") return { handled: true, action: "system-busy" };
    if (state.powerState === "off") return { handled: false, action: "power-off" };
    ensureLayout();
    const point = uvToCanvas(uv, typeof options === "number" ? options : options.v);
    const pointerId = (typeof options === "object" ? options.pointerId : null) ?? uv?.pointerId ?? 0;
    const hit = hitTest(point);
    beginTouchFeedback(pointerId, point);

    if (state.powerState === "sleep") {
      setPowerState("on");
      return { handled: true, action: "wake" };
    }

    if (hit?.action === "start") {
      state.startOpen = !state.startOpen;
      if (!state.startOpen) state.powerMenuOpen = false;
      state.calendarOpen = false;
      draw();
      return { handled: true, action: "start" };
    }
    if (hit?.action === "clock") {
      state.calendarOpen = !state.calendarOpen;
      state.startOpen = false;
      state.powerMenuOpen = false;
      draw();
      return { handled: true, action: "clock" };
    }
    if (hit?.action === "taskbar-app") {
      toggleTaskbarApp(hit.value);
      return { handled: true, action: "taskbar-app", value: hit.value };
    }
    if (hit?.action === "app-minimize") {
      minimizeApp(hit.value);
      return { handled: true, action: "app-minimize", value: hit.value };
    }
    if (hit?.action === "app-close") {
      closeApp(hit.value);
      return { handled: true, action: "app-close", value: hit.value };
    }
    if (hit?.action === "mode") {
      activateApp(hit.value, true);
      return { handled: true, action: hit.value };
    }
    if (hit?.action === "power-menu") {
      state.powerMenuOpen = !state.powerMenuOpen;
      draw();
      return { handled: true, action: "power-menu" };
    }
    if (hit?.action === "power-sleep") {
      setPowerState("sleep");
      return { handled: true, action: "power-sleep" };
    }
    if (hit?.action === "power-off") {
      startShutdownSequence();
      return { handled: true, action: "power-off" };
    }
    if (hit?.action === "explorer-folder") {
      state.explorerFolder = hit.value;
      state.explorerDocument = null;
      draw();
      return { handled: true, action: "explorer-folder", value: hit.value };
    }
    if (hit?.action === "explorer-document") {
      state.explorerDocument = hit.value;
      draw();
      return { handled: true, action: "explorer-document", value: hit.value };
    }
    if (hit?.action === "explorer-back") {
      state.explorerDocument = null;
      state.explorerFolder = "Documents";
      draw();
      return { handled: true, action: "explorer-back" };
    }
    if (hit?.action === "gallery-select") {
      state.gallerySelected = hit.value;
      draw();
      return { handled: true, action: "gallery-select", value: hit.value };
    }
    if (hit?.action === "gallery-background") {
      state.wallpaperVariant = state.gallerySelected + 1;
      draw();
      return { handled: true, action: "gallery-background", value: state.wallpaperVariant };
    }
    if (hit?.action === "call-retry") {
      beginCall(true);
      draw();
      return { handled: true, action: "call-retry" };
    }
    if (hit?.action === "call-end") {
      state.callStatus = "ended";
      clearCallTimeout();
      stopWebcam();
      draw();
      return { handled: true, action: "call-end" };
    }
    if (hit?.action === "game-target") {
      state.gameScore += 1;
      state.gameStartedAt = performance.now();
      draw();
      return { handled: true, action: "game-hit", value: state.gameScore };
    }
    if (hit?.action === "game-reset") {
      state.gameScore = 0;
      state.gameStartedAt = performance.now();
      draw();
      return { handled: true, action: "game-reset" };
    }
    if (hit?.action === "media-toggle") {
      if (state.mediaPlaying) stopMediaPlayback();
      else startMediaPlayback();
      draw();
      return { handled: true, action: "media-toggle", value: state.mediaPlaying };
    }
    if (hit?.action === "media-volume") {
      setMediaVolume((point.x - hit.rect.x) / hit.rect.width);
      state.activePointer = { pointerId, type: "media-volume", rect: hit.rect };
      drawGesture();
      return { handled: true, action: "media-volume", value: state.mediaVolume };
    }
    if (hit?.action === "media-track") {
      state.mediaTrack = hit.value;
      if (state.mediaPlaying) startMediaPlayback();
      draw();
      return { handled: true, action: "media-track", value: hit.value };
    }
    if (hit?.action === "rotate") {
      const next = state.orientation === "portrait" ? "landscape" : "portrait";
      if (typeof onRotationRequest === "function") onRotationRequest(next);
      else setOrientation(next);
      state.startOpen = false;
      state.powerMenuOpen = false;
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

    if ((state.startOpen && hit?.layer !== "start-menu" && hit?.layer !== "taskbar")
      || (state.calendarOpen && hit?.layer !== "calendar" && hit?.layer !== "taskbar")) {
      state.startOpen = false;
      state.powerMenuOpen = false;
      state.calendarOpen = false;
      draw();
      return { handled: true, action: "dismiss-overlay" };
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
    if (ownsAppPointer && state.activePointer.type === "media-volume") {
      setMediaVolume((point.x - state.activePointer.rect.x) / state.activePointer.rect.width);
      drawGesture();
      return { handled: true, action: "media-volume", value: state.mediaVolume };
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
    if (state.disposed || state.systemActivity !== "idle" || state.powerState !== "on" || state.mode !== "feed") return { handled: false };
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
    clearSystemTimers();
    clearCallTimeout();
    stopWebcam();
    stopMediaPlayback();
    audioContext?.close?.();
    audioContext = null;
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
    getFrameState,
    prewarm,
    setOrientation,
    setMode,
    setDeviceMode,
    setPowerState,
    pressPowerButton,
    togglePower,
    getPowerState,
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
  drawSwivelLogoMark(context, -radius, -radius, radius * 2);
  context.shadowColor = "transparent";

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

function drawWallpaper(context, layout, time, variant = 0) {
  const { width, height } = layout;
  const gradient = context.createLinearGradient(0, 0, width, height);
  const palettes = [
    ["#141a32", "#204267", "#16736c"],
    ["#201733", "#69406f", "#f18a72"],
    ["#081e39", "#126b84", "#4ac6a6"],
    ["#251b3b", "#4f55a7", "#f3b75e"],
    ["#152a28", "#3b7163", "#d4bd76"]
  ];
  const palette = palettes[modulo(variant, palettes.length)];
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(0.5, palette[1]);
  gradient.addColorStop(1, palette[2]);
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
  const iconSize = portrait ? 88 : 82;
  const columns = portrait ? 2 : 4;
  APPS.forEach((app, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + column * (iconSize + (portrait ? 82 : 36));
    const y = margin + row * (iconSize + 60);
    drawAppIcon(context, x, y, iconSize, app.glyph, app.label, app.color);
    regions.push({ action: "mode", value: app.id, rect: { x, y, width: iconSize + 34, height: iconSize + 44 }, layer: "desktop" });
  });

  const cardWidth = portrait ? content.width - 68 : 390;
  const cardHeight = portrait ? 230 : 226;
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

  const button = portrait ? 56 : 52;
  const buttonY = y + (taskbarHeight - button) / 2;
  const startX = 12;
  panel(context, startX, buttonY, button, button, 16, state.startOpen ? "#2867bd" : "rgba(255,255,255,.08)");
  drawComputerGlyph(context, startX + button / 2, buttonY + button / 2, button * 0.5);
  regions.push({ action: "start", rect: { x: startX, y: buttonY, width: button, height: button }, layer: "taskbar" });

  const clockX = width - (portrait ? 106 : 128);
  const clockWidth = portrait ? 88 : 106;
  const traySize = portrait ? 54 : 52;
  const trayGap = portrait ? 10 : 14;
  const trayX = state.deviceMode === "monitor" ? clockX - traySize - trayGap : clockX;
  const rightEdge = state.deviceMode === "monitor" ? trayX - 10 : clockX - 10;
  if (state.deviceMode === "monitor") {
    const trayY = y + (taskbarHeight - traySize) / 2;
    drawSwivelTrayIcon(context, trayX, trayY, traySize);
    regions.push({
      action: "rotate",
      value: null,
      rect: { x: trayX - 5, y: trayY - 5, width: traySize + 10, height: traySize + 10 },
      layer: "taskbar"
    });
  }

  const openApps = [...state.openApps];
  const gap = portrait ? 7 : 9;
  const firstAppX = startX + button + 14;
  const capacity = Math.max(0, Math.floor((rightEdge - firstAppX + gap) / (button + gap)));
  let x = firstAppX;
  for (const appId of openApps.slice(-capacity)) {
    const app = APPS.find((candidate) => candidate.id === appId);
    if (!app) continue;
    const active = state.mode === appId && !state.minimizedApps.has(appId);
    panel(context, x, buttonY, button, button, 15, active ? "rgba(111,135,255,.46)" : "rgba(255,255,255,.065)");
    context.fillStyle = active ? "#ffffff" : "#d1d7e8";
    context.font = `800 ${button * 0.36}px Segoe UI Symbol, Segoe UI, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(app.glyph, x + button / 2, buttonY + button / 2);
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    if (active) {
      context.fillStyle = "#8fa4ff";
      context.fillRect(x + 12, buttonY + button - 4, button - 24, 3);
    }
    regions.push({ action: "taskbar-app", value: appId, rect: { x, y: buttonY, width: button, height: button }, layer: "taskbar" });
    x += button + gap;
  }
  drawClock(context, clockX, y, clockWidth, taskbarHeight);
  regions.push({ action: "clock", rect: { x: clockX, y, width: clockWidth, height: taskbarHeight }, layer: "taskbar" });
}

function drawStartMenu(context, layout, regions, state) {
  const { width, height, taskbarHeight, portrait } = layout;
  const menuWidth = portrait ? width - 24 : 650;
  const menuHeight = portrait ? 720 : 510;
  const x = 12;
  const y = height - taskbarHeight - menuHeight - 8;
  panel(context, x, y, menuWidth, menuHeight, 20, "rgba(238,244,255,.98)", "rgba(255,255,255,.35)");
  regions.push({ action: "start-menu", rect: { x, y, width: menuWidth, height: menuHeight }, layer: "start-menu" });

  const headerHeight = portrait ? 82 : 70;
  const footerHeight = portrait ? 74 : 62;
  const split = x + menuWidth * 0.58;
  const header = context.createLinearGradient(x, y, x + menuWidth, y);
  header.addColorStop(0, "#2765b6");
  header.addColorStop(1, "#4f8be0");
  context.fillStyle = header;
  context.fillRect(x, y, menuWidth, headerHeight);
  context.fillStyle = "#ffffff";
  context.font = `800 ${portrait ? 25 : 22}px Segoe UI, sans-serif`;
  context.fillText("Studio Guest", x + 26, y + headerHeight * 0.62);
  context.fillStyle = "#d8e8ff";
  context.fillRect(split, y + headerHeight, menuWidth - (split - x), menuHeight - headerHeight - footerHeight);
  context.fillStyle = "rgba(38,79,137,.12)";
  context.fillRect(x, y + menuHeight - footerHeight, menuWidth, footerHeight);

  const rowHeight = portrait ? 58 : 50;
  APPS.slice(0, 7).forEach((app, index) => {
    const rowX = x + 14;
    const rowY = y + headerHeight + 10 + index * rowHeight;
    drawStartRow(context, rowX, rowY, split - rowX - 10, rowHeight - 4, app.glyph, app.label, app.color);
    regions.push({ action: "mode", value: app.id, rect: { x: rowX, y: rowY, width: split - rowX - 10, height: rowHeight - 4 }, layer: "start-menu" });
  });

  const rightItems = [
    ["explorer", "Documents", "▤"],
    ["gallery", "Pictures", "▧"],
    ["media", "Music", "♫"],
    ["game", "Games", "✦"],
    ["whiteboard", "Recent notes", "✎"]
  ];
  rightItems.forEach(([value, label, glyph], index) => {
    const rowX = split + 14;
    const rowY = y + headerHeight + 14 + index * (rowHeight + 2);
    context.fillStyle = "#244a7c";
    context.font = `800 ${portrait ? 17 : 15}px Segoe UI, sans-serif`;
    context.fillText(glyph, rowX, rowY + 27);
    context.fillText(label, rowX + 34, rowY + 27);
    regions.push({ action: "mode", value, rect: { x: rowX - 6, y: rowY, width: x + menuWidth - rowX - 8, height: rowHeight }, layer: "start-menu" });
  });

  const rotateY = y + menuHeight - footerHeight + (footerHeight - 42) / 2;
  if (state.deviceMode !== "monitor") {
    panel(context, split + 14, rotateY, 132, 42, 12, "#467ab8");
    context.fillStyle = "white";
    context.font = "750 15px Segoe UI, sans-serif";
    context.fillText(state.orientation === "portrait" ? "Landscape" : "Portrait", split + 31, rotateY + 27);
    regions.push({ action: "rotate", rect: { x: split + 14, y: rotateY, width: 132, height: 42 }, layer: "start-menu" });
  }
  const powerX = x + menuWidth - 62;
  panel(context, powerX, rotateY, 42, 42, 21, "#d76551");
  context.strokeStyle = "white";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(powerX + 21, rotateY + 22, 10, -Math.PI * 0.25, Math.PI * 1.25);
  context.stroke();
  context.beginPath();
  context.moveTo(powerX + 21, rotateY + 8);
  context.lineTo(powerX + 21, rotateY + 21);
  context.stroke();
  regions.push({ action: "power-menu", rect: { x: powerX - 5, y: rotateY - 5, width: 52, height: 52 }, layer: "start-menu" });
  if (state.powerMenuOpen) {
    const popoverWidth = portrait ? 270 : 248;
    const popoverHeight = 116;
    const popoverX = x + menuWidth - popoverWidth - 16;
    const popoverY = y + menuHeight - footerHeight - popoverHeight - 10;
    panel(context, popoverX, popoverY, popoverWidth, popoverHeight, 18, "#ffffff", "#c8d1df");
    context.fillStyle = "#25334a";
    context.font = "800 15px Segoe UI, sans-serif";
    context.fillText("Power options", popoverX + 16, popoverY + 28);
    const sleep = { x: popoverX + 12, y: popoverY + 44, width: (popoverWidth - 32) / 2, height: 56 };
    const shutdown = { x: sleep.x + sleep.width + 8, y: sleep.y, width: sleep.width, height: sleep.height };
    panel(context, sleep.x, sleep.y, sleep.width, sleep.height, 14, "#e5edf8");
    panel(context, shutdown.x, shutdown.y, shutdown.width, shutdown.height, 14, "#f8e7e4");
    context.fillStyle = "#32547a";
    context.font = "800 14px Segoe UI, sans-serif";
    context.fillText("Sleep", sleep.x + 18, sleep.y + 34);
    context.fillStyle = "#a74339";
    context.fillText("Shut down", shutdown.x + 13, shutdown.y + 34);
    regions.push({ action: "power-sleep", rect: sleep, layer: "start-menu" });
    regions.push({ action: "power-off", rect: shutdown, layer: "start-menu" });
  }
}

function drawPowerScreen(context, layout, powerState) {
  context.fillStyle = powerState === "off" ? "#020304" : "#07101b";
  context.fillRect(0, 0, layout.width, layout.height);
  if (powerState === "off") return;
  const now = new Date();
  context.textAlign = "center";
  context.fillStyle = "rgba(255,255,255,.94)";
  context.font = `300 ${layout.portrait ? 86 : 72}px Segoe UI, sans-serif`;
  context.fillText(now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), layout.width / 2, layout.height * 0.44);
  context.fillStyle = "rgba(255,255,255,.58)";
  context.font = `600 ${layout.portrait ? 22 : 18}px Segoe UI, sans-serif`;
  context.fillText("Tap the screen to wake", layout.width / 2, layout.height * 0.51);
  context.textAlign = "left";
}

function drawSystemActivity(context, layout, state, time) {
  const { width, height, portrait } = layout;
  if (state.systemActivity === "crashed") {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#124c8f");
    gradient.addColorStop(1, "#1f6b9d");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    const cardWidth = Math.min(width - 60, portrait ? 600 : 720);
    const cardHeight = portrait ? 470 : 330;
    const x = (width - cardWidth) / 2;
    const y = (height - cardHeight) / 2;
    panel(context, x, y, cardWidth, cardHeight, 34, "rgba(5,31,65,.32)", "rgba(255,255,255,.16)");
    drawComputerGlyph(context, x + 54, y + 60, portrait ? 46 : 40);
    context.fillStyle = "#ffffff";
    context.font = `850 ${portrait ? 32 : 29}px Segoe UI, sans-serif`;
    context.fillText("Display recovery pause", x + 96, y + 72);
    context.fillStyle = "rgba(255,255,255,.82)";
    context.font = `650 ${portrait ? 20 : 18}px Segoe UI, sans-serif`;
    wrapText(context, "A power interruption was detected. Your update is safely paused and no progress was lost.", x + 42, y + 132, cardWidth - 84, portrait ? 34 : 29);
    const remaining = Math.max(0, Math.ceil((CRASH_DURATION - (time - state.crashStartedAt)) / 1000));
    context.fillStyle = "#9fe5ee";
    context.font = `800 ${portrait ? 23 : 20}px Segoe UI, sans-serif`;
    context.fillText(`Paused at ${Math.floor(state.systemProgress * 100)}% · resuming in ${remaining}s`, x + 42, y + cardHeight - 54);
    return;
  }

  context.fillStyle = "#08111f";
  context.fillRect(0, 0, width, height);
  const centerX = width / 2;
  const centerY = height * (portrait ? 0.43 : 0.45);
  const spinnerRadius = portrait ? 52 : 42;
  context.strokeStyle = "rgba(255,255,255,.16)";
  context.lineWidth = 8;
  context.beginPath();
  context.arc(centerX, centerY - 96, spinnerRadius, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = "#7e96ff";
  context.lineCap = "round";
  context.beginPath();
  context.arc(centerX, centerY - 96, spinnerRadius, time * 0.005, time * 0.005 + Math.PI * 1.15);
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = `850 ${portrait ? 34 : 30}px Segoe UI, sans-serif`;
  context.textAlign = "center";
  context.fillText("Finishing a device update", centerX, centerY + 16);
  context.fillStyle = "#a9b4c8";
  context.font = `650 ${portrait ? 20 : 17}px Segoe UI, sans-serif`;
  context.fillText("Saving your setup before an automatic restart", centerX, centerY + 52);
  const barWidth = Math.min(width * 0.68, portrait ? 560 : 620);
  const barX = centerX - barWidth / 2;
  const barY = centerY + 94;
  panel(context, barX, barY, barWidth, 14, 7, "rgba(255,255,255,.14)");
  panel(context, barX, barY, barWidth * state.systemProgress, 14, 7, "#7189ff");
  context.fillStyle = "#ffffff";
  context.font = `800 ${portrait ? 23 : 20}px Segoe UI, sans-serif`;
  context.fillText(`${Math.floor(state.systemProgress * 100)}%`, centerX, barY + 54);
  context.fillStyle = "#728096";
  context.font = `600 ${portrait ? 17 : 15}px Segoe UI, sans-serif`;
  context.fillText("Please leave the display connected", centerX, barY + 90);
  context.textAlign = "left";
}

function drawWindowControls(context, layout, regions, appId) {
  const size = layout.portrait ? 52 : 44;
  const gap = 8;
  const y = layout.portrait ? 18 : 16;
  const closeX = layout.content.width - size - 18;
  const minimizeX = closeX - size - gap;
  panel(context, minimizeX, y, size, size, 13, "rgba(15,20,34,.72)", "rgba(255,255,255,.18)");
  panel(context, closeX, y, size, size, 13, "rgba(190,57,69,.9)", "rgba(255,255,255,.18)");
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(2.5, size * 0.065);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(minimizeX + size * 0.28, y + size * 0.66);
  context.lineTo(minimizeX + size * 0.72, y + size * 0.66);
  context.stroke();
  context.beginPath();
  context.moveTo(closeX + size * 0.31, y + size * 0.31);
  context.lineTo(closeX + size * 0.69, y + size * 0.69);
  context.moveTo(closeX + size * 0.69, y + size * 0.31);
  context.lineTo(closeX + size * 0.31, y + size * 0.69);
  context.stroke();
  regions.push({ action: "app-minimize", value: appId, rect: { x: minimizeX, y, width: size, height: size }, layer: "window-controls" });
  regions.push({ action: "app-close", value: appId, rect: { x: closeX, y, width: size, height: size }, layer: "window-controls" });
}

function drawCalendarFlyout(context, layout, regions) {
  const { width, height, taskbarHeight, portrait } = layout;
  const flyoutWidth = portrait ? width - 28 : 420;
  const flyoutHeight = portrait ? 500 : 390;
  const x = width - flyoutWidth - 14;
  const y = height - taskbarHeight - flyoutHeight - 10;
  panel(context, x, y, flyoutWidth, flyoutHeight, 24, "rgba(15,20,34,.97)", "rgba(255,255,255,.13)");
  regions.push({ action: "calendar-panel", rect: { x, y, width: flyoutWidth, height: flyoutHeight }, layer: "calendar" });
  const now = new Date();
  context.fillStyle = "#ffffff";
  context.font = `800 ${portrait ? 28 : 24}px Segoe UI, sans-serif`;
  context.fillText(now.toLocaleDateString([], { month: "long", year: "numeric" }), x + 28, y + 46);
  context.fillStyle = "#9ba8c4";
  context.font = "700 14px Segoe UI, sans-serif";
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  const gridX = x + 26;
  const gridY = y + 82;
  const cellWidth = (flyoutWidth - 52) / 7;
  const cellHeight = portrait ? 55 : 43;
  days.forEach((day, index) => {
    context.textAlign = "center";
    context.fillText(day, gridX + cellWidth * (index + 0.5), gridY);
  });
  const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= count; day += 1) {
    const slot = first + day - 1;
    const cx = gridX + cellWidth * (slot % 7 + 0.5);
    const cy = gridY + 30 + cellHeight * Math.floor(slot / 7);
    if (day === now.getDate()) {
      context.fillStyle = "#6078ef";
      circle(context, cx, cy - 5, 18);
      context.fillStyle = "#ffffff";
    } else context.fillStyle = "#d8deed";
    context.font = "700 14px Segoe UI, sans-serif";
    context.fillText(String(day), cx, cy);
  }
  context.textAlign = "left";
}

function drawExplorer(context, layout, regions, state) {
  const { content, portrait } = layout;
  context.fillStyle = "#f4f6fb";
  context.fillRect(0, 0, content.width, content.height);
  const headerHeight = portrait ? 100 : 78;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, content.width, headerHeight);
  context.fillStyle = "#1f2635";
  context.font = `800 ${portrait ? 30 : 26}px Segoe UI, sans-serif`;
  context.fillText("File Explorer", 32, portrait ? 52 : 48);
  context.fillStyle = "#6d7482";
  context.font = "650 15px Segoe UI, sans-serif";
  context.fillText(state.explorerFolder, 32, portrait ? 80 : 69);

  if (state.explorerDocument) {
    drawExplorerDocument(context, layout, regions, state.explorerDocument, headerHeight);
    return;
  }

  const folders = [
    ["Home", "⌂"], ["Documents", "▤"], ["Pictures", "▧"], ["Music", "♫"]
  ];
  const sidebar = portrait
    ? { x: 18, y: headerHeight + 14, width: content.width - 36, height: 96 }
    : { x: 18, y: headerHeight + 16, width: 238, height: content.height - headerHeight - 34 };
  panel(context, sidebar.x, sidebar.y, sidebar.width, sidebar.height, 22, "#e7ebf4");
  folders.forEach(([folder, glyph], index) => {
    const rect = portrait
      ? { x: sidebar.x + 10 + index * ((sidebar.width - 20) / 4), y: sidebar.y + 10, width: (sidebar.width - 28) / 4 - 4, height: 76 }
      : { x: sidebar.x + 10, y: sidebar.y + 14 + index * 58, width: sidebar.width - 20, height: 48 };
    if (state.explorerFolder === folder) panel(context, rect.x, rect.y, rect.width, rect.height, 14, "#cfd9f3");
    context.fillStyle = "#35415c";
    context.font = `800 ${portrait ? 22 : 18}px Segoe UI Symbol, sans-serif`;
    context.textAlign = portrait ? "center" : "left";
    context.fillText(glyph, portrait ? rect.x + rect.width / 2 : rect.x + 14, rect.y + (portrait ? 31 : 31));
    context.font = `700 ${portrait ? 12 : 15}px Segoe UI, sans-serif`;
    context.fillText(folder, portrait ? rect.x + rect.width / 2 : rect.x + 48, rect.y + (portrait ? 58 : 31));
    context.textAlign = "left";
    regions.push({ action: "explorer-folder", value: folder, rect, layer: "content" });
  });

  const body = portrait
    ? { x: 24, y: sidebar.y + sidebar.height + 22, width: content.width - 48, height: content.height - sidebar.y - sidebar.height - 44 }
    : { x: 278, y: headerHeight + 20, width: content.width - 302, height: content.height - headerHeight - 42 };
  const entries = explorerEntries(state.explorerFolder);
  context.fillStyle = "#303847";
  context.font = `800 ${portrait ? 23 : 20}px Segoe UI, sans-serif`;
  context.fillText(state.explorerFolder === "Home" ? "Quick access" : state.explorerFolder, body.x, body.y + 26);
  const rowHeight = portrait ? 96 : 72;
  entries.forEach((entry, index) => {
    const rowY = body.y + 46 + index * (rowHeight + 10);
    if (rowY + rowHeight > body.y + body.height) return;
    panel(context, body.x, rowY, body.width, rowHeight, 18, "#ffffff", "#dfe3ec");
    panel(context, body.x + 14, rowY + 13, rowHeight - 26, rowHeight - 26, 13, entry.color);
    context.fillStyle = "#ffffff";
    context.font = `850 ${portrait ? 23 : 18}px Segoe UI Symbol, sans-serif`;
    context.textAlign = "center";
    context.fillText(entry.glyph, body.x + 14 + (rowHeight - 26) / 2, rowY + rowHeight * 0.62);
    context.textAlign = "left";
    context.fillStyle = "#2b3240";
    context.font = `800 ${portrait ? 20 : 17}px Segoe UI, sans-serif`;
    context.fillText(entry.name, body.x + rowHeight + 4, rowY + rowHeight * 0.46);
    context.fillStyle = "#7d8492";
    context.font = `600 ${portrait ? 15 : 13}px Segoe UI, sans-serif`;
    context.fillText(entry.detail, body.x + rowHeight + 4, rowY + rowHeight * 0.7);
    if (entry.action) regions.push({ action: entry.action, value: entry.value, rect: { x: body.x, y: rowY, width: body.width, height: rowHeight }, layer: "content" });
  });
}

function explorerEntries(folder) {
  if (folder === "Documents") return [
    { name: "Ideas.txt", detail: "2 KB · Today", glyph: "≡", color: "#6f87db", action: "explorer-document", value: "ideas" },
    { name: "Tiny Plans", detail: "Plan note · 4 ideas", glyph: "▤", color: "#edb949", action: "explorer-document", value: "plans" },
    { name: "Critter notes.md", detail: "8 KB · Yesterday", glyph: "#", color: "#49a88e", action: "explorer-document", value: "critters" }
  ];
  if (folder === "Pictures") return [
    { name: "Open responsive Gallery", detail: "4 original illustrations", glyph: "▧", color: "#d86fe8", action: "mode", value: "gallery" },
    { name: "Desktop backgrounds", detail: "Canvas originals", glyph: "◫", color: "#5f74ed", action: "mode", value: "gallery" }
  ];
  if (folder === "Music") return [
    { name: "Open Media Player", detail: "3 original synthesized tracks", glyph: "♫", color: "#6459d9", action: "mode", value: "media" },
    { name: "Soft Circuit.synth", detail: "Generated live", glyph: "♪", color: "#22a7a1", action: "mode", value: "media" }
  ];
  return [
    { name: "Documents", detail: "Ideas and tiny plans", glyph: "▤", color: "#edb949", action: "explorer-folder", value: "Documents" },
    { name: "Pictures", detail: "Original gallery", glyph: "▧", color: "#d86fe8", action: "explorer-folder", value: "Pictures" },
    { name: "Music", detail: "Procedural tracks", glyph: "♫", color: "#6459d9", action: "explorer-folder", value: "Music" }
  ];
}

function drawExplorerDocument(context, layout, regions, documentId, headerHeight) {
  const { content, portrait } = layout;
  const documents = {
    ideas: {
      title: "Ideas.txt",
      type: "Plain text",
      lines: [
        "A small screen can still feel like a whole desk.",
        "", "Try next:", "• A weather tile that notices the room", "• A focus timer shaped like a tiny moon",
        "• Softer sounds for the evening theme", "", "Keep every interaction obvious enough to discover by touch."
      ]
    },
    plans: {
      title: "Tiny Plans",
      type: "Plan note",
      lines: [
        "Four delightfully achievable plans", "", "1. Sketch one friendly icon", "2. Name a new Critter Loop friend",
        "3. Listen to one complete synth track", "4. Leave the desktop calmer than you found it"
      ]
    },
    critters: {
      title: "Critter notes.md",
      type: "Markdown",
      lines: [
        "# Critter Loop field notes", "", "## Miso", "Unreasonably calm during the evening commute.", "",
        "## Bloop", "Would like everyone to know the reef tour starts at noon.", "", "- Bring snacks", "- Compliment the duck", "- Never rush a capybara"
      ]
    }
  };
  const document = documents[documentId] ?? documents.ideas;
  const back = { x: 26, y: headerHeight + 18, width: portrait ? 190 : 168, height: portrait ? 52 : 44 };
  panel(context, back.x, back.y, back.width, back.height, 15, "#dfe7f6");
  context.fillStyle = "#31517d";
  context.font = `800 ${portrait ? 17 : 15}px Segoe UI, sans-serif`;
  context.fillText("‹  Back to Documents", back.x + 16, back.y + (portrait ? 33 : 29));
  regions.push({ action: "explorer-back", rect: back, layer: "content" });

  const paper = {
    x: portrait ? 26 : 54,
    y: back.y + back.height + 20,
    width: content.width - (portrait ? 52 : 108),
    height: content.height - back.y - back.height - 44
  };
  panel(context, paper.x, paper.y, paper.width, paper.height, 22, "#ffffff", "#dfe3ec");
  context.fillStyle = "#202735";
  context.font = `850 ${portrait ? 29 : 25}px Segoe UI, sans-serif`;
  context.fillText(document.title, paper.x + 30, paper.y + 48);
  context.fillStyle = "#7c8493";
  context.font = `650 ${portrait ? 16 : 14}px Segoe UI, sans-serif`;
  context.fillText(document.type, paper.x + 30, paper.y + 76);
  context.fillStyle = "#343b49";
  let lineY = paper.y + 126;
  const baseFont = portrait ? 19 : 17;
  const lineHeight = portrait ? 34 : 29;
  for (const line of document.lines) {
    if (lineY > paper.y + paper.height - 24) break;
    const isHeading = line.startsWith("#");
    const text = isHeading ? line.replace(/^#+\s*/, "") : line;
    context.fillStyle = isHeading ? "#31517d" : "#343b49";
    context.font = `${isHeading ? 850 : 600} ${isHeading ? baseFont + (line.startsWith("# ") ? 7 : 3) : baseFont}px ${documentId === "ideas" ? "Consolas, monospace" : "Segoe UI, sans-serif"}`;
    if (text) lineY = wrapText(context, text, paper.x + 30, lineY, paper.width - 60, lineHeight) + lineHeight;
    else lineY += lineHeight * 0.55;
  }
}

function drawGallery(context, layout, regions, state, time) {
  const { content, portrait } = layout;
  context.fillStyle = "#151725";
  context.fillRect(0, 0, content.width, content.height);
  context.fillStyle = "#ffffff";
  context.font = `850 ${portrait ? 31 : 27}px Segoe UI, sans-serif`;
  context.fillText("Gallery", 30, portrait ? 54 : 48);
  context.fillStyle = "#9da5bc";
  context.font = "650 15px Segoe UI, sans-serif";
  context.fillText("Original canvas collection", 30, portrait ? 80 : 69);
  const columns = portrait ? 2 : 3;
  const gap = portrait ? 18 : 20;
  const margin = 28;
  const gridWidth = portrait ? content.width - margin * 2 : content.width * 0.62;
  const thumbWidth = (gridWidth - gap * (columns - 1)) / columns;
  const thumbHeight = portrait ? 210 : 200;
  for (let index = 0; index < 4; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + column * (thumbWidth + gap);
    const y = (portrait ? 116 : 96) + row * (thumbHeight + 24);
    panel(context, x - 4, y - 4, thumbWidth + 8, thumbHeight + 8, 22, index === state.gallerySelected ? "#8295ff" : "rgba(255,255,255,.08)");
    context.save();
    roundedPath(context, x, y, thumbWidth, thumbHeight, 18);
    context.clip();
    drawGalleryArt(context, x, y, thumbWidth, thumbHeight, index, time);
    context.restore();
    regions.push({ action: "gallery-select", value: index, rect: { x: x - 6, y: y - 6, width: thumbWidth + 12, height: thumbHeight + 12 }, layer: "content" });
  }
  const detail = portrait
    ? { x: 28, y: 620, width: content.width - 56, height: 330 }
    : { x: content.width * 0.66, y: 96, width: content.width * 0.31, height: content.height - 130 };
  panel(context, detail.x, detail.y, detail.width, detail.height, 26, "rgba(255,255,255,.08)");
  const previewHeight = Math.min(detail.height * 0.58, detail.width * 0.68);
  context.save();
  roundedPath(context, detail.x + 18, detail.y + 18, detail.width - 36, previewHeight, 18);
  context.clip();
  drawGalleryArt(context, detail.x + 18, detail.y + 18, detail.width - 36, previewHeight, state.gallerySelected, time);
  context.restore();
  context.fillStyle = "#ffffff";
  context.font = `800 ${portrait ? 22 : 18}px Segoe UI, sans-serif`;
  context.fillText(["Sunset Shapes", "Lagoon Friend", "Satellite Picnic", "Mossy Morning"][state.gallerySelected], detail.x + 20, detail.y + previewHeight + 52);
  const button = { x: detail.x + 20, y: detail.y + detail.height - 64, width: detail.width - 40, height: 46 };
  panel(context, button.x, button.y, button.width, button.height, 15, "#657cff");
  context.fillStyle = "white";
  context.font = "800 15px Segoe UI, sans-serif";
  context.textAlign = "center";
  context.fillText("Set as background", button.x + button.width / 2, button.y + 29);
  context.textAlign = "left";
  regions.push({ action: "gallery-background", rect: button, layer: "content" });
}

function drawGalleryArt(context, x, y, width, height, index, time) {
  const palettes = [
    ["#f08a6d", "#5f4a93", "#ffd57a"], ["#146b83", "#37b49c", "#f5a6c5"],
    ["#171b47", "#7351a8", "#ffc66e"], ["#2f6456", "#90ad6d", "#f0d89b"]
  ];
  fillGradient(context, x, y, width, height, palettes[index][0], palettes[index][1]);
  const phase = time * 0.0005 + index;
  context.fillStyle = palettes[index][2];
  circle(context, x + width * (0.25 + index * 0.12), y + height * 0.28, height * 0.13);
  context.fillStyle = "rgba(12,18,35,.32)";
  context.beginPath();
  context.moveTo(x, y + height * 0.78);
  context.quadraticCurveTo(x + width * 0.42, y + height * (0.5 + Math.sin(phase) * 0.03), x + width, y + height * 0.72);
  context.lineTo(x + width, y + height);
  context.lineTo(x, y + height);
  context.closePath();
  context.fill();
  if (index === 1) {
    context.fillStyle = "#f7a8c6";
    ellipse(context, x + width * 0.56, y + height * 0.58, width * 0.16, height * 0.12);
    context.fillStyle = "#293048";
    circle(context, x + width * 0.52, y + height * 0.55, height * 0.012);
    circle(context, x + width * 0.6, y + height * 0.55, height * 0.012);
  }
}

function drawCall(context, layout, regions, state, time, webcamVideo) {
  const { content, portrait } = layout;
  const gradient = context.createLinearGradient(0, 0, content.width, content.height);
  gradient.addColorStop(0, "#10253c");
  gradient.addColorStop(1, "#182033");
  context.fillStyle = gradient;
  context.fillRect(0, 0, content.width, content.height);
  context.fillStyle = "#ffffff";
  context.font = `850 ${portrait ? 28 : 25}px Segoe UI, sans-serif`;
  context.fillText("Calling Computer CEO", 30, portrait ? 54 : 48);
  const elapsed = Math.max(0, time - state.callStartedAt);
  const remaining = Math.max(0, Math.ceil((20000 - elapsed) / 1000));
  context.fillStyle = "#9eb1cb";
  context.font = "650 15px Segoe UI, sans-serif";
  context.fillText(state.callStatus === "ringing" ? `Ringing… ${remaining}s` : state.callStatus === "unanswered" ? "No answer after 20 seconds" : "Call ended", 30, portrait ? 81 : 70);

  const remote = portrait
    ? { x: 28, y: 110, width: content.width - 56, height: 600 }
    : { x: 28, y: 96, width: content.width - 56, height: content.height - 132 };
  panel(context, remote.x, remote.y, remote.width, remote.height, 28, "#25415c");
  const pulse = state.callStatus === "ringing" ? 1 + Math.sin(time * 0.007) * 0.04 : 1;
  context.save();
  context.translate(remote.x + remote.width / 2, remote.y + remote.height * 0.44);
  context.scale(pulse, pulse);
  context.fillStyle = "rgba(116,143,174,.42)";
  circle(context, 0, 0, Math.min(remote.width, remote.height) * 0.18);
  context.fillStyle = "#a9bed3";
  circle(context, 0, -24, Math.min(remote.width, remote.height) * 0.07);
  ellipse(context, 0, 60, Math.min(remote.width, remote.height) * 0.13, Math.min(remote.width, remote.height) * 0.09);
  context.restore();
  context.fillStyle = "rgba(255,255,255,.8)";
  context.font = `750 ${portrait ? 21 : 18}px Segoe UI, sans-serif`;
  context.textAlign = "center";
  context.fillText("Computer CEO", remote.x + remote.width / 2, remote.y + remote.height * 0.72);
  context.textAlign = "left";

  const preview = portrait
    ? { x: remote.x + 24, y: remote.y + remote.height - 190, width: 238, height: 150 }
    : { x: remote.x + remote.width - 252, y: remote.y + remote.height - 174, width: 224, height: 142 };
  panel(context, preview.x, preview.y, preview.width, preview.height, 20, "#101928", "rgba(255,255,255,.2)");
  context.save();
  roundedPath(context, preview.x + 3, preview.y + 3, preview.width - 6, preview.height - 6, 18);
  context.clip();
  if (state.callPreviewReady && webcamVideo?.readyState >= 2) {
    context.translate(preview.x + preview.width, preview.y);
    context.scale(-1, 1);
    context.drawImage(webcamVideo, 0, 0, preview.width, preview.height);
  } else {
    drawLocalPreviewFallback(context, preview, time, state.callPreviewDenied);
  }
  context.restore();

  const buttonY = portrait ? remote.y + remote.height + 28 : content.height - 76;
  const end = { x: content.width / 2 - 56, y: buttonY, width: 112, height: 50 };
  if (state.callStatus === "ringing") {
    panel(context, end.x, end.y, end.width, end.height, 25, "#dc5263");
    context.fillStyle = "white";
    context.textAlign = "center";
    context.font = "850 16px Segoe UI, sans-serif";
    context.fillText("Hang up", end.x + end.width / 2, end.y + 31);
    context.textAlign = "left";
    regions.push({ action: "call-end", rect: end, layer: "content" });
  } else {
    panel(context, end.x, end.y, end.width, end.height, 25, "#3cab82");
    context.fillStyle = "white";
    context.textAlign = "center";
    context.font = "850 16px Segoe UI, sans-serif";
    context.fillText("Call again", end.x + end.width / 2, end.y + 31);
    context.textAlign = "left";
    regions.push({ action: "call-retry", rect: end, layer: "content" });
  }
}

function drawLocalPreviewFallback(context, rect, time, denied) {
  fillGradient(context, rect.x, rect.y, rect.width, rect.height, "#3d5268", "#172438");
  context.fillStyle = "#f2c6a5";
  circle(context, rect.x + rect.width * 0.5, rect.y + rect.height * 0.42, rect.height * 0.17);
  context.fillStyle = "#233248";
  ellipse(context, rect.x + rect.width * 0.5, rect.y + rect.height * 0.87, rect.width * 0.26, rect.height * 0.28);
  context.fillStyle = "rgba(255,255,255,.78)";
  context.font = "650 11px Segoe UI, sans-serif";
  context.fillText(denied ? "Camera unavailable · preview demo" : `Starting camera${".".repeat(1 + Math.floor(time / 500) % 3)}`, rect.x + 12, rect.y + rect.height - 12);
}

function drawGame(context, layout, regions, state, time) {
  const { content, portrait } = layout;
  fillGradient(context, 0, 0, content.width, content.height, "#131638", "#4d2465");
  context.fillStyle = "#ffffff";
  context.font = `900 ${portrait ? 32 : 28}px Segoe UI, sans-serif`;
  context.fillText("Orbit Pop", 30, portrait ? 58 : 50);
  context.fillStyle = "#d8d8f1";
  context.font = "700 16px Segoe UI, sans-serif";
  context.fillText(`Score ${state.gameScore} · tap the wandering spark`, 30, portrait ? 86 : 74);
  const arena = { x: 26, y: portrait ? 120 : 96, width: content.width - 52, height: content.height - (portrait ? 160 : 128) };
  panel(context, arena.x, arena.y, arena.width, arena.height, 30, "rgba(6,9,29,.48)", "rgba(255,255,255,.13)");
  const phase = Math.floor((time - state.gameStartedAt) / 1150) + state.gameScore * 7;
  const tx = arena.x + arena.width * (0.14 + modulo(Math.sin(phase * 9.17) * 999, 1) * 0.72);
  const ty = arena.y + arena.height * (0.16 + modulo(Math.cos(phase * 6.31) * 999, 1) * 0.68);
  const radius = portrait ? 45 : 38;
  const glow = context.createRadialGradient(tx, ty, 2, tx, ty, radius * 1.8);
  glow.addColorStop(0, "rgba(255,235,125,.95)");
  glow.addColorStop(0.35, "rgba(255,119,179,.7)");
  glow.addColorStop(1, "rgba(255,119,179,0)");
  context.fillStyle = glow;
  circle(context, tx, ty, radius * 1.8);
  context.fillStyle = "#fff3a6";
  circle(context, tx, ty, radius * (0.68 + Math.sin(time * 0.01) * 0.08));
  regions.push({ action: "game-target", rect: { x: tx - radius * 1.4, y: ty - radius * 1.4, width: radius * 2.8, height: radius * 2.8 }, layer: "content" });
  const reset = { x: arena.x + arena.width - 112, y: arena.y + 18, width: 92, height: 38 };
  panel(context, reset.x, reset.y, reset.width, reset.height, 14, "rgba(255,255,255,.12)");
  context.fillStyle = "white";
  context.font = "750 14px Segoe UI, sans-serif";
  context.textAlign = "center";
  context.fillText("Reset", reset.x + reset.width / 2, reset.y + 25);
  context.textAlign = "left";
  regions.push({ action: "game-reset", rect: reset, layer: "content" });
}

function drawMedia(context, layout, regions, state, time) {
  const { content, portrait } = layout;
  fillGradient(context, 0, 0, content.width, content.height, "#101426", "#272146");
  context.fillStyle = "#ffffff";
  context.font = `850 ${portrait ? 31 : 27}px Segoe UI, sans-serif`;
  context.fillText("Media Player", 30, portrait ? 56 : 49);
  context.fillStyle = "#9ea6be";
  context.font = "650 15px Segoe UI, sans-serif";
  context.fillText("Original procedural synth collection", 30, portrait ? 82 : 72);
  const nowPlaying = portrait
    ? { x: 28, y: 112, width: content.width - 56, height: 420 }
    : { x: 32, y: 102, width: content.width * 0.46, height: content.height - 138 };
  const track = SYNTH_TRACKS[state.mediaTrack];
  panel(context, nowPlaying.x, nowPlaying.y, nowPlaying.width, nowPlaying.height, 30, track.color);
  const centerX = nowPlaying.x + nowPlaying.width / 2;
  const centerY = nowPlaying.y + nowPlaying.height * 0.43;
  for (let index = 0; index < 22; index += 1) {
    const phase = time * (state.mediaPlaying ? 0.002 : 0) + index * 0.7;
    const radius = 42 + index * 4 + Math.sin(phase) * 5;
    context.strokeStyle = `rgba(255,255,255,${0.28 - index * 0.009})`;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();
  }
  context.fillStyle = "white";
  context.font = `900 ${portrait ? 30 : 26}px Segoe UI, sans-serif`;
  context.textAlign = "center";
  context.fillText(track.title, centerX, nowPlaying.y + nowPlaying.height - 122);
  context.fillStyle = "rgba(255,255,255,.72)";
  context.font = "650 15px Segoe UI, sans-serif";
  context.fillText(track.subtitle, centerX, nowPlaying.y + nowPlaying.height - 96);
  const controlY = nowPlaying.y + nowPlaying.height - 62;
  const play = { x: nowPlaying.x + 22, y: controlY, width: 88, height: 40 };
  panel(context, play.x, play.y, play.width, play.height, 19, "rgba(13,16,30,.72)");
  context.fillStyle = "white";
  context.font = "850 14px Segoe UI, sans-serif";
  context.fillText(state.mediaPlaying ? "Pause" : "Play", play.x + play.width / 2, play.y + 26);
  context.textAlign = "left";
  regions.push({ action: "media-toggle", rect: play, layer: "content" });
  const volumeTrack = {
    x: play.x + play.width + 54,
    y: controlY + 15,
    width: nowPlaying.x + nowPlaying.width - 24 - (play.x + play.width + 54),
    height: 10
  };
  context.fillStyle = "rgba(255,255,255,.82)";
  context.font = "800 18px Segoe UI Symbol, sans-serif";
  context.fillText("◖", play.x + play.width + 22, controlY + 27);
  panel(context, volumeTrack.x, volumeTrack.y, volumeTrack.width, volumeTrack.height, 5, "rgba(12,16,31,.5)");
  panel(context, volumeTrack.x, volumeTrack.y, volumeTrack.width * state.mediaVolume, volumeTrack.height, 5, "#ffffff");
  context.fillStyle = "#ffffff";
  circle(context, volumeTrack.x + volumeTrack.width * state.mediaVolume, volumeTrack.y + volumeTrack.height / 2, 10);
  regions.push({
    action: "media-volume",
    rect: { x: volumeTrack.x, y: volumeTrack.y - 13, width: volumeTrack.width, height: 36 },
    layer: "content"
  });

  const list = portrait
    ? { x: 28, y: 560, width: content.width - 56, height: content.height - 590 }
    : { x: content.width * 0.52, y: 102, width: content.width * 0.44, height: content.height - 138 };
  panel(context, list.x, list.y, list.width, list.height, 26, "rgba(255,255,255,.07)");
  SYNTH_TRACKS.forEach((item, index) => {
    const row = { x: list.x + 16, y: list.y + 18 + index * (portrait ? 116 : 96), width: list.width - 32, height: portrait ? 98 : 80 };
    panel(context, row.x, row.y, row.width, row.height, 18, index === state.mediaTrack ? "rgba(122,137,255,.25)" : "rgba(255,255,255,.055)");
    panel(context, row.x + 14, row.y + 14, row.height - 28, row.height - 28, 14, item.color);
    context.fillStyle = "white";
    context.font = `800 ${portrait ? 20 : 17}px Segoe UI, sans-serif`;
    context.fillText(item.title, row.x + row.height, row.y + row.height * 0.46);
    context.fillStyle = "#9fa9c1";
    context.font = "650 13px Segoe UI, sans-serif";
    context.fillText(item.subtitle, row.x + row.height, row.y + row.height * 0.7);
    regions.push({ action: "media-track", value: index, rect: row, layer: "content" });
  });
}

function drawComputerGlyph(context, centerX, centerY, size) {
  context.save();
  context.strokeStyle = "#ffffff";
  context.fillStyle = "rgba(255,255,255,.18)";
  context.lineWidth = Math.max(2.4, size * 0.08);
  context.lineCap = "round";
  context.lineJoin = "round";
  roundedPath(context, centerX - size * 0.48, centerY - size * 0.4, size * 0.96, size * 0.66, size * 0.1);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(centerX, centerY + size * 0.27);
  context.lineTo(centerX, centerY + size * 0.42);
  context.moveTo(centerX - size * 0.24, centerY + size * 0.43);
  context.lineTo(centerX + size * 0.24, centerY + size * 0.43);
  context.stroke();
  context.fillStyle = "#ffffff";
  circle(context, centerX + size * 0.29, centerY + size * 0.08, size * 0.07);
  context.restore();
}

function drawStartRow(context, x, y, width, height, glyph, label, color) {
  panel(context, x, y, width, height, 12, "rgba(255,255,255,.78)");
  panel(context, x + 5, y + 5, height - 10, height - 10, 10, color);
  context.fillStyle = color === "#eef1ff" ? "#29324c" : "#ffffff";
  context.font = `850 ${height * 0.34}px Segoe UI Symbol, sans-serif`;
  context.textAlign = "center";
  context.fillText(glyph, x + height / 2, y + height * 0.65);
  context.textAlign = "left";
  context.fillStyle = "#25334a";
  context.font = `750 ${Math.min(16, height * 0.34)}px Segoe UI, sans-serif`;
  context.fillText(label, x + height + 8, y + height * 0.62);
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
  const windowControlGutter = portrait ? 154 : 132;
  const clearX = content.width - windowControlGutter - clearWidth - 24;
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
  drawSwivelLogoMark(context, x, y, size);
}

function drawSwivelLogoMark(context, x, y, size) {
  const scale = size / 64;
  context.save();
  panel(context, x, y, size, size, 19 * scale, "#697ef2");
  context.strokeStyle = "#ffffff";
  context.lineWidth = 4.5 * scale;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(x + 14 * scale, y + 44 * scale);
  context.bezierCurveTo(x + 28 * scale, y + 48 * scale, x + 44 * scale, y + 38 * scale, x + 45 * scale, y + 18 * scale);
  context.moveTo(x + 14 * scale, y + 44 * scale);
  context.lineTo(x + 22 * scale, y + 35 * scale);
  context.moveTo(x + 14 * scale, y + 44 * scale);
  context.lineTo(x + 23 * scale, y + 52 * scale);
  context.moveTo(x + 45 * scale, y + 18 * scale);
  context.lineTo(x + 37 * scale, y + 26 * scale);
  context.moveTo(x + 45 * scale, y + 18 * scale);
  context.lineTo(x + 53 * scale, y + 26 * scale);
  context.stroke();
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
  return lineY;
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

function shutdownProgressAt(elapsed) {
  const time = clampNumber(elapsed, 0, SHUTDOWN_DURATION);
  for (let index = 1; index < UPDATE_STOPS.length; index += 1) {
    const previous = UPDATE_STOPS[index - 1];
    const next = UPDATE_STOPS[index];
    if (time <= next[0]) {
      const fraction = (time - previous[0]) / (next[0] - previous[0]);
      return previous[1] + (next[1] - previous[1]) * fraction;
    }
  }
  return 1;
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
